const { ProductCategory } = require("@prisma/client");
const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");

const prisma = require("../../prisma");

const {
  scopeCreate,
  scopeWhere,
  safeFindUniqueScoped,
} = require("../../helpers/countryScope");

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

function parseEnumSafe(input, enumObj, fallback) {
  if (input === null || input === undefined || String(input).trim() === "") {
    return fallback;
  }

  const raw = String(input).trim();
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(
      file.mimetype,
    );
    cb(ok ? null : new Error("Format image non supporté (png/jpg/webp)"), ok);
  },
});

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

module.exports = {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  importProductsCsv,
  uploadProductImage,
};
