const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const multer = require("multer");
const prisma = require("../prisma");
const { publishRealtimeEvent } = require("../services/realtime-events.service");
const { uploadFile } = require("../services/cloudinary");
const { getPaymentExpiryHours } = require("../services/notification-template-defaults");
const { streamBankProofFileToResponse } = require("../utils/bankProofFiles");
const paymentsService = require("../payments/payments.service");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const BANK_PROOF_TMP_DIR = path.join(os.tmpdir(), "appfbo-bank-proofs");
const PROOF_PAYMENT_MODES = new Set(["BANK_TRANSFER", "ECOBANK_PAY"]);

function isProofPaymentMode(mode) {
  return PROOF_PAYMENT_MODES.has(String(mode || "").trim().toUpperCase());
}

function ensureBankProofTmpDir() {
  fs.mkdirSync(BANK_PROOF_TMP_DIR, { recursive: true });
}

function buildTempBankProofFilename(originalName = "") {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  const safeExt = [".jpg", ".jpeg", ".png", ".pdf"].includes(ext) ? ext : "";
  return `bank-proof-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safeExt}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureBankProofTmpDir();
        cb(null, BANK_PROOF_TMP_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, buildTempBankProofFilename(file?.originalname));
    },
  }),
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
  const explicitPaymentExpiresAt = order?.paymentExpiresAt
    ? new Date(order.paymentExpiresAt)
    : null;
  const paymentExpiresAt =
    explicitPaymentExpiresAt && !Number.isNaN(explicitPaymentExpiresAt.getTime())
      ? explicitPaymentExpiresAt
      : invoicedAt && !Number.isNaN(invoicedAt.getTime())
      ? new Date(invoicedAt.getTime() + paymentExpiryHours * 60 * 60 * 1000)
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
    paymentExpiryHours: resolvedPaymentExpiryHours,
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
  const explicitPaymentExpiresAt = order?.paymentExpiresAt
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
    paymentExpiryHours: resolvedPaymentExpiryHours,
    paymentExpiresAt,
    ecobankPay:
      String(order?.preorderPaymentMode || "").trim().toUpperCase() === "ECOBANK_PAY"
        ? {
            merchantName: order?.country?.settings?.ecobankPayMerchantName || null,
            merchantId: order?.country?.settings?.ecobankPayMerchantId || null,
            terminalName: order?.country?.settings?.ecobankPayTerminalName || null,
            terminalId: order?.country?.settings?.ecobankPayTerminalId || null,
            qrImageUrl: order?.country?.settings?.ecobankPayQrImageUrl || null,
            instructions: order?.country?.settings?.ecobankPayInstructions || null,
          }
        : null,
  };
}

function maskBankProofToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return "";
  if (normalized.length <= 10) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function logBankProofRequest(req, event, data = {}, level = "log") {
  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;

  logger("[customer-bank-proof]", {
    requestId: req.requestId || null,
    method: req.method,
    path: req.originalUrl || req.url,
    event,
    ...data,
  });
}

function getResponseRequestId(req, res, error = null) {
  return (
    res?.getHeader?.("X-Request-Id") ||
    req?.requestId ||
    error?.requestId ||
    null
  );
}

async function findPublicBankProofOrder({ req, orderId, token, select }) {
  const normalizedToken = String(token || "").trim();
  const countryContext = {
    headerCountryCode: req.get?.("x-country") || null,
    resolvedCountryId: req.country?.id || req.countryId || null,
    resolvedCountryCode: req.country?.code || null,
  };

  logBankProofRequest(req, "find_order_start", {
    orderId: orderId || null,
    hasToken: Boolean(normalizedToken),
    tokenMasked: maskBankProofToken(normalizedToken),
    ...countryContext,
  });

  if (normalizedToken) {
    const resolved = await paymentsService.resolveShortBankProofUploadLink(
      normalizedToken,
      { requestId: req.requestId || null },
    );

    logBankProofRequest(req, "token_resolved", {
      requestedOrderId: orderId || null,
      resolvedOrderId: resolved.orderId,
      resolvedCountryCode: resolved.countryCode || null,
      tokenMasked: maskBankProofToken(normalizedToken),
    });

    if (orderId && resolved.orderId !== orderId) {
      logBankProofRequest(
        req,
        "token_order_mismatch",
        {
          requestedOrderId: orderId,
          resolvedOrderId: resolved.orderId,
          tokenMasked: maskBankProofToken(normalizedToken),
        },
        "warn",
      );
      const err = new Error("Lien de dépôt invalide");
      err.statusCode = 400;
      err.debugCode = "BANK_PROOF_TOKEN_ORDER_MISMATCH";
      throw err;
    }

    const order = await prisma.preorder.findFirst({
      where: { id: resolved.orderId },
      select,
    });

    logBankProofRequest(req, "find_order_by_token_result", {
      resolvedOrderId: resolved.orderId,
      found: Boolean(order),
      tokenMasked: maskBankProofToken(normalizedToken),
    });

    return order;
  }

  const order = await prisma.preorder.findFirst({
    where: {
      id: orderId,
      countryId: req.country?.id || req.countryId || undefined,
    },
    select,
  });

  logBankProofRequest(req, "find_order_by_orderid_result", {
    orderId: orderId || null,
    found: Boolean(order),
    ...countryContext,
  });

  return order;
}

async function createBankProofSubmission({
  order,
  file,
  reference,
  declaredAmountFcfa,
  note,
  source = "CUSTOMER_PORTAL",
  actorAdminId = null,
}) {
  const now = new Date();
  const ext = path.extname(file.originalname || "").toLowerCase();
  const safeExt = [".jpg", ".jpeg", ".png", ".pdf"].includes(ext) ? ext : "";
  const orderIdPart = String(order.id || "order").slice(0, 12);
  const stamp = Date.now();
  const tempFilePath = String(file?.path || "").trim();

  if (!tempFilePath) {
    const err = new Error("FICHIER_TEMPORAIRE_ABSENT");
    err.statusCode = 400;
    throw err;
  }

  let uploaded;
  try {
    const resourceType =
      String(file.mimetype || "").toLowerCase() === "application/pdf"
        ? "raw"
        : "image";
    uploaded = await uploadFile(tempFilePath, {
      folder: "appfbo/bank-proofs",
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true,
      filename_override: `${orderIdPart}-${stamp}${safeExt}`,
    });
  } finally {
    try {
      fs.unlinkSync(tempFilePath);
    } catch (_err) {
      // best effort cleanup only
    }
  }

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
              : source === "ADMIN_UPLOAD"
                ? "Preuve bancaire ajoutée par un facturier"
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
            : source === "ADMIN_UPLOAD"
              ? "Preuve de paiement bancaire ajoutée par un facturier."
              : "Preuve de paiement bancaire déposée par le client.",
        meta: {
          source,
          proofId: created.id,
          reference: reference ? String(reference).trim() : null,
          declaredAmountFcfa: amount,
          fileUrl,
        },
        actorAdminId: actorAdminId || null,
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
        paymentExpiresAt: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (!isProofPaymentMode(order.preorderPaymentMode)) {
      return res.status(400).json({ message: "Le dépôt de preuve est réservé aux paiements à preuve." });
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

    logBankProofRequest(req, "context_by_token_start", {
      tokenMasked: maskBankProofToken(token),
    });

    const resolved = await paymentsService.resolveShortBankProofUploadLink(token, {
      requestId: req.requestId || null,
    });
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
        paymentExpiresAt: true,
        bankPaymentStatus: true,
        country: {
          select: {
            code: true,
            name: true,
            settings: {
              select: {
                ecobankPayMerchantName: true,
                ecobankPayMerchantId: true,
                ecobankPayTerminalName: true,
                ecobankPayTerminalId: true,
                ecobankPayQrImageUrl: true,
                ecobankPayInstructions: true,
              },
            },
          },
        },
        bankPaymentProofs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, submittedAt: true, rejectionReason: true, originalFileName: true },
        },
      },
    });

    if (!order) {
      logBankProofRequest(
        req,
        "context_by_token_order_not_found",
        {
          resolvedOrderId: resolved.orderId,
          tokenMasked: maskBankProofToken(token),
        },
        "warn",
      );
      return res.status(404).json({
        message: "Commande introuvable",
        requestId: getResponseRequestId(req, res),
      });
    }

    if (!isProofPaymentMode(order.preorderPaymentMode)) {
      logBankProofRequest(req, "context_by_token_wrong_payment_mode", {
        orderId: order.id,
        preorderPaymentMode: order.preorderPaymentMode || null,
      });
      return res.status(400).json({
        message: "Ce lien est réservé au dépôt de preuve de paiement.",
        requestId: getResponseRequestId(req, res),
      });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();
    const canUpload =
      !paymentWindow.isExpired &&
      ["INVOICED", "PAYMENT_PENDING"].includes(status) &&
      !["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus);

    logBankProofRequest(req, "context_by_token_success", {
      orderId: order.id,
      preorderNumber: order.preorderNumber || null,
      uploadAllowed: canUpload,
      status,
      paymentStatus,
      tokenMasked: maskBankProofToken(token),
    });

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
    logBankProofRequest(
      req,
      "context_by_token_error",
      {
        tokenMasked: maskBankProofToken(req.params?.token),
        message: e.message || null,
        statusCode: e.statusCode || 500,
        debugCode: e.debugCode || null,
      },
      "error",
    );
    return res.status(e.statusCode || 500).json({
      message: e.message || "Erreur serveur (getPublicBankProofContext)",
      requestId: getResponseRequestId(req, res, e),
    });
  }
}

async function getPublicBankProofContextByOrderId(req, res) {
  try {
    const { orderId } = req.params;
    const token = String(req.query?.token || "").trim();
    if (!orderId) return res.status(400).json({ message: "orderId requis" });

    logBankProofRequest(req, "context_by_order_start", {
      orderId,
      hasToken: Boolean(token),
      tokenMasked: maskBankProofToken(token),
      headerCountryCode: req.get?.("x-country") || null,
      resolvedCountryId: req.country?.id || req.countryId || null,
      resolvedCountryCode: req.country?.code || null,
    });

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
        paymentExpiresAt: true,
        bankPaymentStatus: true,
        country: {
          select: {
            code: true,
            name: true,
            settings: {
              select: {
                ecobankPayMerchantName: true,
                ecobankPayMerchantId: true,
                ecobankPayTerminalName: true,
                ecobankPayTerminalId: true,
                ecobankPayQrImageUrl: true,
                ecobankPayInstructions: true,
              },
            },
          },
        },
        bankPaymentProofs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, submittedAt: true, rejectionReason: true, originalFileName: true },
        },
      },
    });

    if (!order) {
      logBankProofRequest(
        req,
        "context_by_order_not_found",
        {
          orderId,
          hasToken: Boolean(token),
          tokenMasked: maskBankProofToken(token),
          headerCountryCode: req.get?.("x-country") || null,
          resolvedCountryId: req.country?.id || req.countryId || null,
          resolvedCountryCode: req.country?.code || null,
        },
        "warn",
      );
      return res.status(404).json({
        message: "Commande introuvable",
        requestId: getResponseRequestId(req, res),
      });
    }

    if (!isProofPaymentMode(order.preorderPaymentMode)) {
      logBankProofRequest(req, "context_by_order_wrong_payment_mode", {
        orderId: order.id,
        preorderPaymentMode: order.preorderPaymentMode || null,
      });
      return res.status(400).json({
        message: "Ce lien est réservé au dépôt de preuve de paiement.",
        requestId: getResponseRequestId(req, res),
      });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();
    const canUpload =
      !paymentWindow.isExpired &&
      ["INVOICED", "PAYMENT_PENDING"].includes(status) &&
      !["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus);

    logBankProofRequest(req, "context_by_order_success", {
      orderId: order.id,
      preorderNumber: order.preorderNumber || null,
      uploadAllowed: canUpload,
      status,
      paymentStatus,
      hasToken: Boolean(token),
      tokenMasked: maskBankProofToken(token),
    });

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
    logBankProofRequest(
      req,
      "context_by_order_error",
      {
        orderId: req.params?.orderId || null,
        tokenMasked: maskBankProofToken(req.query?.token),
        message: e.message || null,
        statusCode: e.statusCode || 500,
        debugCode: e.debugCode || null,
      },
      "error",
    );
    return res.status(e.statusCode || 500).json({
      message: e.message || "Erreur serveur (getPublicBankProofContextByOrderId)",
      requestId: getResponseRequestId(req, res, e),
    });
  }
}

async function submitPublicBankProof(req, res) {
  try {
    const { token } = req.params;
    const { reference, declaredAmountFcfa, note } = req.body || {};
    const file = req.file;

    if (!token) return res.status(400).json({ message: "token requis", requestId: getResponseRequestId(req, res) });
    if (!file) return res.status(400).json({ message: "Fichier preuve requis", requestId: getResponseRequestId(req, res) });

    logBankProofRequest(req, "submit_by_token_start", {
      tokenMasked: maskBankProofToken(token),
      fileName: file?.originalname || null,
      fileSize: file?.size || null,
    });

    const resolved = await paymentsService.resolveShortBankProofUploadLink(token, {
      requestId: req.requestId || null,
    });
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
        paymentExpiresAt: true,
      },
    });

    if (!order) {
      logBankProofRequest(req, "submit_by_token_order_not_found", {
        resolvedOrderId: resolved.orderId,
        tokenMasked: maskBankProofToken(token),
      }, "warn");
      return res.status(404).json({ message: "Commande introuvable", requestId: getResponseRequestId(req, res) });
    }

    if (!isProofPaymentMode(order.preorderPaymentMode)) {
      return res.status(400).json({ message: "Le dépôt de preuve est réservé aux paiements à preuve.", requestId: getResponseRequestId(req, res) });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();

    if (paymentWindow.isExpired) {
      return res.status(400).json({ message: "Le lien sécurisé de dépôt a expiré pour cette préfacture.", requestId: getResponseRequestId(req, res) });
    }
    if (!["INVOICED", "PAYMENT_PENDING"].includes(status)) {
      return res.status(400).json({ message: "Le dépôt de preuve n'est plus disponible pour cette commande.", requestId: getResponseRequestId(req, res) });
    }
    if (["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus)) {
      return res.status(400).json({ message: "Le paiement est déjà validé pour cette commande.", requestId: getResponseRequestId(req, res) });
    }

    const proof = await createBankProofSubmission({ order, file, reference, declaredAmountFcfa, note, source: "PUBLIC_BANK_PROOF_LINK" });
    logBankProofRequest(req, "submit_by_token_success", {
      orderId: order.id,
      proofId: proof.id,
      tokenMasked: maskBankProofToken(token),
    });
    return res.json({ ok: true, proof });
  } catch (e) {
    logBankProofRequest(req, "submit_by_token_error", {
      tokenMasked: maskBankProofToken(req.params?.token),
      message: e.message || null,
      statusCode: e.statusCode || 500,
      debugCode: e.debugCode || null,
    }, "error");
    return res.status(e.statusCode || 500).json({ message: e.message || "Erreur serveur (submitPublicBankProof)", requestId: getResponseRequestId(req, res, e) });
  }
}

async function submitPublicBankProofByOrderId(req, res) {
  try {
    const { orderId } = req.params;
    const { reference, declaredAmountFcfa, note, token } = req.body || {};
    const file = req.file;

    if (!orderId) return res.status(400).json({ message: "orderId requis", requestId: getResponseRequestId(req, res) });
    if (!file) return res.status(400).json({ message: "Fichier preuve requis", requestId: getResponseRequestId(req, res) });

    logBankProofRequest(req, "submit_by_order_start", {
      orderId,
      hasToken: Boolean(token),
      tokenMasked: maskBankProofToken(token),
      fileName: file?.originalname || null,
      fileSize: file?.size || null,
      headerCountryCode: req.get?.("x-country") || null,
      resolvedCountryId: req.country?.id || req.countryId || null,
      resolvedCountryCode: req.country?.code || null,
    });

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
        paymentExpiresAt: true,
      },
    });

    if (!order) return res.status(404).json({ message: "Commande introuvable", requestId: getResponseRequestId(req, res) });

    if (!isProofPaymentMode(order.preorderPaymentMode)) {
      return res.status(400).json({ message: "Le dépôt de preuve est réservé aux paiements à preuve.", requestId: getResponseRequestId(req, res) });
    }

    const paymentWindow = resolveCustomerPaymentWindow(order);
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    const status = String(order.status || "").toUpperCase();

    if (paymentWindow.isExpired) {
      return res.status(400).json({ message: "Le lien sécurisé de dépôt a expiré pour cette préfacture.", requestId: getResponseRequestId(req, res) });
    }
    if (!["INVOICED", "PAYMENT_PENDING"].includes(status)) {
      return res.status(400).json({ message: "Le dépôt de preuve n'est plus disponible pour cette commande.", requestId: getResponseRequestId(req, res) });
    }
    if (["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus)) {
      return res.status(400).json({ message: "Le paiement est déjà validé pour cette commande.", requestId: getResponseRequestId(req, res) });
    }

    const proof = await createBankProofSubmission({ order, file, reference, declaredAmountFcfa, note, source: "PUBLIC_BANK_PROOF_LINK" });
    logBankProofRequest(req, "submit_by_order_success", {
      orderId: order.id,
      proofId: proof.id,
      hasToken: Boolean(token),
      tokenMasked: maskBankProofToken(token),
    });
    return res.json({ ok: true, proof });
  } catch (e) {
    logBankProofRequest(req, "submit_by_order_error", {
      orderId: req.params?.orderId || null,
      tokenMasked: maskBankProofToken(req.body?.token),
      message: e.message || null,
      statusCode: e.statusCode || 500,
      debugCode: e.debugCode || null,
    }, "error");
    return res.status(e.statusCode || 500).json({ message: e.message || "Erreur serveur (submitPublicBankProofByOrderId)", requestId: getResponseRequestId(req, res, e) });
  }
}

module.exports = {
  uploadBankProofMiddleware,
  createBankProofSubmission,
  submitMyBankProof,
  downloadMyBankProof,
  getPublicBankProofContext,
  getPublicBankProofContextByOrderId,
  submitPublicBankProof,
  submitPublicBankProofByOrderId,
};
