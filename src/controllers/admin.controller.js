// src/controllers/admin.controller.js (CommonJS)

const { PrismaClient, ProductCategory } = require("@prisma/client");
const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
});

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
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Format image non supporté (png/jpg/webp)"), ok);
  },
});

/* ===================================================================
   ORDERS
   =================================================================== */

const ALLOWED = {
  SUBMITTED: ["INVOICED", "CANCELLED"],
  INVOICED: ["PAYMENT_PROOF_RECEIVED", "CANCELLED"],
  PAYMENT_PROOF_RECEIVED: ["PAID", "CANCELLED"],
  PAID: ["READY"],
  READY: ["FULFILLED"],
  FULFILLED: [],
  CANCELLED: [],
  DRAFT: ["CANCELLED"],
};

function assertTransition(from, to) {
  const ok = (ALLOWED[from] || []).includes(to);
  if (!ok) {
    const err = new Error(`Transition invalide ${from} -> ${to}`);
    err.statusCode = 400;
    throw err;
  }
}

async function addLog(preorderId, action, note, meta) {
  try {
    await prisma.preorderLog.create({
      data: { preorderId, action, note: note || null, meta: meta || undefined },
    });
  } catch (_) {
    // noop
  }
}

/**
 * GET /api/admin/orders?status=&q=&dateFrom=&dateTo=&page=&pageSize=&sort=createdAt|total&dir=asc|desc
 */
async function listOrders(req, res) {
  try {
    const countryId = req.countryId;
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
      Math.max(10, parseIntSafe(req.query.pageSize, 20))
    );
    const skip = (page - 1) * pageSize;

    const where = { countryId };

    if (status) where.status = status;

    if (q && String(q).trim()) {
      const qs = String(q).trim();
      where.OR = [
        { fboNumero: { contains: qs, mode: "insensitive" } },
        { fboNomComplet: { contains: qs, mode: "insensitive" } },
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
    const countryId = req.countryId;

    const order = await prisma.preorder.findFirst({
      where: { id, countryId },
      include: {
        items: {
          include: { product: true },
          orderBy: { createdAt: "asc" },
        },
        fbo: true,
        logs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!order) return res.status(404).json({ message: "Commande introuvable" });
    return res.json(order);
  } catch (e) {
    console.error("getOrderById error:", e);
    return res.status(500).json({ message: "Erreur serveur (getOrderById)" });
  }
}

/**
 * PATCH /api/admin/orders/:id/status
 * ⚠️ Endpoint générique (optionnel) : verrouille les transitions.
 */
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;
    const { status: next } = req.body || {};
    if (!next) return res.status(400).json({ message: "status requis" });

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    assertTransition(order.status, next);

    const patch = { status: next };

    if (next === "SUBMITTED") patch.submittedAt = new Date();
    if (next === "INVOICED") patch.invoicedAt = new Date();
    if (next === "PAYMENT_PROOF_RECEIVED") patch.proofReceivedAt = new Date();
    if (next === "PAID") patch.paidAt = new Date();
    if (next === "READY") patch.preparedAt = new Date();
    if (next === "FULFILLED") patch.fulfilledAt = new Date();
    if (next === "CANCELLED") patch.cancelledAt = new Date();

    const updated = await prisma.preorder.update({
      where: { id },
      data: patch,
      select: {
        id: true,
        status: true,
        totalFcfa: true,
        submittedAt: true,
        paidAt: true,
        updatedAt: true,
      },
    });

    await addLog(id, "STATUS", `Status -> ${next}`, {
      from: order.status,
      to: next,
    });

    return res.json(updated);
  } catch (e) {
    console.error("updateOrderStatus error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (updateOrderStatus)" });
  }
}

/**
 * POST /api/admin/orders/:id/invoice
 * SUBMITTED -> INVOICED
 */
async function invoiceOrder(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;
    const { factureReference, paymentLink, whatsappTo, note } = req.body || {};

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    assertTransition(order.status, "INVOICED");

    const ref =
      (factureReference && String(factureReference).trim()) ||
      `PF-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(
        order.fboNumero || ""
      )
        .replaceAll("-", "")
        .trim()}`;

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "INVOICED",
        factureReference: ref,
        factureWhatsappTo: whatsappTo
          ? String(whatsappTo).trim()
          : order.factureWhatsappTo,
        paymentLink: paymentLink ? String(paymentLink).trim() : null,
        invoicedAt: new Date(),
        // invoicedBy: req.user?.id || null,
      },
    });

    await addLog(id, "INVOICE", note || "Préfacture créée", {
      paymentLink: updated.paymentLink,
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
 * ⚠️ interdit si ESPECES (pas de preuve)
 */
async function markPaymentProof(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;
    const { paymentProofUrl, paymentRef, note } = req.body || {};

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    if (order.paymentMode === "ESPECES") {
      return res.status(400).json({
        message:
          "Preuve de paiement non applicable au mode ESPECES. Utiliser Encaisser espèces (/pay).",
      });
    }

    assertTransition(order.status, "PAYMENT_PROOF_RECEIVED");

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "PAYMENT_PROOF_RECEIVED",
        paymentProofUrl: paymentProofUrl ? String(paymentProofUrl).trim() : null,
        paymentRef: paymentRef ? String(paymentRef).trim() : null,
        paymentProofNote: note ? String(note).trim() : null,
        proofReceivedAt: new Date(),
        // proofReceivedBy: req.user?.id || null,
      },
    });

    await addLog(id, "PAYMENT_PROOF_RECEIVED", note || "Preuve reçue", {
      paymentRef: updated.paymentRef,
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
 * ⚠️ interdit si ESPECES (cash = /pay)
 */
async function verifyPayment(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;
    const { note } = req.body || {};

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    if (order.paymentMode === "ESPECES") {
      return res.status(400).json({
        message:
          "Validation électronique non applicable au mode ESPECES. Utiliser Encaisser espèces (/pay).",
      });
    }

    assertTransition(order.status, "PAID");

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paymentProofNote: note ? String(note).trim() : order.paymentProofNote,
        // paymentVerifiedBy: req.user?.id || null,
      },
    });

    await addLog(id, "PAYMENT_VERIFIED", note || "Paiement vérifié", null);

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
    const countryId = req.countryId;

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    if (order.paymentMode !== "ESPECES") {
      return res.status(400).json({
        message:
          "Paiement direct autorisé uniquement pour mode ESPECES. Utiliser verify-payment pour paiements électroniques.",
      });
    }

    // Cash : on autorise depuis SUBMITTED ou INVOICED (le facturier peut encaisser direct)
    const allowedFrom = ["SUBMITTED", "INVOICED"];
    if (!allowedFrom.includes(order.status)) {
      return res.status(400).json({
        message: `Transition invalide ${order.status} -> PAID (espèces)`,
      });
    }

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });

    await addLog(id, "CASH_PAYMENT", "Paiement espèces encaissé au bureau", {
      fromStatus: order.status,
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
 */
async function prepareOrder(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;
    const { packingNote } = req.body || {};

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    assertTransition(order.status, "READY");

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "READY",
        preparedAt: new Date(),
        packingNote: packingNote ? String(packingNote).trim() : null,
        // preparedBy: req.user?.id || null,
      },
    });

    await addLog(id, "PREPARED", packingNote || "Colis prêt", null);

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
    const countryId = req.countryId;
    const { deliveryTracking, note } = req.body || {};

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    assertTransition(order.status, "FULFILLED");

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "FULFILLED",
        fulfilledAt: new Date(),
        deliveryTracking: deliveryTracking ? String(deliveryTracking).trim() : null,
        internalNote: note ? String(note).trim() : order.internalNote,
        // fulfilledBy: req.user?.id || null,
      },
    });

    await addLog(id, "FULFILLED", note || "Commande clôturée", {
      deliveryTracking: updated.deliveryTracking,
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
 * * -> CANCELLED (selon transitions)
 */
async function cancelOrder(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;
    const { reason } = req.body || {};

    const order = await prisma.preorder.findFirst({ where: { id, countryId } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    assertTransition(order.status, "CANCELLED");

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason ? String(reason).trim() : "Annulée",
        // cancelledBy: req.user?.id || null,
      },
    });

    await addLog(id, "CANCELLED", updated.cancelReason, null);

    return res.json(updated);
  } catch (e) {
    console.error("cancelOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (cancelOrder)" });
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

    const where = { countryId };
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

/* ===================================================================
   PRODUCTS
   =================================================================== */

async function createProduct(req, res) {
  try {
    const countryId = req.countryId;
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

    if (!isDecimalLike(cc)) return res.status(400).json({ message: "cc requis" });
    if (!isDecimalLike(poidsKg))
      return res.status(400).json({ message: "poidsKg requis" });

    const cat = parseEnumSafe(
      category,
      ProductCategory,
      ProductCategory.NON_CLASSE || "NON_CLASSE"
    );
    const stock = parseStockQty(stockQty, 0);
    const det =
      details !== undefined && details !== null ? String(details).trim() : null;

    const created = await prisma.product.create({
      data: {
        sku: String(sku).trim(),
        nom: String(nom).trim(),
        countryId,
        prixBaseFcfa: price,
        cc: String(cc),
        poidsKg: String(poidsKg),
        actif: Boolean(actif),
        imageUrl: imageUrl ? String(imageUrl).trim() : null,

        category: cat,
        details: det || null,
        stockQty: stock,
      },
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
      poidsKg: created.poidsKg?.toString?.() ?? String(created.poidsKg ?? "0.000"),
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
    const countryId = req.countryId;
    const { q, actif, take, category, inStock } = req.query;
    const where = { countryId };

    if (q && String(q).trim()) {
      const qs = String(q).trim();
      where.OR = [
        { nom: { contains: qs, mode: "insensitive" } },
        { sku: { contains: qs, mode: "insensitive" } },
      ];
    }

    if (actif !== undefined && actif !== "") {
      if (String(actif) === "true") where.actif = true;
      else if (String(actif) === "false") where.actif = false;
    }

    if (category && String(category).trim()) {
      const parsed = parseEnumSafe(category, ProductCategory, null);
      if (!parsed) return res.status(400).json({ message: "category invalide" });
      where.category = parsed;
    }

    if (String(inStock) === "true") where.stockQty = { gt: 0 };
    if (String(inStock) === "false") where.stockQty = { lte: 0 };

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
      }))
    );
  } catch (e) {
    console.error("listProducts error:", e);
    return res.status(500).json({ message: "Erreur serveur (listProducts)" });
  }
}

async function getProductById(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.countryId;

    const p = await prisma.product.findFirst({
      where: { id, countryId },
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
      ...(prixBaseFcfa !== undefined ? { prixBaseFcfa: Number(prixBaseFcfa) } : {}),
      ...(actif !== undefined ? { actif: Boolean(actif) } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl ? String(imageUrl).trim() : null } : {}),
      ...(cc !== undefined ? { cc: String(cc) } : {}),
      ...(poidsKg !== undefined ? { poidsKg: String(poidsKg) } : {}),

      ...(category !== undefined
        ? { category: parseEnumSafe(category, ProductCategory, ProductCategory.NON_CLASSE || "NON_CLASSE") }
        : {}),
      ...(details !== undefined ? { details: details ? String(details).trim() : null } : {}),
      ...(stockQty !== undefined ? { stockQty: parseStockQty(stockQty, 0) } : {}),
    };

    if ("prixBaseFcfa" in data && (!Number.isFinite(data.prixBaseFcfa) || data.prixBaseFcfa < 0)) {
      return res.status(400).json({ message: "prixBaseFcfa invalide" });
    }
    if ("sku" in data && !data.sku) return res.status(400).json({ message: "sku invalide" });
    if ("nom" in data && !data.nom) return res.status(400).json({ message: "nom invalide" });

    if ("cc" in data && !isDecimalLike(data.cc)) return res.status(400).json({ message: "cc invalide" });
    if ("poidsKg" in data && !isDecimalLike(data.poidsKg)) return res.status(400).json({ message: "poidsKg invalide" });

    const exists = await prisma.product.findFirst({
      where: { id, countryId },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ message: "Produit introuvable" });

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
      poidsKg: updated.poidsKg?.toString?.() ?? String(updated.poidsKg ?? "0.000"),
    });
  } catch (e) {
    console.error("updateProduct error:", e);
    if (String(e?.code) === "P2002") return res.status(409).json({ message: "SKU déjà utilisé" });
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
        ProductCategory.NON_CLASSE || "NON_CLASSE"
      );
      const details = r.details ? String(r.details).trim() : null;
      const stockQty = parseStockQty(r.stockQty ?? r.stock ?? r.quantite, 0);

      const rowErr = [];
      if (!sku) rowErr.push("sku manquant");
      if (!nom) rowErr.push("nom manquant");
      if (!Number.isFinite(prixBaseFcfa) || prixBaseFcfa < 0) rowErr.push("prixBaseFcfa invalide");
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
    return res.status(500).json({ message: "Erreur serveur (importProductsCsv)" });
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
      if (err) return res.status(400).json({ message: err.message || "Upload échoué" });

      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ message: "Cloudinary non configuré (env manquantes)" });
      }

      const { id } = req.params;

      const exists = await prisma.product.findFirst({
        where: { id, countryId },
        select: { id: true, imageUrl: true, sku: true, nom: true },
      });
      if (!exists) return res.status(404).json({ message: "Produit introuvable" });

      const file = req.files?.file?.[0] || req.files?.image?.[0];
      if (!file) return res.status(400).json({ message: "Fichier manquant (file/image)" });

      const skuSafe = (exists.sku || `product_${exists.id}`).replace(/[^\w.-]/g, "_");
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
        select: { id: true, sku: true, nom: true, imageUrl: true, updatedAt: true },
      });

      return res.json({ ...updated, cloudinaryPublicId: publicId });
    });
  } catch (e) {
    console.error("uploadProductImage error:", e);
    return res.status(500).json({ message: "Erreur serveur (uploadProductImage)" });
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

  // stats
  getStats,

  // products
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  importProductsCsv,
  uploadProductImage,
};
