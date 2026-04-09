const fs = require("fs");
const path = require("path");
const multer = require("multer");
const prisma = require("../prisma");
const { publishRealtimeEvent } = require("../services/realtime-events.service");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

function getUploadsDir() {
  return path.join(__dirname, "..", "..", "uploads", "bank-proofs");
}

function ensureUploadsDir() {
  const dir = getUploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

    const now = new Date();
    const fileUrl = `/uploads/bank-proofs/${path.basename(file.path)}`;
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

module.exports = {
  uploadBankProofMiddleware,
  listMyOrders,
  getMyOrder,
  submitMyBankProof,
};
