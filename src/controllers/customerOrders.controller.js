const prisma = require("../prisma");
const { computePreorderTotals } = require("../services/pricing.service");
const { formatDateKey, formatPreorderNumber } = require("../helpers/preorder-number");
const { getPaymentExpiryHours } = require("../services/notification-template-defaults");
const {
  isPaymentModeEnabled,
  resolveDeliveryModeForPayment,
  validateCountryOrderOptions,
} = require("../services/country-order-options.service");

const CIV_ZONE_COUNTRY_CODES = ["CIV", "BEN", "TGO", "NER", "BFA"];

function canonicalFboNumber(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  }
  return String(raw || "").trim();
}

function attachCustomerPaymentWindow(order) {
  if (!order || typeof order !== "object") return order;

  const paymentExpiryHours = getPaymentExpiryHours();
  const invoicedAt = order.invoicedAt ? new Date(order.invoicedAt) : null;
  const explicitPaymentExpiresAt = order.paymentExpiresAt
    ? new Date(order.paymentExpiresAt)
    : null;
  const paymentExpiresAt =
    explicitPaymentExpiresAt && !Number.isNaN(explicitPaymentExpiresAt.getTime())
      ? explicitPaymentExpiresAt.toISOString()
      : invoicedAt && !Number.isNaN(invoicedAt.getTime())
        ? new Date(invoicedAt.getTime() + paymentExpiryHours * 60 * 60 * 1000).toISOString()
        : null;
  const resolvedPaymentExpiryHours =
    explicitPaymentExpiresAt &&
    invoicedAt &&
    !Number.isNaN(explicitPaymentExpiresAt.getTime()) &&
    !Number.isNaN(invoicedAt.getTime()) &&
    explicitPaymentExpiresAt.getTime() > invoicedAt.getTime()
      ? Math.max(
          1,
          Math.ceil((explicitPaymentExpiresAt.getTime() - invoicedAt.getTime()) / (60 * 60 * 1000)),
        )
      : paymentExpiryHours;

  return {
    ...order,
    paymentExpiryHours: resolvedPaymentExpiryHours,
    paymentExpiresAt,
  };
}

async function listMyOrders(req, res) {
  try {
    const fboId = req.customer?.fboId;
    const numeroFbo = canonicalFboNumber(req.customer?.numeroFbo || "");
    const rows = await prisma.preorder.findMany({
      where: {
        country: { code: { in: CIV_ZONE_COUNTRY_CODES } },
        OR: [
          { fboId },
          ...(numeroFbo ? [{ placedByFboNumero: numeroFbo }] : []),
        ],
      },
      select: {
        id: true,
        country: {
          select: {
            code: true,
            name: true,
          },
        },
        preorderNumber: true,
        status: true,
        paymentStatus: true,
        preorderPaymentMode: true,
        fboNumero: true,
        fboNomComplet: true,
        placedByFboNumero: true,
        placedByFboName: true,
        placedByHomeCountryCode: true,
        totalFcfa: true,
        factureReference: true,
        paymentCollectionCode: true,
        invoicedAt: true,
        paymentExpiresAt: true,
        parcelNumber: true,
        bankPaymentStatus: true,
        bankPaymentDueAt: true,
        createdAt: true,
        updatedAt: true,
        bankPaymentProofs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            submittedAt: true,
            fileUrl: true,
            rejectionReason: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.json({
      data: rows.map((row) => {
        const relationType =
          row.fboNumero === numeroFbo ? "SELF" : "PLACED_FOR_OTHER";
        return attachCustomerPaymentWindow({
          ...row,
          relationType,
          latestBankProof: row.bankPaymentProofs?.[0] || null,
        });
      }),
    });
  } catch (e) {
    console.error("listMyOrders error:", e);
    return res.status(500).json({ message: "Erreur serveur (listMyOrders)" });
  }
}

async function getMyOrder(req, res) {
  try {
    const fboId = req.customer?.fboId;
    const numeroFbo = canonicalFboNumber(req.customer?.numeroFbo || "");
    const { id } = req.params;

    const order = await prisma.preorder.findFirst({
      where: {
        id,
        country: { code: { in: CIV_ZONE_COUNTRY_CODES } },
        OR: [
          { fboId },
          ...(numeroFbo ? [{ placedByFboNumero: numeroFbo }] : []),
        ],
      },
      include: {
        country: {
          select: {
            code: true,
            name: true,
          },
        },
        items: {
          include: {
            product: {
              select: { id: true, sku: true, nom: true, imageUrl: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            channel: true,
            purpose: true,
            status: true,
            toPhone: true,
            sentAt: true,
            deliveredAt: true,
            failedAt: true,
            errorMessage: true,
            createdAt: true,
          },
        },
        logs: {
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            action: true,
            note: true,
            createdAt: true,
          },
        },
        bankPaymentProofs: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }
    return res.json(attachCustomerPaymentWindow(order));
  } catch (e) {
    console.error("getMyOrder error:", e);
    return res.status(500).json({ message: "Erreur serveur (getMyOrder)" });
  }
}

async function reorderMyOrder(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const countryCode = req.country?.code || "CIV";
    const fboId = req.customer?.fboId;
    const { id } = req.params;

    const sourceOrder = await prisma.preorder.findFirst({
      where: {
        id,
        countryId,
        fboId,
      },
      include: {
        items: {
          select: {
            productId: true,
            qty: true,
          },
        },
        fbo: {
          select: {
            id: true,
            numeroFbo: true,
            nomComplet: true,
            email: true,
            grade: true,
            pointDeVente: true,
          },
        },
        country: {
          select: {
            settings: {
              select: {
                enableWave: true,
                enableOrangeMoney: true,
                enableCash: true,
                enableBankTransfer: true,
                enableEcobankPay: true,
                enableDelivery: true,
                enablePickup: true,
              },
            },
          },
        },
      },
    });

    if (!sourceOrder) {
      return res.status(404).json({ message: "Commande source introuvable" });
    }

    if (!Array.isArray(sourceOrder.items) || sourceOrder.items.length === 0) {
      return res.status(400).json({ message: "La commande source ne contient aucun produit." });
    }

    const uniqueProductIds = [...new Set(sourceOrder.items.map((it) => it.productId).filter(Boolean))];
    const availableProducts = await prisma.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        countryId,
        actif: true,
      },
      select: { id: true },
    });

    const availableSet = new Set(availableProducts.map((p) => p.id));
    const reorderItems = sourceOrder.items
      .filter((it) => availableSet.has(it.productId))
      .map((it) => ({
        productId: it.productId,
        qty: Math.max(1, Number.parseInt(it.qty, 10) || 1),
      }));

    if (!reorderItems.length) {
      return res.status(400).json({
        message: "Aucun produit de la commande source n'est actuellement disponible.",
      });
    }

    const preorderDateKey = formatDateKey(new Date());
    const now = new Date();

    const createdPreorder = await prisma.$transaction(async (tx) => {
      const lastPreorderOfDay = await tx.preorder.findFirst({
        where: {
          countryId,
          preorderDateKey,
        },
        orderBy: { preorderSeq: "desc" },
        select: { preorderSeq: true },
      });

      const nextSeq = (lastPreorderOfDay?.preorderSeq || 0) + 1;
      const preorderNumber = formatPreorderNumber({
        countryCode,
        dateKey: preorderDateKey,
        seq: nextSeq,
      });

      const sourcePaymentMode = sourceOrder.preorderPaymentMode || null;
      let normalizedPaymentMode = isPaymentModeEnabled(
        sourceOrder.country?.settings,
        sourcePaymentMode,
      )
        ? sourcePaymentMode
        : null;
      let normalizedDeliveryMode = resolveDeliveryModeForPayment(
        normalizedPaymentMode,
        normalizedPaymentMode ? sourceOrder.deliveryMode : null,
      );
      const optionValidation = validateCountryOrderOptions({
        settings: sourceOrder.country?.settings,
        paymentMode: normalizedPaymentMode,
        deliveryMode: normalizedDeliveryMode,
      });

      if (!optionValidation.ok) {
        normalizedPaymentMode = null;
        normalizedDeliveryMode = null;
      }

      const created = await tx.preorder.create({
        data: {
          countryId,
          fboId: sourceOrder.fbo.id,
          fboNumero: sourceOrder.fbo.numeroFbo,
          fboNomComplet: sourceOrder.fbo.nomComplet,
          fboEmail: sourceOrder.fbo.email || null,
          fboGrade: sourceOrder.fbo.grade,
          pointDeVente: sourceOrder.fbo.pointDeVente,
          preorderPaymentMode: normalizedPaymentMode,
          deliveryMode: normalizedDeliveryMode,
          status: "DRAFT",
          paymentStatus: "UNPAID",
          billingWorkStatus: "NONE",
          preorderNumber,
          preorderSeq: nextSeq,
          preorderDateKey,
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.preorderItem.createMany({
        data: reorderItems.map((it) => ({
          preorderId: created.id,
          productId: it.productId,
          qty: it.qty,
          productSkuSnapshot: null,
          productNameSnapshot: null,
          prixCatalogueFcfa: 0,
          discountPercent: "0.00",
          prixUnitaireFcfa: 0,
          ccUnitaire: "0.000",
          poidsUnitaireKg: "0.000",
          lineTotalFcfa: 0,
          lineTotalCc: "0.000",
          lineTotalPoids: "0.000",
        })),
      });

      await tx.preorderLog.create({
        data: {
          preorderId: created.id,
          action: "CREATE_DRAFT",
          note: "Brouillon créé via recommander panier (portail client).",
          meta: {
            sourceOrderId: sourceOrder.id,
            sourceOrderNumber: sourceOrder.preorderNumber || null,
            source: "CUSTOMER_PORTAL_REORDER",
          },
          actorAdminId: null,
        },
      });

      return created;
    });

    const summary = await computePreorderTotals(createdPreorder.id, countryId);

    await prisma.preorder.update({
      where: { id: createdPreorder.id },
      data: {
        totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
        totalPoidsKg: String(Number(summary.totals.totalPoidsKg || 0).toFixed(3)),
        totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
        fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
        totalFcfa: summary.totals.totalFcfa || 0,
      },
    });

    return res.json({
      ok: true,
      preorderId: createdPreorder.id,
      preorderNumber: createdPreorder.preorderNumber,
      itemsCount: reorderItems.length,
    });
  } catch (e) {
    console.error("reorderMyOrder error:", e);
    return res.status(500).json({ message: "Erreur serveur (reorderMyOrder)" });
  }
}

module.exports = {
  listMyOrders,
  getMyOrder,
  reorderMyOrder,
};
