const { ProductCategory } = require("@prisma/client");
const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");

const prisma = require("../../prisma");

const { scopeCreate } = require("../../helpers/countryScope");

const GRADE_PRICE_FIELDS = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];

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

function parseGradePrices(input = {}) {
  const source = input?.gradePrices && typeof input.gradePrices === "object"
    ? input.gradePrices
    : input;

  const result = {};
  const errors = [];

  for (const grade of GRADE_PRICE_FIELDS) {
    const aliases = [
      grade,
      grade.toLowerCase(),
      `prix${grade}`,
      `prix_${grade}`,
      `price${grade}`,
      `price_${grade}`,
    ];
    const raw = aliases
      .map((key) => source?.[key])
      .find((value) => value !== undefined && value !== null && String(value).trim() !== "");

    if (raw === undefined) continue;

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${grade} invalide`);
      continue;
    }
    result[grade] = Math.round(value);
  }

  return { gradePrices: result, errors };
}

async function upsertProductGradePrices(tx, { productId, countryId, gradePrices }) {
  const entries = Object.entries(gradePrices || {});
  for (const [grade, prixFcfa] of entries) {
    await tx.productGradePrice.upsert({
      where: {
        countryId_productId_grade: {
          countryId,
          productId,
          grade,
        },
      },
      create: {
        countryId,
        productId,
        grade,
        prixFcfa,
      },
      update: {
        prixFcfa,
      },
    });
  }
}

function isIntegerLike(v) {
  if (v === null || v === undefined || v === "") return false;
  return /^-?\d+$/.test(String(v).trim());
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

function productToCountryDto(product, countryId) {
  const countryProduct =
    product?.countryProducts?.find((item) => item.countryId === countryId) ||
    product?.countryProducts?.[0] ||
    null;

  return {
    ...product,
    prixBaseFcfa: countryProduct?.prixBaseFcfa ?? product.prixBaseFcfa,
    actif: countryProduct?.actif ?? product.actif,
    stockQty: countryProduct?.stockQty ?? product.stockQty,
    maxQtyPerOrder:
      countryProduct?.maxQtyPerOrder === undefined
        ? product.maxQtyPerOrder
        : countryProduct.maxQtyPerOrder,
    countryProductId: countryProduct?.id || null,
    countryId,
    gradePrices: GRADE_PRICE_FIELDS.reduce((acc, grade) => {
      const row = product?.gradePrices?.find(
        (item) => item.countryId === countryId && item.grade === grade,
      );
      acc[grade] = row ? Number(row.prixFcfa || 0) : "";
      return acc;
    }, {}),
    countryProducts: undefined,
    cc: product.cc?.toString?.() ?? String(product.cc ?? "0.000"),
    poidsKg: product.poidsKg?.toString?.() ?? String(product.poidsKg ?? "0.000"),
  };
}

const productBaseSelect = {
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
  maxQtyPerOrder: true,
  createdAt: true,
  updatedAt: true,
};

function productSelectForCountry(countryId, extra = {}) {
  return {
    ...productBaseSelect,
    ...extra,
    countryProducts: {
      where: { countryId },
      select: {
        id: true,
        countryId: true,
        prixBaseFcfa: true,
        stockQty: true,
        actif: true,
        maxQtyPerOrder: true,
      },
    },
    gradePrices: {
      where: { countryId },
      select: {
        countryId: true,
        grade: true,
        prixFcfa: true,
      },
    },
  };
}

async function upsertCountryProduct(tx, { productId, countryId, prixBaseFcfa, stockQty, actif, maxQtyPerOrder }) {
  return tx.countryProduct.upsert({
    where: {
      countryId_productId: {
        countryId,
        productId,
      },
    },
    create: {
      productId,
      countryId,
      prixBaseFcfa,
      stockQty,
      actif,
      maxQtyPerOrder,
    },
    update: {
      prixBaseFcfa,
      stockQty,
      actif,
      maxQtyPerOrder,
    },
  });
}

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
      maxQtyPerOrder,
      gradePrices,
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
    if (stockQty !== undefined && stockQty !== null && stockQty !== "" && !isIntegerLike(stockQty)) {
      return res.status(400).json({ message: "stockQty invalide" });
    }
    if (
      maxQtyPerOrder !== undefined &&
      maxQtyPerOrder !== null &&
      maxQtyPerOrder !== "" &&
      (!isIntegerLike(maxQtyPerOrder) || Number.parseInt(maxQtyPerOrder, 10) < 1)
    ) {
      return res.status(400).json({ message: "maxQtyPerOrder invalide" });
    }
    const maxQty =
      maxQtyPerOrder === undefined || maxQtyPerOrder === null || maxQtyPerOrder === ""
        ? null
        : parseStockQty(maxQtyPerOrder, null);
    const det =
      details !== undefined && details !== null ? String(details).trim() : null;
    const parsedGradePrices = parseGradePrices({ gradePrices });
    if (parsedGradePrices.errors.length) {
      return res.status(400).json({
        message: `Prix par grade invalide: ${parsedGradePrices.errors.join(", ")}`,
      });
    }

    const countryId = req.countryId;
    const normalizedSku = String(sku).trim();

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { sku: normalizedSku },
        select: { id: true },
      });

      const product = existing
        ? await tx.product.update({
            where: { id: existing.id },
            data: {
              nom: String(nom).trim(),
              cc: String(cc),
              poidsKg: String(poidsKg),
              imageUrl: imageUrl ? String(imageUrl).trim() : null,
              category: cat,
              details: det || null,
            },
            select: { id: true },
          })
        : await tx.product.create({
            data: scopeCreate(req, {
              sku: normalizedSku,
              nom: String(nom).trim(),
              prixBaseFcfa: price,
              cc: String(cc),
              poidsKg: String(poidsKg),
              actif: Boolean(actif),
              imageUrl: imageUrl ? String(imageUrl).trim() : null,
              category: cat,
              details: det || null,
              stockQty: stock,
              maxQtyPerOrder: maxQty,
            }),
            select: { id: true },
          });

      await upsertCountryProduct(tx, {
        productId: product.id,
        countryId,
        prixBaseFcfa: price,
        stockQty: stock,
        actif: Boolean(actif),
        maxQtyPerOrder: maxQty,
      });
      await upsertProductGradePrices(tx, {
        productId: product.id,
        countryId,
        gradePrices: parsedGradePrices.gradePrices,
      });

      return tx.product.findUnique({
        where: { id: product.id },
        select: productSelectForCountry(countryId),
      });
    });

    return res.status(201).json(productToCountryDto(created, countryId));
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
    const availabilityFilters = { countryId: req.countryId };

    if (q && String(q).trim()) {
      const qs = String(q).trim();
      filters.OR = [
        { nom: { contains: qs, mode: "insensitive" } },
        { sku: { contains: qs, mode: "insensitive" } },
      ];
    }

    if (actif !== undefined && actif !== "") {
      if (String(actif) === "true") availabilityFilters.actif = true;
      else if (String(actif) === "false") availabilityFilters.actif = false;
    }

    if (category && String(category).trim()) {
      const parsed = parseEnumSafe(category, ProductCategory, null);
      if (!parsed)
        return res.status(400).json({ message: "category invalide" });
      filters.category = parsed;
    }

    if (String(inStock) === "true") availabilityFilters.stockQty = { gt: 0 };
    if (String(inStock) === "false") availabilityFilters.stockQty = { lte: 0 };
    const countryId = req.countryId;
    const where = {
      ...filters,
      countryProducts: { some: availabilityFilters },
    };

    const limit = Math.min(500, Math.max(10, Number(take) || 200));

    const products = await prisma.product.findMany({
      where,
      take: limit,
      orderBy: [{ nom: "asc" }],
      select: productSelectForCountry(countryId),
    });

    return res.json(products.map((p) => productToCountryDto(p, countryId)));
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
      where: {
        id,
        countryProducts: { some: { countryId } },
      },
      select: productSelectForCountry(countryId),
    });

    if (!p) return res.status(404).json({ message: "Produit introuvable" });

    return res.json(productToCountryDto(p, countryId));
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
      maxQtyPerOrder,
      gradePrices,
    } = req.body || {};

    const productData = {
      ...(sku !== undefined ? { sku: String(sku).trim() } : {}),
      ...(nom !== undefined ? { nom: String(nom).trim() } : {}),
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
    };

    const availabilityData = {
      ...(prixBaseFcfa !== undefined
        ? { prixBaseFcfa: Number(prixBaseFcfa) }
        : {}),
      ...(actif !== undefined ? { actif: Boolean(actif) } : {}),
      ...(stockQty !== undefined
        ? { stockQty: parseStockQty(stockQty, 0) }
        : {}),
      ...(maxQtyPerOrder !== undefined
        ? {
            maxQtyPerOrder:
              maxQtyPerOrder === null || maxQtyPerOrder === ""
                ? null
                : parseStockQty(maxQtyPerOrder, null),
          }
        : {}),
    };

    if (
      "prixBaseFcfa" in availabilityData &&
      (!Number.isFinite(availabilityData.prixBaseFcfa) || availabilityData.prixBaseFcfa < 0)
    ) {
      return res.status(400).json({ message: "prixBaseFcfa invalide" });
    }
    const parsedGradePrices = parseGradePrices({ gradePrices });
    if (parsedGradePrices.errors.length) {
      return res.status(400).json({
        message: `Prix par grade invalide: ${parsedGradePrices.errors.join(", ")}`,
      });
    }
    if ("sku" in productData && !productData.sku)
      return res.status(400).json({ message: "sku invalide" });
    if ("nom" in productData && !productData.nom)
      return res.status(400).json({ message: "nom invalide" });

    if ("cc" in productData && !isDecimalLike(productData.cc))
      return res.status(400).json({ message: "cc invalide" });
    if ("poidsKg" in productData && !isDecimalLike(productData.poidsKg))
      return res.status(400).json({ message: "poidsKg invalide" });
    if (
      stockQty !== undefined &&
      stockQty !== null &&
      stockQty !== "" &&
      !isIntegerLike(stockQty)
    ) {
      return res.status(400).json({ message: "stockQty invalide" });
    }
    if (
      maxQtyPerOrder !== undefined &&
      maxQtyPerOrder !== null &&
      maxQtyPerOrder !== "" &&
      (!isIntegerLike(maxQtyPerOrder) || Number.parseInt(maxQtyPerOrder, 10) < 1)
    ) {
      return res.status(400).json({ message: "maxQtyPerOrder invalide" });
    }

    const exists = await prisma.product.findFirst({
      where: { id, countryProducts: { some: { countryId } } },
      select: {
        id: true,
        prixBaseFcfa: true,
        stockQty: true,
        actif: true,
        maxQtyPerOrder: true,
        countryProducts: {
          where: { countryId },
          select: {
            prixBaseFcfa: true,
            stockQty: true,
            actif: true,
            maxQtyPerOrder: true,
          },
        },
      },
    });
    if (!exists)
      return res.status(404).json({ message: "Produit introuvable" });

    const currentAvailability = exists.countryProducts?.[0] || exists;
    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(productData).length) {
        await tx.product.update({
          where: { id: exists.id },
          data: productData,
        });
      }

      await upsertCountryProduct(tx, {
        productId: exists.id,
        countryId,
        prixBaseFcfa:
          availabilityData.prixBaseFcfa !== undefined
            ? availabilityData.prixBaseFcfa
            : Number(currentAvailability.prixBaseFcfa || 0),
        stockQty:
          availabilityData.stockQty !== undefined
            ? availabilityData.stockQty
            : Number(currentAvailability.stockQty || 0),
        actif:
          availabilityData.actif !== undefined
            ? availabilityData.actif
            : Boolean(currentAvailability.actif),
        maxQtyPerOrder:
          availabilityData.maxQtyPerOrder !== undefined
            ? availabilityData.maxQtyPerOrder
            : currentAvailability.maxQtyPerOrder,
      });
      await upsertProductGradePrices(tx, {
        productId: exists.id,
        countryId,
        gradePrices: parsedGradePrices.gradePrices,
      });

      return tx.product.findUnique({
        where: { id: exists.id },
        select: productSelectForCountry(countryId),
      });
    });

    return res.json(productToCountryDto(updated, countryId));
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

    const availability = await prisma.countryProduct.findUnique({
      where: {
        countryId_productId: {
          countryId,
          productId: id,
        },
      },
      select: {
        id: true,
        product: {
          select: { id: true, sku: true },
        },
      },
    });
    if (!availability) return res.status(404).json({ message: "Produit introuvable" });

    await prisma.countryProduct.delete({ where: { id: availability.id } });
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
      const maxQtyPerOrderRaw =
        r.maxQtyPerOrder ?? r.maxqtyperorder ?? r.maxQty ?? r.maxqty ?? r.limiteParCommande;
      const maxQtyPerOrder =
        maxQtyPerOrderRaw === undefined ||
        maxQtyPerOrderRaw === null ||
        String(maxQtyPerOrderRaw).trim() === ""
          ? null
          : parseStockQty(maxQtyPerOrderRaw, null);
      const parsedGradePrices = parseGradePrices(r);

      const rowErr = [];
      if (!sku) rowErr.push("sku manquant");
      if (!nom) rowErr.push("nom manquant");
      if (!Number.isFinite(prixBaseFcfa) || prixBaseFcfa < 0)
        rowErr.push("prixBaseFcfa invalide");
      if (!isDecimalLike(cc)) rowErr.push("cc invalide");
      if (!isDecimalLike(poidsKg)) rowErr.push("poidsKg invalide");
      if (
        (r.stockQty ?? r.stock ?? r.quantite) !== undefined &&
        (r.stockQty ?? r.stock ?? r.quantite) !== null &&
        String(r.stockQty ?? r.stock ?? r.quantite).trim() !== "" &&
        (!isIntegerLike(r.stockQty ?? r.stock ?? r.quantite) ||
          Number.parseInt(r.stockQty ?? r.stock ?? r.quantite, 10) < 0)
      ) {
        rowErr.push("stockQty invalide");
      }
      if (
        maxQtyPerOrderRaw !== undefined &&
        maxQtyPerOrderRaw !== null &&
        String(maxQtyPerOrderRaw).trim() !== "" &&
        (!isIntegerLike(maxQtyPerOrderRaw) ||
          Number.parseInt(maxQtyPerOrderRaw, 10) < 1)
      ) {
        rowErr.push("maxQtyPerOrder invalide");
      }
      rowErr.push(...parsedGradePrices.errors);

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
        maxQtyPerOrder,
        gradePrices: parsedGradePrices.gradePrices,
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
          select: { id: true },
        });

        if (exists) {
          await tx.product.update({
            where: { sku: p.sku },
            data: {
              nom: p.nom,
              cc: String(p.cc),
              poidsKg: String(p.poidsKg),
              imageUrl: p.imageUrl,
              category: p.category,
              details: p.details,
            },
          });
          await upsertCountryProduct(tx, {
            productId: exists.id,
            countryId,
            prixBaseFcfa: p.prixBaseFcfa,
            stockQty: p.stockQty,
            actif: p.actif,
            maxQtyPerOrder: p.maxQtyPerOrder,
          });
          await upsertProductGradePrices(tx, {
            productId: exists.id,
            countryId,
            gradePrices: p.gradePrices,
          });
          updated++;
        } else {
          const createdProduct = await tx.product.create({
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
              maxQtyPerOrder: p.maxQtyPerOrder,
            },
            select: { id: true },
          });
          await upsertCountryProduct(tx, {
            productId: createdProduct.id,
            countryId,
            prixBaseFcfa: p.prixBaseFcfa,
            stockQty: p.stockQty,
            actif: p.actif,
            maxQtyPerOrder: p.maxQtyPerOrder,
          });
          await upsertProductGradePrices(tx, {
            productId: createdProduct.id,
            countryId,
            gradePrices: p.gradePrices,
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
        where: {
          id,
          countryProducts: { some: { countryId } },
        },
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

async function copyProductsFromCountry(req, res) {
  try {
    const sourceCode = String(req.body?.sourceCode || "CIV").trim().toUpperCase();
    const overwrite = Boolean(req.body?.overwrite);
    const requestedDestinations = Array.isArray(req.body?.destinationCodes)
      ? req.body.destinationCodes
          .map((code) => String(code || "").trim().toUpperCase())
          .filter(Boolean)
      : [];

    const sourceCountry = await prisma.country.findUnique({
      where: { code: sourceCode },
      select: { id: true, code: true, name: true },
    });
    if (!sourceCountry) {
      return res.status(404).json({ message: `Pays source introuvable: ${sourceCode}` });
    }

    const destinationCountries = await prisma.country.findMany({
      where: {
        actif: true,
        code: requestedDestinations.length
          ? { in: requestedDestinations.filter((code) => code !== sourceCode) }
          : { not: sourceCode },
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });

    if (!destinationCountries.length) {
      return res.status(400).json({ message: "Aucun pays cible actif" });
    }

    const sourceRows = await prisma.countryProduct.findMany({
      where: { countryId: sourceCountry.id },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            nom: true,
          },
        },
      },
      orderBy: { product: { nom: "asc" } },
    });

    if (!sourceRows.length) {
      return res.status(400).json({ message: "Aucun produit disponible dans le pays source" });
    }

    const summary = [];

    await prisma.$transaction(async (tx) => {
      for (const country of destinationCountries) {
        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const row of sourceRows) {
          const existing = await tx.countryProduct.findUnique({
            where: {
              countryId_productId: {
                countryId: country.id,
                productId: row.productId,
              },
            },
            select: { id: true },
          });

          if (existing && !overwrite) {
            skipped++;
            continue;
          }

          await tx.countryProduct.upsert({
            where: {
              countryId_productId: {
                countryId: country.id,
                productId: row.productId,
              },
            },
            create: {
              countryId: country.id,
              productId: row.productId,
              prixBaseFcfa: row.prixBaseFcfa,
              stockQty: 0,
              actif: row.actif,
              maxQtyPerOrder: row.maxQtyPerOrder,
            },
            update: {
              prixBaseFcfa: row.prixBaseFcfa,
              actif: row.actif,
              maxQtyPerOrder: row.maxQtyPerOrder,
              ...(overwrite ? { stockQty: 0 } : {}),
            },
          });

          if (existing) updated++;
          else created++;
        }

        summary.push({
          countryCode: country.code,
          countryName: country.name,
          created,
          updated,
          skipped,
        });
      }
    });

    return res.json({
      ok: true,
      sourceCode,
      productsCopied: sourceRows.length,
      overwrite,
      countries: summary,
    });
  } catch (e) {
    console.error("copyProductsFromCountry error:", e);
    return res.status(500).json({ message: "Erreur serveur (copyProductsFromCountry)" });
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
  copyProductsFromCountry,
};
