// src/controllers/admin.controller.js (CommonJS)

const { ProductCategory } = require("@prisma/client");
const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");
const prisma = require("../prisma");
const { buildPaymentWhatsAppMessage } = require("../services/whatsapp.service");

const {
  scopeWhere,
  scopeCreate,
  safeFindUniqueScoped,
  pickCountryId,
} = require("../helpers/countryScope");

/* ----------------------------- cloudinary ----------------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

/* ----------------------------- helpers ----------------------------- */
function parseIntSafe(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDateStart(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function normalizeDateEnd(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(23, 59, 59, 999);
  return dt;
}

function isDecimalLike(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  return /^-?\d+(\.\d+)?$/.test(s);
}

function parseStockQty(v, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

// Permissif: accepte "SOINS_DE_LA_PEAU" ou "Soins de la peau" ou "soins de la peau"
function parseEnumSafe(input, enumObj, fallback) {
  if (input === null || input === undefined || String(input).trim() === "") {
    return fallback;
  }

  const raw = String(input).trim();

  // si déjà exact
  const values = new Set(Object.values(enumObj));
  if (values.has(raw)) return raw;

  const normalized = raw
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[’']/g, "_")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (values.has(normalized)) return normalized;

  return fallback;
}

/* --------------------------- upload setup (memory) -------------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(
      file.mimetype,
    );
    cb(ok ? null : new Error("Format image non supporté (png/jpg/webp)"), ok);
  },
});

/* ===================================================================
   ORDERS
   =================================================================== */

const ALLOWED = {
  DRAFT: ["CANCELLED"],
  SUBMITTED: ["INVOICED", "PAID", "CANCELLED"], // PAID via cash
  INVOICED: ["PAYMENT_PROOF_RECEIVED", "PAID", "CANCELLED"], // PAID via cash
  PAYMENT_PROOF_RECEIVED: ["PAID", "CANCELLED"],
  PAID: ["READY", "CANCELLED"],
  READY: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

function assertTransition(from, to) {
  const ok = (ALLOWED[from] || []).includes(to);
  if (!ok) {
    const err = new Error(`Transition invalide ${from} -> ${to}`);
    err.statusCode = 400;
    throw err;
  }
}

async function addLogTx(tx, preorderId, action, note, meta) {
  await tx.preorderLog.create({
    data: {
      preorderId,
      action,
      note: note || null,
      meta: meta || undefined,
    },
  });
}

function actorLabel(req) {
  return req.user?.email || req.user?.id || req.user?.role || "admin";
}

/**
 * GET /api/admin/orders?status=&q=&dateFrom=&dateTo=&page=&pageSize=&sort=createdAt|total&dir=asc|desc
 */
async function listOrders(req, res) {
  try {
    const {
      status,
      q,
      dateFrom,
      dateTo,
      sort = "createdAt",
      dir = "desc",
    } = req.query;

    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const pageSize = Math.min(
      100,
      Math.max(10, parseIntSafe(req.query.pageSize, 20)),
    );
    const skip = (page - 1) * pageSize;

    const where = scopeWhere(req);
    const includeDrafts = String(req.query.includeDrafts) === "true";

    if (!status && !includeDrafts) {
      where.status = { not: "DRAFT" };
    }

    if (status) where.status = status;

    if (q && String(q).trim()) {
      const qs = String(q).trim();
      where.OR = [
        { fboNumero: { contains: qs, mode: "insensitive" } },
        { fboNomComplet: { contains: qs, mode: "insensitive" } },
        { factureReference: { contains: qs, mode: "insensitive" } },
      ];
    }

    const from = dateFrom ? normalizeDateStart(String(dateFrom)) : null;
    const to = dateTo ? normalizeDateEnd(String(dateTo)) : null;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const orderBy = {};
    orderBy[sort === "total" ? "totalFcfa" : "createdAt"] =
      dir === "asc" ? "asc" : "desc";

    const [totalCount, orders] = await Promise.all([
      prisma.preorder.count({ where }),
      prisma.preorder.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          totalFcfa: true,
          fboGrade: true,
          fboNumero: true,
          fboNomComplet: true,
          pointDeVente: true,
          paymentMode: true,
          deliveryMode: true,
          factureReference: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      data: orders,
    });
  } catch (e) {
    console.error("listOrders error:", e);
    return res.status(500).json({ message: "Erreur serveur (listOrders)" });
  }
}

/**
 * GET /api/admin/orders/:id
 */
async function getOrderById(req, res) {
  try {
    const { id } = req.params;
    const order = await safeFindUniqueScoped(
      prisma.preorder,
      req,
      id,
      {},
      {
        include: {
          items: {
            include: { product: true },
            orderBy: { createdAt: "asc" },
          },
          fbo: true,
          logs: { orderBy: { createdAt: "desc" } },
          stockMovements: {
            orderBy: { createdAt: "desc" },
            include: {
              product: { select: { id: true, sku: true, nom: true } },
            },
          },
        },
      },
    );

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    return res.json(order);
  } catch (e) {
    console.error("getOrderById error:", e);
    return res.status(500).json({ message: "Erreur serveur (getOrderById)" });
  }
}

/**
 * PATCH /api/admin/orders/:id/status
 * Déconseillé en prod métier. Garde-le seulement si nécessaire en interne.
 */
async function updateOrderStatus(req, res) {
  return res.status(400).json({
    message:
      "Endpoint générique désactivé. Utiliser les endpoints métier dédiés.",
  });
}

/**
 * POST /api/admin/orders/:id/invoice
 * SUBMITTED -> INVOICED
 */
async function invoiceOrder(req, res) {
  try {
    const { id } = req.params;
    const { factureReference, whatsappTo, note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (
      [
        "INVOICED",
        "PAYMENT_PROOF_RECEIVED",
        "PAID",
        "READY",
        "FULFILLED",
      ].includes(order.status)
    ) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "INVOICED");

    if (!order.items || order.items.length === 0) {
      return res
        .status(400)
        .json({ message: "Impossible de facturer une commande vide." });
    }

    const ref =
      (factureReference && String(factureReference).trim()) ||
      `PF-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(
        order.fboNumero || "",
      )
        .replaceAll("-", "")
        .trim()}`;

    const now = new Date();

    const nextWhatsappTo = whatsappTo
      ? String(whatsappTo).trim()
      : order.factureWhatsappTo;

    let generatedPaymentLink = null;
    let generatedPaymentRef = null;
    let paymentWhatsappMessage = order.whatsappMessage || null;
    let invoiceLogNote = note || "Préfacture créée";
    let paymentProvider = null;
    let paymentFlow = null;

    if (order.paymentMode !== "ESPECES") {
      const { createPaydunyaPayment } = require("../services/paydunya.service");
      const {
        buildPaymentWhatsAppMessage,
      } = require("../services/whatsapp.service");

      const payment = await createPaydunyaPayment({
        orderId: order.id,
        amount: order.totalFcfa,
        description: `Précommande ${order.fboNumero} - ${order.totalFcfa} FCFA`,
        customerName: order.fboNomComplet,
        customerPhone: nextWhatsappTo || undefined,
        customData: {
          preorderId: order.id,
          fboNumero: order.fboNumero,
          countryId: order.countryId,
        },
      });

      generatedPaymentLink = payment.paymentUrl;
      generatedPaymentRef = payment.token;
      paymentProvider = "PAYDUNYA";
      paymentFlow = "AUTO";

      paymentWhatsappMessage = buildPaymentWhatsAppMessage({
        fboNomComplet: order.fboNomComplet,
        fboNumero: order.fboNumero,
        factureReference: ref,
        totalFcfa: order.totalFcfa,
        paymentLink: generatedPaymentLink,
        paymentMode: order.paymentMode,
      });

      if (!note) {
        invoiceLogNote = "Préfacture créée via PayDunya";
      }
    } else {
      const {
        buildPaymentWhatsAppMessage,
      } = require("../services/whatsapp.service");

      paymentProvider = "CASH";
      paymentFlow = "MANUAL";

      paymentWhatsappMessage = buildPaymentWhatsAppMessage({
        fboNomComplet: order.fboNomComplet,
        fboNumero: order.fboNumero,
        factureReference: ref,
        totalFcfa: order.totalFcfa,
        paymentLink: null,
        paymentMode: order.paymentMode,
      });

      if (!note) {
        invoiceLogNote = "Préfacture créée - paiement en espèces";
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "INVOICED",
          factureReference: ref,
          factureWhatsappTo: nextWhatsappTo,
          paymentLink: generatedPaymentLink,
          paymentRef: generatedPaymentRef,
          whatsappMessage: paymentWhatsappMessage,
          invoicedAt: order.invoicedAt || now,
          invoicedBy: order.invoicedBy || actorLabel(req),
          invoicedById: order.invoicedById || req.user?.id || null,
        },
      });

      await addLogTx(tx, id, "INVOICE", invoiceLogNote, {
        fromStatus: order.status,
        toStatus: "INVOICED",
        factureReference: saved.factureReference,
        paymentLink: saved.paymentLink,
        paymentRef: saved.paymentRef,
        paymentMode: order.paymentMode,
        paymentProvider,
        paymentFlow,
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("invoiceOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (invoiceOrder)" });
  }
}
/**
 * POST /api/admin/orders/:id/proof
 * INVOICED -> PAYMENT_PROOF_RECEIVED
 */
async function markPaymentProof(req, res) {
  try {
    const { id } = req.params;
    const { paymentProofUrl, paymentRef, note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.paymentMode === "ESPECES") {
      return res.status(400).json({
        message:
          "Preuve de paiement non applicable au mode ESPECES. Utiliser /pay.",
      });
    }

    if (
      ["PAYMENT_PROOF_RECEIVED", "PAID", "READY", "FULFILLED"].includes(
        order.status,
      )
    ) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "PAYMENT_PROOF_RECEIVED");

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAYMENT_PROOF_RECEIVED",
          paymentProofUrl: paymentProofUrl
            ? String(paymentProofUrl).trim()
            : order.paymentProofUrl,
          paymentRef: paymentRef ? String(paymentRef).trim() : order.paymentRef,
          paymentProofNote: note ? String(note).trim() : order.paymentProofNote,
          proofReceivedAt: order.proofReceivedAt || new Date(),
          proofReceivedBy: order.proofReceivedBy || actorLabel(req),
          proofReceivedById: order.proofReceivedById || req.user?.id || null,
        },
      });

      await addLogTx(tx, id, "RECEIVE_PAYMENT_PROOF", note || "Preuve reçue", {
        fromStatus: order.status,
        toStatus: "PAYMENT_PROOF_RECEIVED",
        paymentRef: saved.paymentRef,
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("markPaymentProof error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (markPaymentProof)" });
  }
}

/**
 * POST /api/admin/orders/:id/verify-payment
 * PAYMENT_PROOF_RECEIVED -> PAID
 */
async function verifyPayment(req, res) {
  try {
    const { id } = req.params;
    const { note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.paymentMode === "ESPECES") {
      return res.status(400).json({
        message:
          "Validation électronique non applicable à ESPECES. Utiliser /pay.",
      });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "PAID");

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentVerifiedAt: order.paymentVerifiedAt || now,
          paidAt: order.paidAt || now,
          paymentProofNote: note ? String(note).trim() : order.paymentProofNote,
          paymentVerifiedBy: order.paymentVerifiedBy || actorLabel(req),
          paymentVerifiedById:
            order.paymentVerifiedById || req.user?.id || null,
        },
      });

      await addLogTx(tx, id, "VERIFY_PAYMENT", note || "Paiement vérifié", {
        fromStatus: order.status,
        toStatus: "PAID",
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("verifyPayment error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (verifyPayment)" });
  }
}

/**
 * POST /api/admin/orders/:id/pay
 * Encaissement ESPECES (SUBMITTED|INVOICED -> PAID)
 */
async function payOrder(req, res) {
  try {
    const { id } = req.params;
    const { note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.paymentMode !== "ESPECES") {
      return res.status(400).json({
        message:
          "Paiement direct autorisé uniquement pour ESPECES. Utiliser /verify-payment pour les paiements électroniques.",
      });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    const allowedFrom = ["SUBMITTED", "INVOICED"];
    if (!allowedFrom.includes(order.status)) {
      return res.status(400).json({
        message: `Transition invalide ${order.status} -> PAID (espèces)`,
      });
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentVerifiedAt: order.paymentVerifiedAt || now,
          paidAt: order.paidAt || now,
          paymentVerifiedBy: order.paymentVerifiedBy || actorLabel(req),
          paymentVerifiedById:
            order.paymentVerifiedById || req.user?.id || null,
          internalNote: note ? String(note).trim() : order.internalNote,
        },
      });

      await addLogTx(tx, id, "MARK_PAID", note || "Paiement espèces encaissé", {
        fromStatus: order.status,
        toStatus: "PAID",
        paymentMode: order.paymentMode,
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("payOrder error:", e);
    return res.status(500).json({ message: "Erreur serveur (payOrder)" });
  }
}

/**
 * POST /api/admin/orders/:id/prepare
 * PAID -> READY
 * Décrémente le stock ICI
 */
async function prepareOrder(req, res) {
  try {
    const { id } = req.params;
    const { packingNote } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                nom: true,
                sku: true,
                countryId: true,
                actif: true,
                stockQty: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "READY");

    if (!order.items || order.items.length === 0) {
      return res
        .status(400)
        .json({ message: "Impossible de préparer une commande vide." });
    }

    if (order.stockDeductedAt) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        message: "Le stock a déjà été décrémenté pour cette commande.",
      });
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const updatedStock = await tx.product.updateMany({
          where: {
            id: item.productId,
            countryId: order.countryId,
            actif: true,
            stockQty: { gte: item.qty },
          },
          data: {
            stockQty: { decrement: item.qty },
          },
        });

        if (updatedStock.count !== 1) {
          const err = new Error(
            `Stock insuffisant pour ${item.productNameSnapshot || item.product?.nom || item.productId}`,
          );
          err.statusCode = 409;
          throw err;
        }

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            preorderId: order.id,
            type: "DEBIT",
            reason: "PREPARE_ORDER",
            qty: item.qty,
            note: "Sortie de stock lors de la préparation commande",
            meta: {
              preorderId: order.id,
              productId: item.productId,
              qty: item.qty,
            },
            createdById: req.user?.id || null,
          },
        });
      }

      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "READY",
          preparedAt: order.preparedAt || now,
          packingNote: packingNote
            ? String(packingNote).trim()
            : order.packingNote,
          preparedBy: order.preparedBy || actorLabel(req),
          preparedById: order.preparedById || req.user?.id || null,
          stockDeductedAt: order.stockDeductedAt || now,
        },
      });

      await addLogTx(tx, id, "PREPARE", packingNote || "Colis prêt", {
        fromStatus: order.status,
        toStatus: "READY",
        stockDeducted: true,
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("prepareOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (prepareOrder)" });
  }
}

/**
 * POST /api/admin/orders/:id/fulfill
 * READY -> FULFILLED
 */
async function fulfillOrder(req, res) {
  try {
    const { id } = req.params;
    const { deliveryTracking, note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.status === "FULFILLED") {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "FULFILLED");

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "FULFILLED",
          fulfilledAt: order.fulfilledAt || new Date(),
          deliveryTracking: deliveryTracking
            ? String(deliveryTracking).trim()
            : order.deliveryTracking,
          internalNote: note ? String(note).trim() : order.internalNote,
          fulfilledBy: order.fulfilledBy || actorLabel(req),
          fulfilledById: order.fulfilledById || req.user?.id || null,
        },
      });

      await addLogTx(tx, id, "FULFILL", note || "Commande clôturée", {
        fromStatus: order.status,
        toStatus: "FULFILLED",
        deliveryTracking: saved.deliveryTracking,
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("fulfillOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (fulfillOrder)" });
  }
}

/**
 * POST /api/admin/orders/:id/cancel
 * DRAFT|SUBMITTED|INVOICED|PAYMENT_PROOF_RECEIVED|PAID|READY -> CANCELLED
 * Si stock déjà sorti, rollback stock
 */
async function cancelOrder(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: {
          include: {
            product: {
              select: { id: true, nom: true, sku: true },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.status === "CANCELLED") {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "CANCELLED");

    const cancelReason =
      reason && String(reason).trim() ? String(reason).trim() : "Annulée";

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const mustRollbackStock =
        !!order.stockDeductedAt && !order.stockRestoredAt;

      if (mustRollbackStock) {
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQty: { increment: item.qty },
            },
          });

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              preorderId: order.id,
              type: "CREDIT",
              reason: "CANCEL_ORDER",
              qty: item.qty,
              note: "Retour stock suite annulation commande",
              meta: {
                preorderId: order.id,
                productId: item.productId,
                qty: item.qty,
              },
              createdById: req.user?.id || null,
            },
          });
        }
      }

      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          cancelledAt: order.cancelledAt || now,
          cancelReason,
          cancelledBy: order.cancelledBy || actorLabel(req),
          cancelledById: order.cancelledById || req.user?.id || null,
          stockRestoredAt:
            mustRollbackStock && !order.stockRestoredAt
              ? now
              : order.stockRestoredAt,
        },
      });

      await addLogTx(tx, id, "CANCEL", cancelReason, {
        fromStatus: order.status,
        toStatus: "CANCELLED",
        stockRollback: mustRollbackStock,
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("cancelOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (cancelOrder)" });
  }
}

/* ======================================================================================================
  PAYDUNYA WEBHOOK
  Point d'entrée pour les notifications de PayDunya (paiement réussi, échec, etc.)
  PayDunya enverra une requête POST à ce endpoint avec un token d'identification de paiement.
  Nous vérifions le paiement via l'API PayDunya et mettons à jour la commande en conséquence.
 ======================================================================================================= */

async function paydunyaWebhook(req, res) {
  try {
    console.log("PAYDUNYA WEBHOOK BODY:", req.body);
    console.log("PAYDUNYA WEBHOOK QUERY:", req.query);

    const token =
      req.body?.token ||
      req.body?.invoice_token ||
      req.query?.token ||
      req.body?.data?.token ||
      req.body?.data?.invoice?.token;

    const paydunyaStatus = req.body?.status || req.body?.data?.status || null;

    console.log("PAYDUNYA TOKEN DETECTED:", token);
    console.log("PAYDUNYA STATUS DETECTED:", paydunyaStatus);

    if (!token) {
      return res.status(200).json({ ok: true });
    }

    const order = await prisma.preorder.findFirst({
      where: { paymentRef: String(token) },
    });

    if (!order) {
      return res.status(200).json({ ok: true });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.status(200).json({ ok: true, alreadyDone: true });
    }

    if (String(paydunyaStatus).toLowerCase() !== "completed") {
      return res.status(200).json({
        ok: true,
        pending: true,
        status: paydunyaStatus,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt: order.paidAt || new Date(),
          paymentVerifiedAt: order.paymentVerifiedAt || new Date(),
          paymentVerifiedBy: order.paymentVerifiedBy || "PAYDUNYA_WEBHOOK",
        },
      });

      await addLogTx(
        tx,
        order.id,
        "VERIFY_PAYMENT",
        "Paiement confirmé automatiquement par PayDunya",
        {
          fromStatus: order.status,
          toStatus: "PAID",
          paymentRef: token,
          paydunyaStatus,
        },
      );
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("paydunyaWebhook error:", e);
    return res.status(200).json({ ok: true });
  }
}

/* ===================================================================
   STATS
   =================================================================== */

/**
 * GET /api/admin/stats?date=YYYY-MM-DD or dateFrom/dateTo
 */
async function getStats(req, res) {
  try {
    const countryId = req.countryId;
    const { date, dateFrom, dateTo } = req.query;

    let from = null;
    let to = null;

    if (date) {
      from = normalizeDateStart(String(date));
      to = normalizeDateEnd(String(date));
    } else {
      from = dateFrom ? normalizeDateStart(String(dateFrom)) : null;
      to = dateTo ? normalizeDateEnd(String(dateTo)) : null;
    }

    const where = { countryId, status: { not: "DRAFT" } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [agg, byStatus] = await Promise.all([
      prisma.preorder.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
      prisma.preorder.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
    ]);

    const topRaw = await prisma.preorderItem.groupBy({
      by: ["productId"],
      where: { preorder: where },
      _sum: { qty: true, lineTotalFcfa: true },
      orderBy: { _sum: { lineTotalFcfa: "desc" } },
      take: 5,
    });

    const ids = topRaw.map((x) => x.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, countryId },
      select: { id: true, nom: true, sku: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const topProducts = topRaw.map((x) => ({
      productId: x.productId,
      sku: map.get(x.productId)?.sku || "",
      nom: map.get(x.productId)?.nom || "Produit",
      qty: x._sum.qty || 0,
      revenueFcfa: x._sum.lineTotalFcfa || 0,
    }));

    return res.json({
      period: {
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      },
      totalOrders: agg._count._all,
      totalRevenueFcfa: agg._sum.totalFcfa || 0,
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
        revenueFcfa: s._sum.totalFcfa || 0,
      })),
      topProducts,
    });
  } catch (e) {
    console.error("getStats error:", e);
    return res.status(500).json({ message: "Erreur serveur (getStats)" });
  }
}

async function getCountrySettings(req, res) {
  try {
    const countryId = pickCountryId(req);
    const settings = await prisma.countrySettings.findUnique({
      where: { countryId },
      select: {
        id: true,
        countryId: true,
        minCartFcfa: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!settings) {
      return res.status(404).json({ message: "Country settings introuvables" });
    }
    return res.json(settings);
  } catch (e) {
    console.error("getCountrySettings error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (getCountrySettings)" });
  }
}

async function updateCountrySettings(req, res) {
  try {
    const countryId = pickCountryId(req);
    const { minCartFcfa } = req.body || {};
    const parsed = Number.parseInt(minCartFcfa, 10);

    if (!Number.isFinite(parsed) || parsed < 0) {
      return res.status(400).json({ message: "minCartFcfa invalide" });
    }

    const updated = await prisma.countrySettings.upsert({
      where: { countryId },
      update: { minCartFcfa: parsed },
      create: { countryId, minCartFcfa: parsed },
      select: {
        id: true,
        countryId: true,
        minCartFcfa: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json(updated);
  } catch (e) {
    console.error("updateCountrySettings error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (updateCountrySettings)" });
  }
}

/* ===================================================================
   PRODUCTS
   =================================================================== */

async function createProduct(req, res) {
  try {
    const {
      sku,
      nom,
      prixBaseFcfa,
      cc,
      poidsKg,
      actif = true,
      imageUrl,
      category,
      details,
      stockQty,
    } = req.body || {};

    if (!sku || !String(sku).trim())
      return res.status(400).json({ message: "sku requis" });
    if (!nom || !String(nom).trim())
      return res.status(400).json({ message: "nom requis" });

    const price = Number(prixBaseFcfa);
    if (!Number.isFinite(price) || price < 0)
      return res.status(400).json({ message: "prixBaseFcfa invalide" });

    if (!isDecimalLike(cc))
      return res.status(400).json({ message: "cc requis" });
    if (!isDecimalLike(poidsKg))
      return res.status(400).json({ message: "poidsKg requis" });

    const cat = parseEnumSafe(
      category,
      ProductCategory,
      ProductCategory.NON_CLASSE || "NON_CLASSE",
    );
    const stock = parseStockQty(stockQty, 0);
    const det =
      details !== undefined && details !== null ? String(details).trim() : null;

    const created = await prisma.product.create({
      data: scopeCreate(req, {
        sku: String(sku).trim(),
        nom: String(nom).trim(),
        prixBaseFcfa: price,
        cc: String(cc),
        poidsKg: String(poidsKg),
        actif: Boolean(actif),
        imageUrl: imageUrl ? String(imageUrl).trim() : null,

        category: cat,
        details: det || null,
        stockQty: stock,
      }),
      select: {
        id: true,
        sku: true,
        nom: true,
        prixBaseFcfa: true,
        cc: true,
        poidsKg: true,
        actif: true,
        imageUrl: true,

        category: true,
        details: true,
        stockQty: true,

        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      ...created,
      cc: created.cc?.toString?.() ?? String(created.cc ?? "0.000"),
      poidsKg:
        created.poidsKg?.toString?.() ?? String(created.poidsKg ?? "0.000"),
    });
  } catch (e) {
    console.error("createProduct error:", e);
    if (String(e?.code) === "P2002")
      return res.status(409).json({ message: "SKU déjà utilisé" });
    return res.status(500).json({ message: "Erreur serveur (createProduct)" });
  }
}

async function listProducts(req, res) {
  try {
    const { q, actif, take, category, inStock } = req.query;
    const filters = {};

    if (q && String(q).trim()) {
      const qs = String(q).trim();
      filters.OR = [
        { nom: { contains: qs, mode: "insensitive" } },
        { sku: { contains: qs, mode: "insensitive" } },
      ];
    }

    if (actif !== undefined && actif !== "") {
      if (String(actif) === "true") filters.actif = true;
      else if (String(actif) === "false") filters.actif = false;
    }

    if (category && String(category).trim()) {
      const parsed = parseEnumSafe(category, ProductCategory, null);
      if (!parsed)
        return res.status(400).json({ message: "category invalide" });
      filters.category = parsed;
    }

    if (String(inStock) === "true") filters.stockQty = { gt: 0 };
    if (String(inStock) === "false") filters.stockQty = { lte: 0 };
    const where = scopeWhere(req, filters);

    const limit = Math.min(500, Math.max(10, Number(take) || 200));

    const products = await prisma.product.findMany({
      where,
      take: limit,
      orderBy: [{ actif: "desc" }, { nom: "asc" }],
      select: {
        id: true,
        sku: true,
        nom: true,
        prixBaseFcfa: true,
        cc: true,
        poidsKg: true,
        actif: true,
        imageUrl: true,

        category: true,
        details: true,
        stockQty: true,

        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json(
      products.map((p) => ({
        ...p,
        cc: p.cc?.toString?.() ?? String(p.cc ?? "0.000"),
        poidsKg: p.poidsKg?.toString?.() ?? String(p.poidsKg ?? "0.000"),
      })),
    );
  } catch (e) {
    console.error("listProducts error:", e);
    return res.status(500).json({ message: "Erreur serveur (listProducts)" });
  }
}

async function getProductById(req, res) {
  try {
    const { id } = req.params;
    const p = await safeFindUniqueScoped(
      prisma.product,
      req,
      id,
      {},
      {
        select: {
          id: true,
          sku: true,
          nom: true,
          prixBaseFcfa: true,
          cc: true,
          poidsKg: true,
          actif: true,
          imageUrl: true,

          category: true,
          details: true,
          stockQty: true,

          createdAt: true,
          updatedAt: true,
        },
      },
    );

    if (!p) return res.status(404).json({ message: "Produit introuvable" });

    return res.json({
      ...p,
      cc: p.cc?.toString?.() ?? String(p.cc ?? "0.000"),
      poidsKg: p.poidsKg?.toString?.() ?? String(p.poidsKg ?? "0.000"),
    });
  } catch (e) {
    console.error("getProductById error:", e);
    return res.status(500).json({ message: "Erreur serveur (getProductById)" });
  }
}

async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;
    const {
      sku,
      nom,
      prixBaseFcfa,
      actif,
      imageUrl,
      cc,
      poidsKg,
      category,
      details,
      stockQty,
    } = req.body || {};

    const data = {
      ...(sku !== undefined ? { sku: String(sku).trim() } : {}),
      ...(nom !== undefined ? { nom: String(nom).trim() } : {}),
      ...(prixBaseFcfa !== undefined
        ? { prixBaseFcfa: Number(prixBaseFcfa) }
        : {}),
      ...(actif !== undefined ? { actif: Boolean(actif) } : {}),
      ...(imageUrl !== undefined
        ? { imageUrl: imageUrl ? String(imageUrl).trim() : null }
        : {}),
      ...(cc !== undefined ? { cc: String(cc) } : {}),
      ...(poidsKg !== undefined ? { poidsKg: String(poidsKg) } : {}),

      ...(category !== undefined
        ? {
            category: parseEnumSafe(
              category,
              ProductCategory,
              ProductCategory.NON_CLASSE || "NON_CLASSE",
            ),
          }
        : {}),
      ...(details !== undefined
        ? { details: details ? String(details).trim() : null }
        : {}),
      ...(stockQty !== undefined
        ? { stockQty: parseStockQty(stockQty, 0) }
        : {}),
    };

    if (
      "prixBaseFcfa" in data &&
      (!Number.isFinite(data.prixBaseFcfa) || data.prixBaseFcfa < 0)
    ) {
      return res.status(400).json({ message: "prixBaseFcfa invalide" });
    }
    if ("sku" in data && !data.sku)
      return res.status(400).json({ message: "sku invalide" });
    if ("nom" in data && !data.nom)
      return res.status(400).json({ message: "nom invalide" });

    if ("cc" in data && !isDecimalLike(data.cc))
      return res.status(400).json({ message: "cc invalide" });
    if ("poidsKg" in data && !isDecimalLike(data.poidsKg))
      return res.status(400).json({ message: "poidsKg invalide" });

    const exists = await prisma.product.findFirst({
      where: { id, countryId },
      select: { id: true },
    });
    if (!exists)
      return res.status(404).json({ message: "Produit introuvable" });

    const updated = await prisma.product.update({
      where: { id: exists.id },
      data,
      select: {
        id: true,
        sku: true,
        nom: true,
        prixBaseFcfa: true,
        cc: true,
        poidsKg: true,
        actif: true,
        imageUrl: true,

        category: true,
        details: true,
        stockQty: true,

        updatedAt: true,
      },
    });

    return res.json({
      ...updated,
      cc: updated.cc?.toString?.() ?? String(updated.cc ?? "0.000"),
      poidsKg:
        updated.poidsKg?.toString?.() ?? String(updated.poidsKg ?? "0.000"),
    });
  } catch (e) {
    console.error("updateProduct error:", e);
    if (String(e?.code) === "P2002")
      return res.status(409).json({ message: "SKU déjà utilisé" });
    return res.status(500).json({ message: "Erreur serveur (updateProduct)" });
  }
}

async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;

    const p = await prisma.product.findFirst({
      where: { id, countryId },
      select: { id: true, imageUrl: true, sku: true },
    });
    if (!p) return res.status(404).json({ message: "Produit introuvable" });

    if (p.sku) {
      const publicId = `appfbo/products/${p.sku}`;
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
      } catch (_) {}
    }

    await prisma.product.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteProduct error:", e);
    return res.status(500).json({ message: "Erreur serveur (deleteProduct)" });
  }
}

async function importProductsCsv(req, res) {
  try {
    const countryId = req.countryId;
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "rows requis (array)" });
    }

    const clean = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};

      const sku = (r.sku ?? "").toString().trim();
      const nom = (r.nom ?? "").toString().trim();
      const prixBaseFcfa = Number(r.prixBaseFcfa);
      const cc = (r.cc ?? "").toString().trim();
      const poidsKg = (r.poidsKg ?? "").toString().trim();
      const actif = r.actif === undefined ? true : Boolean(r.actif);
      const imageUrl = r.imageUrl ? String(r.imageUrl).trim() : null;

      const category = parseEnumSafe(
        r.category ?? r.categorie,
        ProductCategory,
        ProductCategory.NON_CLASSE || "NON_CLASSE",
      );
      const details = r.details ? String(r.details).trim() : null;
      const stockQty = parseStockQty(r.stockQty ?? r.stock ?? r.quantite, 0);

      const rowErr = [];
      if (!sku) rowErr.push("sku manquant");
      if (!nom) rowErr.push("nom manquant");
      if (!Number.isFinite(prixBaseFcfa) || prixBaseFcfa < 0)
        rowErr.push("prixBaseFcfa invalide");
      if (!isDecimalLike(cc)) rowErr.push("cc invalide");
      if (!isDecimalLike(poidsKg)) rowErr.push("poidsKg invalide");

      if (rowErr.length) {
        errors.push({ index: i + 1, sku, errors: rowErr });
        continue;
      }

      clean.push({
        sku,
        nom,
        prixBaseFcfa,
        cc,
        poidsKg,
        actif,
        imageUrl,
        category,
        details,
        stockQty,
      });
    }

    if (clean.length === 0) {
      return res.status(400).json({ message: "Aucune ligne valide", errors });
    }

    let created = 0;
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      for (const p of clean) {
        const exists = await tx.product.findUnique({
          where: { sku: p.sku },
          select: { id: true, countryId: true },
        });

        if (exists) {
          if (exists.countryId !== countryId) {
            errors.push({
              sku: p.sku,
              errors: ["SKU déjà utilisé dans un autre pays"],
            });
            continue;
          }
          await tx.product.update({
            where: { sku: p.sku },
            data: {
              nom: p.nom,
              prixBaseFcfa: p.prixBaseFcfa,
              cc: String(p.cc),
              poidsKg: String(p.poidsKg),
              actif: p.actif,
              imageUrl: p.imageUrl,

              category: p.category,
              details: p.details,
              stockQty: p.stockQty,
            },
          });
          updated++;
        } else {
          await tx.product.create({
            data: {
              sku: p.sku,
              nom: p.nom,
              countryId,
              prixBaseFcfa: p.prixBaseFcfa,
              cc: String(p.cc),
              poidsKg: String(p.poidsKg),
              actif: p.actif,
              imageUrl: p.imageUrl,

              category: p.category,
              details: p.details,
              stockQty: p.stockQty,
            },
          });
          created++;
        }
      }
    });

    return res.json({
      totalReceived: rows.length,
      totalValid: clean.length,
      created,
      updated,
      errors,
    });
  } catch (e) {
    console.error("importProductsCsv error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (importProductsCsv)" });
  }
}

async function uploadProductImage(req, res) {
  try {
    const countryId = req.countryId;
    const handler = upload.fields([
      { name: "file", maxCount: 1 },
      { name: "image", maxCount: 1 },
    ]);

    handler(req, res, async (err) => {
      if (err)
        return res
          .status(400)
          .json({ message: err.message || "Upload échoué" });

      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res
          .status(500)
          .json({ message: "Cloudinary non configuré (env manquantes)" });
      }

      const { id } = req.params;

      const exists = await prisma.product.findFirst({
        where: { id, countryId },
        select: { id: true, imageUrl: true, sku: true, nom: true },
      });
      if (!exists)
        return res.status(404).json({ message: "Produit introuvable" });

      const file = req.files?.file?.[0] || req.files?.image?.[0];
      if (!file)
        return res
          .status(400)
          .json({ message: "Fichier manquant (file/image)" });

      const skuSafe = (exists.sku || `product_${exists.id}`).replace(
        /[^\w.-]/g,
        "_",
      );
      const publicId = `appfbo/products/${skuSafe}`;

      let result;
      try {
        result = await uploadBufferToCloudinary(file.buffer, {
          folder: "appfbo/products",
          public_id: skuSafe,
          overwrite: true,
          resource_type: "image",
        });
      } catch (upErr) {
        console.error("Cloudinary upload error:", upErr);
        return res.status(400).json({ message: "Upload Cloudinary échoué" });
      }

      const updated = await prisma.product.update({
        where: { id },
        data: { imageUrl: result.secure_url },
        select: {
          id: true,
          sku: true,
          nom: true,
          imageUrl: true,
          updatedAt: true,
        },
      });

      return res.json({ ...updated, cloudinaryPublicId: publicId });
    });
  } catch (e) {
    console.error("uploadProductImage error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (uploadProductImage)" });
  }
}

/* ----------------------------- exports ----------------------------- */
module.exports = {
  // orders
  listOrders,
  getOrderById,
  updateOrderStatus,
  invoiceOrder,
  markPaymentProof,
  verifyPayment,
  payOrder,
  prepareOrder,
  fulfillOrder,
  cancelOrder,
  paydunyaWebhook,

  // stats
  getStats,
  getCountrySettings,
  updateCountrySettings,

  // products
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  importProductsCsv,
  uploadProductImage,
};
