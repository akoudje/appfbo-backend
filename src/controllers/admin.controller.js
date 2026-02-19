// src/controllers/admin.controller.js (CommonJS)
c// src/controllers/admin.controller.js (CommonJS)
const { PrismaClient } = require("@prisma/client");
const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
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

/**
 * GET /api/admin/orders?status=&q=&dateFrom=&dateTo=&page=&pageSize=&sort=createdAt|total&dir=asc|desc
 */
async function listOrders(req, res) {
  try {
    const { status, q, dateFrom, dateTo, sort = "createdAt", dir = "desc" } = req.query;

    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(10, parseIntSafe(req.query.pageSize, 20)));
    const skip = (page - 1) * pageSize;

    const where = {};

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
    orderBy[sort === "total" ? "totalFcfa" : "createdAt"] = dir === "asc" ? "asc" : "desc";

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

    const order = await prisma.preorder.findUnique({
      where: { id },
      include: {
        items: {
          include: { product: true },
          orderBy: { createdAt: "asc" },
        },
        fbo: true,
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
 */
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!status) return res.status(400).json({ message: "status requis" });

    const patch = { status };
    if (status === "SUBMITTED") patch.submittedAt = new Date();
    if (status === "PAID") patch.paidAt = new Date();

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

    return res.json(updated);
  } catch (e) {
    console.error("updateOrderStatus error:", e);
    return res.status(500).json({ message: "Erreur serveur (updateOrderStatus)" });
  }
}

/**
 * POST /api/admin/orders/:id/invoice
 */
async function invoiceOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await prisma.preorder.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    const ref = `INV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(order.fboNumero || "")
      .replaceAll("-", "")
      .trim()}`;

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "INVOICED",
        factureReference: ref,
      },
      select: {
        id: true,
        status: true,
        factureReference: true,
        totalFcfa: true,
        updatedAt: true,
      },
    });

    return res.json(updated);
  } catch (e) {
    console.error("invoiceOrder error:", e);
    return res.status(500).json({ message: "Erreur serveur (invoiceOrder)" });
  }
}

/**
 * POST /api/admin/orders/:id/pay
 */
async function payOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await prisma.preorder.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ message: "Commande introuvable" });

    const updated = await prisma.preorder.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        paidAt: true,
        totalFcfa: true,
        updatedAt: true,
      },
    });

    return res.json(updated);
  } catch (e) {
    console.error("payOrder error:", e);
    return res.status(500).json({ message: "Erreur serveur (payOrder)" });
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

    const where = {};
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
      where: { id: { in: ids } },
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
      period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
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
    const { sku, nom, prixBaseFcfa, cc, poidsKg, actif = true, imageUrl } = req.body || {};

    if (!sku || !String(sku).trim()) return res.status(400).json({ message: "sku requis" });
    if (!nom || !String(nom).trim()) return res.status(400).json({ message: "nom requis" });

    const price = Number(prixBaseFcfa);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "prixBaseFcfa invalide" });

    if (!isDecimalLike(cc)) return res.status(400).json({ message: "cc requis" });
    if (!isDecimalLike(poidsKg)) return res.status(400).json({ message: "poidsKg requis" });

    const created = await prisma.product.create({
      data: {
        sku: String(sku).trim(),
        nom: String(nom).trim(),
        prixBaseFcfa: price,
        cc: String(cc),
        poidsKg: String(poidsKg),
        actif: Boolean(actif),
        imageUrl: imageUrl ? String(imageUrl).trim() : null,
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
    if (String(e?.code) === "P2002") return res.status(409).json({ message: "SKU déjà utilisé" });
    return res.status(500).json({ message: "Erreur serveur (createProduct)" });
  }
}

async function listProducts(req, res) {
  try {
    const { q, actif, take } = req.query;
    const where = {};

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

// Pour productsService.getById()
async function getProductById(req, res) {
  try {
    const { id } = req.params;

    const p = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        nom: true,
        prixBaseFcfa: true,
        cc: true,
        poidsKg: true,
        actif: true,
        imageUrl: true,
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
    const { sku, nom, prixBaseFcfa, actif, imageUrl, cc, poidsKg } = req.body || {};

    const data = {
      ...(sku !== undefined ? { sku: String(sku).trim() } : {}),
      ...(nom !== undefined ? { nom: String(nom).trim() } : {}),
      ...(prixBaseFcfa !== undefined ? { prixBaseFcfa: Number(prixBaseFcfa) } : {}),
      ...(actif !== undefined ? { actif: Boolean(actif) } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl ? String(imageUrl).trim() : null } : {}),
      ...(cc !== undefined ? { cc: String(cc) } : {}),
      ...(poidsKg !== undefined ? { poidsKg: String(poidsKg) } : {}),
    };

    if ("prixBaseFcfa" in data && (!Number.isFinite(data.prixBaseFcfa) || data.prixBaseFcfa < 0)) {
      return res.status(400).json({ message: "prixBaseFcfa invalide" });
    }
    if ("sku" in data && !data.sku) return res.status(400).json({ message: "sku invalide" });
    if ("nom" in data && !data.nom) return res.status(400).json({ message: "nom invalide" });

    if ("cc" in data && !isDecimalLike(data.cc)) return res.status(400).json({ message: "cc invalide" });
    if ("poidsKg" in data && !isDecimalLike(data.poidsKg)) return res.status(400).json({ message: "poidsKg invalide" });

    const updated = await prisma.product.update({
      where: { id },
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

    const p = await prisma.product.findUnique({
      where: { id },
      select: { id: true, imageUrl: true, sku: true },
    });
    if (!p) return res.status(404).json({ message: "Produit introuvable" });

    // Option overwrite par SKU => on peut aussi supprimer l'asset cloudinary correspondant
    // folder: appfbo/products, public_id: `appfbo/products/<sku>`
    if (p.sku) {
      const publicId = `appfbo/products/${p.sku}`;
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
      } catch (_) {
        // noop
      }
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

      clean.push({ sku, nom, prixBaseFcfa, cc, poidsKg, actif, imageUrl });
    }

    if (clean.length === 0) {
      return res.status(400).json({ message: "Aucune ligne valide", errors });
    }

    let created = 0;
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      for (const p of clean) {
        const exists = await tx.product.findUnique({ where: { sku: p.sku }, select: { id: true } });

        if (exists) {
          await tx.product.update({
            where: { sku: p.sku },
            data: {
              nom: p.nom,
              prixBaseFcfa: p.prixBaseFcfa,
              cc: String(p.cc),
              poidsKg: String(p.poidsKg),
              actif: p.actif,
              imageUrl: p.imageUrl,
            },
          });
          updated++;
        } else {
          await tx.product.create({
            data: {
              sku: p.sku,
              nom: p.nom,
              prixBaseFcfa: p.prixBaseFcfa,
              cc: String(p.cc),
              poidsKg: String(p.poidsKg),
              actif: p.actif,
              imageUrl: p.imageUrl,
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
    const handler = upload.fields([
      { name: "file", maxCount: 1 },
      { name: "image", maxCount: 1 },
    ]);

    handler(req, res, async (err) => {
      if (err) return res.status(400).json({ message: err.message || "Upload échoué" });

      // vérif config cloudinary
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ message: "Cloudinary non configuré (env manquantes)" });
      }

      const { id } = req.params;

      const exists = await prisma.product.findUnique({
        where: { id },
        select: { id: true, imageUrl: true, sku: true, nom: true },
      });
      if (!exists) return res.status(404).json({ message: "Produit introuvable" });

      const file = req.files?.file?.[0] || req.files?.image?.[0];
      if (!file) return res.status(400).json({ message: "Fichier manquant (file/image)" });

      // Upload cloudinary (overwrite par SKU => 1 image stable par produit)
      const skuSafe = (exists.sku || `product_${exists.id}`).replace(/[^\w.-]/g, "_");
      const publicId = `appfbo/products/${skuSafe}`;

      let result;
      try {
        result = await uploadBufferToCloudinary(file.buffer, {
          folder: "appfbo/products",
          public_id: skuSafe, // cloudinary combine folder + public_id
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

      // expose aussi le publicId calculé si tu veux le logger/debug
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
  payOrder,

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
