const path = require("path");
const multer = require("multer");
const prisma = require("../prisma");
const { publishRealtimeEvent } = require("../services/realtime-events.service");
const { uploadBuffer } = require("../services/cloudinary");
const { getPaymentExpiryHours } = require("../services/notification-template-defaults");
const { streamBankProofFileToResponse } = require("../utils/bankProofFiles");
const paymentsService = require("../payments/payments.service");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
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
      return res.status(400).json({ message: "Format non supporté. Utilisez JPG, PNG ou PDF." });
    }
    return res.status(400).json({ message: err.message || "Upload invalide" });
  });
}

function resolveCustomerPaymentWindow(order) {
  const paymentExpiryHours = getPaymentExpiryHours();
  const invoicedAt = order?.invoicedAt ? new Date(order.invoicedAt) : null;
  const paymentExpiresAt =
    invoicedAt && !Number.isNaN(invoicedAt.getTime())
      ? new Date(invoicedAt.getTime() + paymentExpiryHours * 60 * 60 * 1000)
      : null;

  return {
    paymentExpiryHours,
    paymentExpiresAt,
    isExpired:
      paymentExpiresAt instanceof Date && !Number.isNaN(paymentExpiresAt.getTime())
        ? paymentExpiresAt.getTime() <= Date.now()
        : false,
  };
}

function buildPublicBankProofContext(order) {
  const paymentExpiryHours = getPaymentExpiryHours();
  const invoicedAt = order?.invoicedAt ? new Date(order.invoicedAt) : null;
  const paymentExpiresAt =
    invoicedAt && !Number.isNaN(invoicedAt.getTime())
      ? new Date(invoicedAt.getTime() + paymentExpiryHours * 60 * 60 * 1000).toISOString()
      : null;

  const latestProof = Array.isArray(order?.bankPaymentProofs)
    ? order.bankPaymentProofs[0] || null
    : null;

  return {
    id: order?.id || null,
    preorderNumber: order?.preorderNumber || null,
    customerName: order?.fboNomComplet || null,
    countryCode: order?.country?.code || null,
    countryName: order?.country?.name || null,
    status: order?.status || null,
    paymentStatus: order?.paymentStatus || null,
    preorderPaymentMode: order?.preorderPaymentMode || null,
    totalFcfa: order?.totalFcfa || 0,
    factureReference: order?.factureReference || null,
    paymentCollectionCode: order?.paymentCollectionCode || null,
    invoicedAt: order?.invoicedAt || null,
    bankPaymentStatus: order?.bankPaymentStatus || null,
    bankPaymentProofs: latestProof ? [latestProof] : [],
    latestBankProof: latestProof,
    paymentExpiryHours,
    paymentExpiresAt,
  };
}

async function findPublicBankProofOrder({ req, orderId, token, select }) {
  const normalizedToken = String(token || "").trim();

  if (normalizedToken) {
    const resolved = await paymentsService.resolveShortBankProofUploadLink(
      normalizedToken,
    );

    if (orderId && resolved.orderId !== orderId) {
      const err = new Error("Lien de dépôt invalide");
      err.statusCode = 400;
      throw err;
    }

    return prisma.preorder.findFirst({
      where: { id: resolved.orderId },
      select,
    });
  }

  return prisma.preorder.findFirst({
    where: {
      id: orderId,
      countryId: req.country?.id || req.countryId || undefined,
    },
    select,
  });
}

async function createBankProofSubmission({
  order,
  file,
  reference,
  declaredAmountFcfa,
  note,
  source = "CUSTOMER_PORTAL",
}) {
  const now = new Date();
  const ext = path.extname(file.originalname || "").toLowerCase();
  const safeExt = [".jpg", ".jpeg", ".png", ".pdf"].includes(ext) ? ext : "";
  const orderIdPart = String(order.id || "order").slice(0, 12);
  const stamp = Date.now();

  const uploaded = await uploadBuffer(file.buffer, {
    folder: "appfbo/bank-proofs",
    resource_type: "auto",
    use_filename: true,
    unique_filename: true,
    filename_override: `${orderIdPart}-${stamp}${safeExt}`,
  });

  const fileUrl = uploaded?.secure_url || uploaded?.url || null;
  if (!fileUrl) throw new Error("UPLOAD_PREUVE_PERSISTANTE_INDISPONIBLE");

  const parsedAmount = Number.parseInt(declaredAmountFcfa, 10);
  const amount = Number.isFinite(parsedAmount) && parsedAmount >= 0 ? parsedAmount : null;

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
        manualPaymentProofNote:
          note
            ? String(note).trim()
            : source === "PUBLIC_BANK_PROOF_LINK"
              ? "Preuve bancaire déposée via lien sécurisé"
              : "Preuve bancaire déposée via portail client",
        manualPaymentReference: reference ? String(reference).trim() : null,
        manualPaymentReceivedAt: now,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: order.id,
        action: "RECEIVE_MANUAL_PAYMENT_PROOF",
        note:
          source === "PUBLIC_BANK_PROOF_LINK"
            ? "Preuve de paiement bancaire déposée via lien sécurisé."
            : "Preuve de paiement bancaire déposée par le client.",
        meta: {
          source,
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
    countryId: order.countryId,
    eventKey: "cashier_collect_new",
    orderId: order.id,
    meta: {
      status: "PAYMENT_PENDING",
      paymentStatus: "PAYMENT_PENDING",
      bankPaymentStatus: "PROOF_SUBMITTED",
    },
  });

  return proof;
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
      where: { id, countryId, fboId },
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
      return res.status(400).json({ message: "Le dépôt de preuve est réservé au mode virement bancaire." });
    }

    const status = String(order.status || "").toUpperCase();
    const hasInvoiceSignal = Boolean(order.factureReference || order.invoicedAt);
    const canUploadAfterBilling = new Set(["INVOICED", "PAYMENT_PENDING", "PAID", "READY", "FULFILLED"]);

    if (!hasInvoiceSignal && !canUploadAfterBilling.has(status)) {
      return res.status(400).json({
        message:
          "Le dépôt de preuve sera disponible après traitement par le facturier (montant final communiqué).",
      });
    }

    const proof = await createBankProofSubmission({
      order,
      file,
      reference,
      declaredAmountFcfa,
      note,
      source: "CUSTOMER_PORTAL",
    });

    return res.json({ ok: true, proof });
  } catch (e) {
    console.error("submitMyBankProof error:", e);
    return res.status(500).json({ message: "Erreur serveur (submitMyBankProof)" });
  }
}

async function downloadMyBankProof(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const fboId = req.customer?.fboId;
    const { id, proofId } = req.params;

    const proof = await prisma.bankPaymentProof.findFirst({
      where: { id: proofId, preorderId: id, countryId, fboId },
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

    const streamed = await streamBankProofFileToResponse({
      res,
      fileUrl: proof.fileUrl,
      fileMimeType: proof.fileMimeType,
      originalFileName: proof.originalFileName,
    });

    if (!streamed) {
      return res.status(404).json({ message: "Fichier preuve introuvable" });
    }
    return undefined;
  } catch (e) {
    console.error("downloadMyBankProof error:", e);
    return res.status(500).json({ message: "Erreur serveur (downloadMyBankProof)" });
  }
}

async function getPublicBankProofContext(req, res) {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: "token requis" });

    const resolved = await paymentsService.resolveShortBankProofUploadLink(token);
    const order = await prisma.preorder.findFirst({
      where: { id: resolved.orderId },
      select: {
        id: true,
        preorderNumber: true,
        fboNomComplet: true,
        status: true,
        paymentStatus: true,
        preorderPaymentMode: true,
        totalFcfa: true,
        factureReference: true,
        paymentCollectionCode: true,
        invoicedAt: true,
        bankPaymentStatus: true,
        country: { select: { code: true, name: true } },
        bankPaymentProofs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, submittedAt: true, rejectionReason: true, originalFileName: true },
        },
      },
    });

    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    if (String(order.preorderPaymentMode || "").toUpperCase() !== "BANK_TRANSFER") {
      return res.status(400).json({ message: "Ce lien est réservé au dépôt de preuve bancaire." });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();
    const canUpload =
      !paymentWindow.isExpired &&
      ["INVOICED", "PAYMENT_PENDING"].includes(status) &&
      !["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus);

    return res.json({
      ok: true,
      order: buildPublicBankProofContext(order),
      uploadAllowed: canUpload,
      uploadBlockedReason: canUpload
        ? ""
        : paymentWindow.isExpired
          ? "La fenêtre de dépôt a expiré pour cette préfacture."
          : ["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus)
            ? "Le paiement est déjà validé pour cette commande."
            : "Le dépôt de preuve n'est plus disponible pour cette commande.",
    });
  } catch (e) {
    console.error("getPublicBankProofContext error:", e);
    return res.status(e.statusCode || 500).json({ message: e.message || "Erreur serveur (getPublicBankProofContext)" });
  }
}

async function getPublicBankProofContextByOrderId(req, res) {
  try {
    const { orderId } = req.params;
    const token = String(req.query?.token || "").trim();
    if (!orderId) return res.status(400).json({ message: "orderId requis" });

    const order = await findPublicBankProofOrder({
      req,
      orderId,
      token,
      select: {
        id: true,
        preorderNumber: true,
        fboNomComplet: true,
        status: true,
        paymentStatus: true,
        preorderPaymentMode: true,
        totalFcfa: true,
        factureReference: true,
        paymentCollectionCode: true,
        invoicedAt: true,
        bankPaymentStatus: true,
        country: { select: { code: true, name: true } },
        bankPaymentProofs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, submittedAt: true, rejectionReason: true, originalFileName: true },
        },
      },
    });

    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    if (String(order.preorderPaymentMode || "").toUpperCase() !== "BANK_TRANSFER") {
      return res.status(400).json({ message: "Ce lien est réservé au dépôt de preuve bancaire." });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();
    const canUpload =
      !paymentWindow.isExpired &&
      ["INVOICED", "PAYMENT_PENDING"].includes(status) &&
      !["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus);

    return res.json({
      ok: true,
      order: buildPublicBankProofContext(order),
      uploadAllowed: canUpload,
      uploadBlockedReason: canUpload
        ? ""
        : paymentWindow.isExpired
          ? "La fenêtre de dépôt a expiré pour cette préfacture."
          : ["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus)
            ? "Le paiement est déjà validé pour cette commande."
            : "Le dépôt de preuve n'est plus disponible pour cette commande.",
    });
  } catch (e) {
    console.error("getPublicBankProofContextByOrderId error:", e);
    return res.status(e.statusCode || 500).json({ message: e.message || "Erreur serveur (getPublicBankProofContextByOrderId)" });
  }
}

async function submitPublicBankProof(req, res) {
  try {
    const { token } = req.params;
    const { reference, declaredAmountFcfa, note } = req.body || {};
    const file = req.file;

    if (!token) return res.status(400).json({ message: "token requis" });
    if (!file) return res.status(400).json({ message: "Fichier preuve requis" });

    const resolved = await paymentsService.resolveShortBankProofUploadLink(token);
    const order = await prisma.preorder.findFirst({
      where: { id: resolved.orderId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        countryId: true,
        fboId: true,
        preorderNumber: true,
        preorderPaymentMode: true,
        factureReference: true,
        invoicedAt: true,
      },
    });

    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    if (String(order.preorderPaymentMode || "").toUpperCase() !== "BANK_TRANSFER") {
      return res.status(400).json({ message: "Le dépôt de preuve est réservé au mode virement bancaire." });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();

    if (paymentWindow.isExpired) {
      return res.status(400).json({ message: "Le lien sécurisé de dépôt a expiré pour cette préfacture." });
    }
    if (!["INVOICED", "PAYMENT_PENDING"].includes(status)) {
      return res.status(400).json({ message: "Le dépôt de preuve n'est plus disponible pour cette commande." });
    }
    if (["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus)) {
      return res.status(400).json({ message: "Le paiement est déjà validé pour cette commande." });
    }

    const proof = await createBankProofSubmission({ order, file, reference, declaredAmountFcfa, note, source: "PUBLIC_BANK_PROOF_LINK" });
    return res.json({ ok: true, proof });
  } catch (e) {
    console.error("submitPublicBankProof error:", e);
    return res.status(e.statusCode || 500).json({ message: e.message || "Erreur serveur (submitPublicBankProof)" });
  }
}

async function submitPublicBankProofByOrderId(req, res) {
  try {
    const { orderId } = req.params;
    const { reference, declaredAmountFcfa, note, token } = req.body || {};
    const file = req.file;

    if (!orderId) return res.status(400).json({ message: "orderId requis" });
    if (!file) return res.status(400).json({ message: "Fichier preuve requis" });

    const order = await findPublicBankProofOrder({
      req,
      orderId,
      token,
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        countryId: true,
        fboId: true,
        preorderNumber: true,
        preorderPaymentMode: true,
        factureReference: true,
        invoicedAt: true,
      },
    });

    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    if (String(order.preorderPaymentMode || "").toUpperCase() !== "BANK_TRANSFER") {
      return res.status(400).json({ message: "Le dépôt de preuve est réservé au mode virement bancaire." });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();

    if (paymentWindow.isExpired) {
      return res.status(400).json({ message: "Le lien sécurisé de dépôt a expiré pour cette préfacture." });
    }
    if (!["INVOICED", "PAYMENT_PENDING"].includes(status)) {
      return res.status(400).json({ message: "Le dépôt de preuve n'est plus disponible pour cette commande." });
    }
    if (["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus)) {
      return res.status(400).json({ message: "Le paiement est déjà validé pour cette commande." });
    }

    const proof = await createBankProofSubmission({ order, file, reference, declaredAmountFcfa, note, source: "PUBLIC_BANK_PROOF_LINK" });
    return res.json({ ok: true, proof });
  } catch (e) {
    console.error("submitPublicBankProofByOrderId error:", e);
    return res.status(e.statusCode || 500).json({ message: e.message || "Erreur serveur (submitPublicBankProofByOrderId)" });
  }
}

module.exports = {
  uploadBankProofMiddleware,
  submitMyBankProof,
  downloadMyBankProof,
  getPublicBankProofContext,
  getPublicBankProofContextByOrderId,
  submitPublicBankProof,
  submitPublicBankProofByOrderId,
};
