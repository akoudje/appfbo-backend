const fs = require("fs");
const path = require("path");
const multer = require("multer");
const prisma = require("../prisma");
const { computePreorderTotals } = require("../services/pricing.service");
const { formatDateKey, formatPreorderNumber } = require("../helpers/preorder-number");
const { publishRealtimeEvent } = require("../services/realtime-events.service");
const {
  ensurePrivateBankProofDir,
  buildPrivateBankProofRef,
  resolveBankProofAbsolutePath,
} = require("../utils/bankProofFiles");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

function getUploadsDir() {
  return ensurePrivateBankProofDir();
}

function ensureUploadsDir() {
  return getUploadsDir();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      cb(null, ensureUploadsDir());
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".pdf"].includes(ext) ? ext : "";
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const orderId = String(req.params?.id || "order").slice(0, 12);
    cb(null, `${orderId}-${stamp}-${rand}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(String(file.mimetype || "").toLowerCase())) {
      return cb(new Error("TYPE_FICHIER_NON_SUPPORTE"));
    }
    return cb(null, true);
  },
});

function uploadBankProofMiddleware(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Le fichier dépasse la taille autorisée (8 MB)." });
    }
    if (err.message === "TYPE_FICHIER_NON_SUPPORTE") {
      return res
        .status(400)
        .json({ message: "Format non supporté. Utilisez JPG, PNG ou PDF." });
    }
    return res.status(400).json({ message: err.message || "Upload invalide" });
  });
}

async function listMyOrders(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const fboId = req.customer?.fboId;
    const rows = await prisma.preorder.findMany({
      where: {
        countryId,
        fboId,
      },
      select: {
        id: true,
        preorderNumber: true,
        status: true,
        paymentStatus: true,
        preorderPaymentMode: true,
        totalFcfa: true,
        factureReference: true,
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
      data: rows.map((row) => ({
        ...row,
        latestBankProof: row.bankPaymentProofs?.[0] || null,
      })),
    });
  } catch (e) {
    console.error("listMyOrders error:", e);
    return res.status(500).json({ message: "Erreur serveur (listMyOrders)" });
  }
}

async function getMyOrder(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const fboId = req.customer?.fboId;
    const { id } = req.params;

    const order = await prisma.preorder.findFirst({
      where: {
        id,
        countryId,
        fboId,
      },
      include: {
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
    return res.json(order);
  } catch (e) {
    console.error("getMyOrder error:", e);
    return res.status(500).json({ message: "Erreur serveur (getMyOrder)" });
  }
}

async function submitMyBankProof(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const fboId = req.customer?.fboId;
    const { id } = req.params;
    const { reference, declaredAmountFcfa, note } = req.body || {};
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "Fichier preuve requis" });
    }

    const order = await prisma.preorder.findFirst({
      where: {
        id,
        countryId,
        fboId,
      },
      select: {
        id: true,
        status: true,
        countryId: true,
        fboId: true,
        preorderNumber: true,
        preorderPaymentMode: true,
        factureReference: true,
        invoicedAt: true,
      },
    });
    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (String(order.preorderPaymentMode || "").toUpperCase() !== "BANK_TRANSFER") {
      return res
        .status(400)
        .json({ message: "Le dépôt de preuve est réservé au mode virement bancaire." });
    }

    const status = String(order.status || "").toUpperCase();
    const hasInvoiceSignal = Boolean(order.factureReference || order.invoicedAt);
    const canUploadAfterBilling = new Set([
      "INVOICED",
      "PAYMENT_PENDING",
      "PAID",
      "READY",
      "FULFILLED",
    ]);
    if (!hasInvoiceSignal && !canUploadAfterBilling.has(status)) {
      return res.status(400).json({
        message:
          "Le dépôt de preuve sera disponible après traitement par le facturier (montant final communiqué).",
      });
    }

    const now = new Date();
    const fileUrl = buildPrivateBankProofRef(path.basename(file.path));
    const parsedAmount = Number.parseInt(declaredAmountFcfa, 10);
    const amount =
      Number.isFinite(parsedAmount) && parsedAmount >= 0 ? parsedAmount : null;

    const proof = await prisma.$transaction(async (tx) => {
      const created = await tx.bankPaymentProof.create({
        data: {
          preorderId: order.id,
          countryId: order.countryId,
          fboId: order.fboId,
          status: "SUBMITTED",
          declaredAmountFcfa: amount,
          reference: reference ? String(reference).trim() : null,
          note: note ? String(note).trim() : null,
          fileUrl,
          fileMimeType: file.mimetype,
          fileSizeBytes: Number(file.size || 0),
          originalFileName: file.originalname || null,
          submittedAt: now,
        },
      });

      await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAYMENT_PENDING",
          paymentStatus: "PAYMENT_PENDING",
          billingWorkStatus: "WAITING_PAYMENT",
          billingLastActivityAt: now,
          bankPaymentStatus: "PROOF_SUBMITTED",
          manualPaymentProofUrl: fileUrl,
          manualPaymentProofNote: note ? String(note).trim() : "Preuve bancaire déposée via portail client",
          manualPaymentReference: reference ? String(reference).trim() : null,
          manualPaymentReceivedAt: now,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: order.id,
          action: "RECEIVE_MANUAL_PAYMENT_PROOF",
          note: "Preuve de paiement bancaire déposée par le client.",
          meta: {
            source: "CUSTOMER_PORTAL",
            proofId: created.id,
            reference: reference ? String(reference).trim() : null,
            declaredAmountFcfa: amount,
            fileUrl,
          },
          actorAdminId: null,
        },
      });

      return created;
    });

    publishRealtimeEvent({
      countryId,
      eventKey: "cashier_collect_new",
      orderId: order.id,
      meta: {
        status: "PAYMENT_PENDING",
        paymentStatus: "PAYMENT_PENDING",
        bankPaymentStatus: "PROOF_SUBMITTED",
      },
    });

    return res.json({
      ok: true,
      proof,
    });
  } catch (e) {
    console.error("submitMyBankProof error:", e);
    return res.status(500).json({ message: "Erreur serveur (submitMyBankProof)" });
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

      const normalizedPaymentMode = sourceOrder.preorderPaymentMode || null;
      const isRestrictedDeliveryPayment = [
        "ESPECES",
        "WAVE",
        "ORANGE_MONEY",
        "BANK_TRANSFER",
      ].includes(String(normalizedPaymentMode || "").toUpperCase());

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
          deliveryMode: isRestrictedDeliveryPayment
            ? "RETRAIT_SITE_FLP"
            : sourceOrder.deliveryMode || null,
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

async function downloadMyBankProof(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const fboId = req.customer?.fboId;
    const { id, proofId } = req.params;

    const proof = await prisma.bankPaymentProof.findFirst({
      where: {
        id: proofId,
        preorderId: id,
        countryId,
        fboId,
      },
      select: {
        id: true,
        fileUrl: true,
        fileMimeType: true,
        originalFileName: true,
      },
    });

    if (!proof) {
      return res.status(404).json({ message: "Preuve introuvable" });
    }

    const absPath = resolveBankProofAbsolutePath(proof.fileUrl);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ message: "Fichier preuve introuvable" });
    }

    const fileName = path.basename(proof.originalFileName || absPath);
    const stat = fs.statSync(absPath);

    res.setHeader("Content-Type", proof.fileMimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size || 0));
    res.setHeader("Content-Disposition", `inline; filename="${fileName.replace(/"/g, "")}"`);
    return fs.createReadStream(absPath).pipe(res);
  } catch (e) {
    console.error("downloadMyBankProof error:", e);
    return res.status(500).json({ message: "Erreur serveur (downloadMyBankProof)" });
  }
}

module.exports = {
  uploadBankProofMiddleware,
  listMyOrders,
  getMyOrder,
  submitMyBankProof,
  reorderMyOrder,
  downloadMyBankProof,
};
