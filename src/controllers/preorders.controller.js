// src/controllers/preorders.controller.js

const prisma = require("../prisma");
const {
  computePreorderTotals,
  computeCatalogProductsForPreorder,
} = require("../services/pricing.service");
const {
  buildPreorderSmsMessage,
  normalizePhone,
  sendSms,
  fetchSmsStatus,
} = require("../services/sms.service");
const { scopeWhere, scopeCreate } = require("../helpers/countryScope");
const { formatDateKey, formatPreorderNumber } = require("../helpers/preorder-number");

const BILLING_WHATSAPPS = [process.env.BILLING_WA_1 || "+2250506025071"];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeNumeroFbo(v) {
  return String(v || "").trim();
}

function mapSmsStatus(rawStatus) {
  const s = String(rawStatus || "").trim().toUpperCase();
  if (["SENT", "DELIVERED", "READ"].includes(s)) return "sent";
  if (["FAILED", "CANCELLED"].includes(s)) return "failed";
  return "pending";
}

function digitsOnly(v = "") {
  return String(v || "").replace(/\D/g, "");
}

function isBillingNumber(phone = "") {
  const target = digitsOnly(phone);
  if (!target) return false;

  return BILLING_WHATSAPPS.some((n) => digitsOnly(n) === target);
}

function extractNotificationFromPreorder(preorder) {
  return {
    smsStatus: mapSmsStatus(preorder?.lastWhatsappStatus),
    smsLastError: null,
    smsLastSentAt: preorder?.lastWhatsappStatusAt || null,
  };
}

function mapDeliveryToPersistedStatus(deliveryStatus) {
  if (deliveryStatus === "delivered") return "DELIVERED";
  if (deliveryStatus === "failed") return "FAILED";
  if (deliveryStatus === "pending") return "SENT";
  return null;
}

async function createDraft(req, res) {
  try {
    const {
      numeroFbo,
      nomComplet,
      grade,
      pointDeVente,
      paymentMode = null,
      deliveryMode = null,
    } = req.body || {};

    if (
      !isNonEmptyString(numeroFbo) ||
      !isNonEmptyString(nomComplet) ||
      !isNonEmptyString(pointDeVente) ||
      !grade
    ) {
      return res.status(400).json({
        error: "numeroFbo, nomComplet, grade et pointDeVente sont requis",
      });
    }

    const normalizedNumeroFbo = normalizeNumeroFbo(numeroFbo);
    const normalizedNomComplet = String(nomComplet).trim().toUpperCase();
    const normalizedPointDeVente = String(pointDeVente).trim().toUpperCase();
    const normalizedGrade = String(grade || "").trim().toUpperCase();

    const normalizedPaymentMode = paymentMode
      ? String(paymentMode).trim().toUpperCase()
      : null;

    const normalizedDeliveryMode = deliveryMode
      ? String(deliveryMode).trim().toUpperCase()
      : null;

    const countryId = req.country?.id || req.scope?.countryId || req.countryId;
    const countryCode =
      req.country?.code ||
      req.scope?.countryCode ||
      req.headers["x-country"] ||
      "CIV";

    if (!countryId) {
      return res.status(400).json({
        error: "countryId introuvable dans le scope de la requête",
      });
    }

    const preorderDateKey = formatDateKey(new Date());

    const fbo = await prisma.fbo.upsert({
      where: { numeroFbo: normalizedNumeroFbo },
      update: {
        nomComplet: normalizedNomComplet,
        grade: normalizedGrade,
        pointDeVente: normalizedPointDeVente,
      },
      create: {
        numeroFbo: normalizedNumeroFbo,
        nomComplet: normalizedNomComplet,
        grade: normalizedGrade,
        pointDeVente: normalizedPointDeVente,
      },
    });

    const preorder = await prisma.$transaction(async (tx) => {
      const lastPreorderOfDay = await tx.preorder.findFirst({
        where: {
          countryId,
          preorderDateKey,
        },
        orderBy: {
          preorderSeq: "desc",
        },
        select: {
          preorderSeq: true,
        },
      });

      const nextSeq = (lastPreorderOfDay?.preorderSeq || 0) + 1;

      const preorderNumber = formatPreorderNumber({
        countryCode,
        dateKey: preorderDateKey,
        seq: nextSeq,
      });

      const created = await tx.preorder.create({
        data: scopeCreate(req, {
          fboId: fbo.id,
          fboNumero: fbo.numeroFbo,
          fboNomComplet: fbo.nomComplet,
          fboGrade: fbo.grade,
          pointDeVente: fbo.pointDeVente,

          preorderPaymentMode: normalizedPaymentMode,
          deliveryMode: normalizedDeliveryMode,

          status: "DRAFT",
          billingWorkStatus: "NONE",
          paymentStatus: "UNPAID",

          preorderNumber,
          preorderSeq: nextSeq,
          preorderDateKey,
        }),
      });

      await tx.preorderLog.create({
        data: {
          preorderId: created.id,
          action: "CREATE_DRAFT",
          note: "Brouillon créé",
          meta: {
            fboId: fbo.id,
            numeroFbo: fbo.numeroFbo,
            preorderPaymentMode: normalizedPaymentMode,
            deliveryMode: normalizedDeliveryMode,
            preorderNumber,
            preorderSeq: nextSeq,
            preorderDateKey,
            countryId,
            countryCode,
          },
        },
      });

      return created;
    });

    return res.json({
      preorderId: preorder.id,
      preorderNumber: preorder.preorderNumber,
      status: preorder.status,
    });
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({
        error: "Conflit de numérotation détecté. Réessayez immédiatement.",
      });
    }

    return res.status(500).json({
      error: e.message || "Erreur createDraft",
    });
  }
}

async function getCatalog(req, res) {
  const preorderId = req.params.id;
  const countryId = req.country.id;

  try {
    const items = await computeCatalogProductsForPreorder(preorderId, countryId);

    return res.json({
      preorderId,
      items,
    });
  } catch (e) {
    if (String(e.message) === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ error: "Preorder not found" });
    }

    return res.status(500).json({ error: e.message || "Erreur getCatalog" });
  }
}

async function setItems(req, res) {
  try {
    const preorderId = req.params.id;
    const { items } = req.body || {};
    const countryId = req.country.id;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array" });
    }

    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (preorder.status !== "DRAFT") {
      return res.status(400).json({ error: "Preorder not editable" });
    }

    const normalized = items
      .map((it) => ({
        productId: String(it.productId || "").trim(),
        qty: Math.max(parseInt(it.qty || 0, 10), 0),
      }))
      .filter((it) => it.productId && it.qty > 0);

    const productIds = [...new Set(normalized.map((it) => it.productId))];

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: scopeWhere(req, {
          id: { in: productIds },
          actif: true,
        }),
        select: { id: true },
      });

      if (products.length !== productIds.length) {
        return res.status(400).json({
          error: "Certains produits sont invalides pour le pays courant",
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.preorderItem.deleteMany({ where: { preorderId } });

      if (normalized.length > 0) {
        await tx.preorderItem.createMany({
          data: normalized.map((it) => ({
            preorderId,
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
      }
    });

    const summary = await computePreorderTotals(preorderId, countryId);

    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: preorderId },
        data: {
          totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
          totalPoidsKg: String(
            Number(summary.totals.totalPoidsKg || 0).toFixed(3),
          ),
          totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
          fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
          totalFcfa: summary.totals.totalFcfa || 0,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId,
          action: "SET_ITEMS",
          note: "Panier mis à jour",
          meta: {
            itemsCount: summary.items.length,
            totalFcfa: summary.totals.totalFcfa || 0,
          },
        },
      });
    });

    return res.json({
      preorderId,
      preorderNumber:
        summary?.preorder?.preorderNumber || preorder.preorderNumber,
      items: summary.items,
      totals: summary.totals,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur setItems" });
  }
}

async function getSummary(req, res) {
  const preorderId = req.params.id;
  const countryId = req.country.id;

  try {
    const summary = await computePreorderTotals(preorderId, countryId);
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      select: {
        lastWhatsappStatus: true,
        lastWhatsappStatusAt: true,
      },
    });

    return res.json({
      preorderId,
      preorderNumber: summary?.preorder?.preorderNumber || null,
      discountPercent: summary.discountPercent,
      items: summary.items,
      totals: summary.totals,
      ...extractNotificationFromPreorder(preorder),
    });
  } catch (e) {
    if (String(e.message) === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (
      [
        "PRODUCT_COUNTRY_MISMATCH",
        "PRODUCT_NOT_FOUND",
        "PRODUCT_INACTIVE",
      ].includes(String(e.message))
    ) {
      return res.status(400).json({
        error: "Un ou plusieurs produits du panier sont invalides.",
      });
    }

    return res.status(500).json({ error: e.message || "Erreur getSummary" });
  }
}

async function submit(req, res) {
  const preorderId = req.params.id;
  const { phoneRaw, phoneNormalized } = req.body || {};
  const countryId = req.country.id;

  try {
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      include: {
        items: { include: { product: true } },
        country: { include: { settings: true } },
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (preorder.status !== "DRAFT") {
      return res.status(400).json({ error: "Preorder not editable" });
    }

    if (!preorder.items || preorder.items.length === 0) {
      return res
        .status(400)
        .json({ error: "Panier vide. Ajoute au moins 1 article." });
    }

    if (!preorder.deliveryMode) {
      return res
        .status(400)
        .json({ error: "Le mode de livraison est obligatoire." });
    }

    if (!isNonEmptyString(preorder.fboNumero) || !preorder.fboGrade) {
      return res
        .status(400)
        .json({ error: "Les informations FBO sont incomplètes." });
    }

    const smsTo = normalizePhone(phoneNormalized || phoneRaw);
    if (!smsTo) {
      return res.status(400).json({ error: "Le numéro de téléphone est obligatoire." });
    }
    if (isBillingNumber(smsTo)) {
      return res.status(400).json({
        error:
          "Le numéro de téléphone client est invalide. Veuillez saisir le numéro de l'utilisateur.",
      });
    }

    const summary = await computePreorderTotals(preorderId, countryId);

    if (!summary.items || summary.items.length === 0) {
      return res
        .status(400)
        .json({ error: "Panier vide. Ajoute au moins 1 article." });
    }

    const minCartFcfa = Number(preorder.country?.settings?.minCartFcfa ?? 0);

    if (Number(summary.totals.totalFcfa || 0) < minCartFcfa) {
      return res.status(400).json({
        error: `Montant minimum non atteint. Minimum requis: ${minCartFcfa} FCFA.`,
      });
    }

    const timeoutMin = preorder.country?.settings?.billingClaimTimeoutMin || 15;
    const now = new Date();
    const sla = new Date(now.getTime() + timeoutMin * 60 * 1000);

    const smsMessage = buildPreorderSmsMessage({
      preorder: summary.preorder,
      totals: summary.totals,
    });

    const smsResult = await sendSms({
      to: smsTo,
      message: smsMessage,
    });
    console.log("[preorders][submit] sms dispatch result", {
      preorderId,
      smsTo,
      accepted: smsResult.accepted,
      provider: smsResult.provider,
      error: smsResult.errorMessage || null,
    });

    const persistedMessageStatus = smsResult.accepted ? "SENT" : "FAILED";
    const uiSmsStatus = smsResult.accepted ? "sent" : "failed";

    await prisma.$transaction(async (tx) => {
      for (const it of summary.items) {
        await tx.preorderItem.update({
          where: {
            preorderId_productId: {
              preorderId,
              productId: it.productId,
            },
          },
          data: {
            productSkuSnapshot: it.sku || null,
            productNameSnapshot: it.nom || null,
            prixCatalogueFcfa:
              it.prixCatalogueFcfa != null
                ? it.prixCatalogueFcfa
                : it.prixUnitaireFcfa,
            discountPercent: String(
              Number(it.discountPercent != null ? it.discountPercent : 0).toFixed(2),
            ),
            prixUnitaireFcfa: it.prixUnitaireFcfa,
            ccUnitaire: String(Number(it.ccUnitaire || 0).toFixed(3)),
            poidsUnitaireKg: String(Number(it.poidsUnitaireKg || 0).toFixed(3)),
            lineTotalFcfa: it.lineTotalFcfa,
            lineTotalCc: String(Number(it.lineTotalCc || 0).toFixed(3)),
            lineTotalPoids: String(Number(it.lineTotalPoids || 0).toFixed(3)),
          },
        });
      }

      await tx.preorder.update({
        where: { id: preorderId },
        data: {
          status: "SUBMITTED",
          paymentStatus: "UNPAID",
          billingWorkStatus: "QUEUED",
          billingQueueEnteredAt: now,
          billingSlaDeadlineAt: sla,
          totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
          totalPoidsKg: String(Number(summary.totals.totalPoidsKg || 0).toFixed(3)),
          totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
          fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
          totalFcfa: summary.totals.totalFcfa || 0,
          factureWhatsappTo: smsTo,
          whatsappMessage: smsMessage,
          lastWhatsappStatus: persistedMessageStatus,
          lastWhatsappStatusAt: now,
          lastWhatsappMessageId: smsResult.providerMessageId || null,
          submittedAt: now,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId,
          action: "SUBMIT",
          note: "Précommande soumise",
          meta: {
            preorderNumber:
              summary?.preorder?.preorderNumber || preorder.preorderNumber,
            preorderPaymentMode:
              summary?.preorder?.preorderPaymentMode ||
              preorder.preorderPaymentMode ||
              null,
            totalFcfa: summary.totals.totalFcfa || 0,
            itemsCount: summary.items.length,
            smsTo,
            smsStatus: uiSmsStatus,
            smsProvider: smsResult.provider,
            smsError: smsResult.errorMessage || null,
          },
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId,
          action: "ENQUEUE_BILLING",
          note: "Précommande ajoutée à la file de facturation",
          meta: {
            billingWorkStatus: "QUEUED",
            billingSlaDeadlineAt: sla.toISOString(),
          },
        },
      });
    });

    return res.json({
      preorderId,
      preorderNumber:
        summary?.preorder?.preorderNumber || preorder.preorderNumber,
      status: "SUBMITTED",
      billingWorkStatus: "QUEUED",
      totals: summary.totals,
      smsTo,
      smsStatus: uiSmsStatus,
      smsLastError: smsResult.errorMessage || null,
      smsLastSentAt: smsResult.accepted ? now.toISOString() : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur submit" });
  }
}

async function notifySms(req, res) {
  const preorderId = req.params.id;
  const { phoneRaw, phoneNormalized } = req.body || {};

  try {
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      include: {
        country: true,
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (!["SUBMITTED", "INVOICED", "PAYMENT_PENDING"].includes(String(preorder.status || ""))) {
      return res.status(400).json({ error: "Précommande non éligible au renvoi SMS." });
    }

    const smsTo = normalizePhone(phoneNormalized || phoneRaw || preorder.factureWhatsappTo);
    if (!smsTo) {
      return res.status(400).json({ error: "Aucun numéro disponible pour le SMS." });
    }
    if (isBillingNumber(smsTo)) {
      return res.status(400).json({
        error:
          "Le numéro de téléphone client est invalide. Veuillez saisir le numéro de l'utilisateur.",
      });
    }

    const smsMessage =
      preorder.whatsappMessage ||
      buildPreorderSmsMessage({
        preorder,
        totals: {
          totalFcfa: preorder.totalFcfa,
        },
      });

    const now = new Date();
    const smsResult = await sendSms({
      to: smsTo,
      message: smsMessage,
    });
    console.log("[preorders][notifySms] sms dispatch result", {
      preorderId,
      smsTo,
      accepted: smsResult.accepted,
      provider: smsResult.provider,
      error: smsResult.errorMessage || null,
    });

    const persistedMessageStatus = smsResult.accepted ? "SENT" : "FAILED";
    const uiSmsStatus = smsResult.accepted ? "sent" : "failed";

    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: preorder.id },
        data: {
          factureWhatsappTo: smsTo,
          whatsappMessage: smsMessage,
          lastWhatsappStatus: persistedMessageStatus,
          lastWhatsappStatusAt: now,
          lastWhatsappMessageId: smsResult.providerMessageId || null,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: preorder.id,
          action: "PAYMENT_PENDING",
          note: smsResult.accepted
            ? "SMS renvoyé"
            : "Échec du renvoi SMS",
          meta: {
            smsTo,
            smsStatus: uiSmsStatus,
            smsProvider: smsResult.provider,
            smsError: smsResult.errorMessage || null,
          },
        },
      });
    });

    return res.json({
      preorderId: preorder.id,
      smsTo,
      smsStatus: uiSmsStatus,
      smsLastError: smsResult.errorMessage || null,
      smsLastSentAt: smsResult.accepted ? now.toISOString() : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur notifySms" });
  }
}

async function getSmsStatus(req, res) {
  const preorderId = req.params.id;

  try {
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      select: {
        id: true,
        lastWhatsappMessageId: true,
        lastWhatsappStatus: true,
        lastWhatsappStatusAt: true,
        factureWhatsappTo: true,
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    const resourceUrl = preorder.lastWhatsappMessageId;
    if (!resourceUrl || !String(resourceUrl).startsWith("http")) {
      return res.json({
        preorderId: preorder.id,
        smsTo: preorder.factureWhatsappTo || null,
        smsStatus: mapSmsStatus(preorder.lastWhatsappStatus),
        smsProviderStatus: preorder.lastWhatsappStatus || null,
        smsLastSentAt: preorder.lastWhatsappStatusAt || null,
        source: "db_only",
      });
    }

    const statusResult = await fetchSmsStatus({ resourceUrl });
    const now = new Date();

    let smsStatus = mapSmsStatus(preorder.lastWhatsappStatus);
    let smsProviderStatus = preorder.lastWhatsappStatus || null;
    let smsLastSentAt = preorder.lastWhatsappStatusAt || null;

    if (statusResult.ok) {
      const persisted = mapDeliveryToPersistedStatus(statusResult.deliveryStatus);
      if (persisted) {
        await prisma.preorder.update({
          where: { id: preorder.id },
          data: {
            lastWhatsappStatus: persisted,
            lastWhatsappStatusAt: now,
          },
        });
        smsStatus = mapSmsStatus(persisted);
        smsProviderStatus = statusResult.providerStatus || persisted;
        smsLastSentAt = now;
      } else {
        smsStatus = statusResult.deliveryStatus === "unknown" ? smsStatus : statusResult.deliveryStatus;
        smsProviderStatus = statusResult.providerStatus || smsProviderStatus;
      }
    }

    return res.json({
      preorderId: preorder.id,
      smsTo: preorder.factureWhatsappTo || null,
      smsStatus,
      smsProviderStatus,
      smsLastSentAt,
      smsLastError: statusResult.ok ? null : statusResult.error || null,
      source: statusResult.ok ? "orange_status_api" : "orange_status_api_error",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur getSmsStatus" });
  }
}

module.exports = {
  createDraft,
  getCatalog,
  setItems,
  getSummary,
  submit,
  notifySms,
  getSmsStatus,
};
