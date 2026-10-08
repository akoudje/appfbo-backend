const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");

const prisma = require("../../prisma");

const { scopeCreate } = require("../../helpers/countryScope");

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

const domain = require("../../helpers/product-domain");
const { csvCell } = require("../../helpers/order-query");
const { GRADES, fail, integer, boolean, normalize, listQuery, changed, audit } =
  domain;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(
      file.mimetype,
    );
    cb(
      ok
        ? null
        : new Error("Utilisez une image PNG, JPEG ou WebP (5 Mo maximum)."),
      ok,
    );
  },
});
function error(res, e) {
  if (e.code === "P2002")
    return res
      .status(409)
      .json({ message: "Ce SKU ou code-barres est déjà utilisé." });
  if (e.statusCode)
    return res.status(e.statusCode).json({ message: e.message });
  console.error("Products error:", e);
  return res
    .status(500)
    .json({ message: "Impossible de terminer cette opération. Réessayez." });
}
function select(countryId) {
  return {
    countryProducts: { where: { countryId } },
    gradePrices: { where: { countryId } },
    packagings: { orderBy: { unitsPerPackage: "asc" } },
  };
}
function dto(p, countryId) {
  const a = p.countryProducts?.[0];
  return {
    ...p,
    countryProducts: undefined,
    countryId,
    countryProductId: a?.id,
    countryUpdatedAt: a?.updatedAt,
    prixBaseFcfa: a?.prixBaseFcfa ?? p.prixBaseFcfa,
    stockQty: a?.stockQty ?? p.stockQty,
    actif: a?.actif ?? p.actif,
    maxQtyPerOrder: a ? a.maxQtyPerOrder : p.maxQtyPerOrder,
    cc: String(p.cc ?? "0"),
    poidsKg: String(p.poidsKg ?? "0"),
    gradePrices: Object.fromEntries(
      GRADES.map((grade) => [
        grade,
        p.gradePrices
          ?.find((row) => row.grade === grade)
          ?.prixFcfa?.toString() ?? "",
      ]),
    ),
  };
}
async function saveGrades(tx, productId, countryId, grades) {
  for (const [grade, prixFcfa] of Object.entries(grades)) {
    if (prixFcfa === null)
      await tx.productGradePrice.deleteMany({
        where: { productId, countryId, grade },
      });
    else
      await tx.productGradePrice.upsert({
        where: { countryId_productId_grade: { countryId, productId, grade } },
        create: { productId, countryId, grade, prixFcfa },
        update: { prixFcfa },
      });
  }
}
async function initialStock(tx, req, productId, qty) {
  if (qty > 0)
    await tx.stockMovement.create({
      data: {
        productId,
        countryId: req.countryId,
        type: "CREDIT",
        reason: "MANUAL_ADJUSTMENT",
        qty,
        note: "Stock initial du catalogue",
        createdById: req.user?.id || null,
        meta: { previousQty: 0, nextQty: qty, mode: "INITIAL" },
      },
    });
}
async function createProduct(req, res) {
  try {
    const { shared, local, grades } = normalize(req.body, true);
    const created = await prisma.$transaction(async (tx) => {
      const exists = await tx.product.findUnique({
        where: { sku: shared.sku },
        select: { id: true },
      });
      if (exists)
        fail(
          "Ce SKU existe déjà. Modifiez sa fiche ou ajoutez sa disponibilité par la copie de catalogue.",
          409,
        );
      const product = await tx.product.create({
        data: scopeCreate(req, {
          ...shared,
          prixBaseFcfa: local.prixBaseFcfa,
          stockQty: 0,
          actif: local.actif,
          maxQtyPerOrder: local.maxQtyPerOrder ?? null,
        }),
      });
      await tx.countryProduct.create({
        data: {
          productId: product.id,
          countryId: req.countryId,
          ...local,
          stockQty: local.stockQty ?? 0,
        },
      });
      await initialStock(tx, req, product.id, local.stockQty ?? 0);
      await saveGrades(tx, product.id, req.countryId, grades);
      await audit(tx, req, product.id, "CREATE", {
        after: { ...shared, ...local, gradePrices: grades },
      });
      return tx.product.findUnique({
        where: { id: product.id },
        include: select(req.countryId),
      });
    });
    return res.status(201).json(dto(created, req.countryId));
  } catch (e) {
    return error(res, e);
  }
}
function availabilityWhere(parsed) {
  const { countryProducts, ...productWhere } = parsed.where;
  return { ...countryProducts.some, product: { is: productWhere } };
}
async function listProducts(req, res) {
  try {
    const parsed = listQuery(req.query, req.countryId),
      where = availabilityWhere(parsed);
    const paginated =
      req.query.page !== undefined || req.query.pageSize !== undefined;
    const take = paginated
      ? parsed.pageSize
      : Math.min(500, integer(req.query.take ?? 200, "Nombre de produits", 1));
    let stats = {},
      totalCount = 0,
      page = parsed.page;
    if (paginated) {
      const [total, actifs, rupture, faible, incomplets] = await Promise.all([
        prisma.countryProduct.count({ where }),
        prisma.countryProduct.count({
          where: { AND: [where, { actif: true }] },
        }),
        prisma.countryProduct.count({
          where: { AND: [where, { stockQty: { lte: 0 } }] },
        }),
        prisma.countryProduct.count({
          where: { AND: [where, { stockQty: { gt: 0, lte: 5 } }] },
        }),
        prisma.countryProduct.count({
          where: {
            AND: [
              where,
              {
                product: {
                  is: {
                    OR: [
                      { imageUrl: null },
                      { imageUrl: "" },
                      { category: "NON_CLASSE" },
                    ],
                  },
                },
              },
            ],
          },
        }),
      ]);
      totalCount = total;
      page = Math.min(page, Math.max(1, Math.ceil(total / take)));
      stats = {
        total,
        actifs,
        inactifs: total - actifs,
        rupture,
        faible,
        incomplets,
      };
    }
    const rows = await prisma.countryProduct.findMany({
      where,
      orderBy: parsed.orderBy,
      take,
      skip: paginated ? (page - 1) * take : 0,
      include: { product: { include: select(req.countryId) } },
    });
    const items = rows.map((row) => dto(row.product, req.countryId));
    return res.json(
      paginated ? { items, totalCount, page, pageSize: take, stats } : items,
    );
  } catch (e) {
    return error(res, e);
  }
}
async function getProductById(req, res) {
  try {
    const p = await prisma.product.findFirst({
      where: {
        id: req.params.id,
        countryProducts: { some: { countryId: req.countryId } },
      },
      include: select(req.countryId),
    });
    if (!p) fail("Produit introuvable dans ce pays.", 404);
    return res.json(dto(p, req.countryId));
  } catch (e) {
    return error(res, e);
  }
}
async function lockAvailability(tx, req, productId) {
  const where = { countryId: req.countryId, productId };
  if (req.body.expectedCountryUpdatedAt) {
    const date = new Date(req.body.expectedCountryUpdatedAt);
    if (!Number.isFinite(date.getTime()))
      fail("Version de disponibilité invalide.");
    where.updatedAt = date;
  }
  const claimed = await tx.countryProduct.updateMany({
    where,
    data: {
      updatedAt: new Date(
        Math.max(Date.now(), (where.updatedAt?.getTime() || 0) + 1),
      ),
    },
  });
  if (claimed.count !== 1)
    fail(
      "La disponibilité a changé ou ce produit est absent de ce pays. Actualisez la fiche avant de réessayer.",
      409,
    );
  const productWhere = { id: productId };
  if (req.body.expectedUpdatedAt) {
    const date = new Date(req.body.expectedUpdatedAt);
    if (!Number.isFinite(date.getTime())) fail("Version de produit invalide.");
    productWhere.updatedAt = date;
  }
  const claimedProduct = await tx.product.updateMany({
    where: productWhere,
    data: {
      updatedAt: new Date(
        Math.max(Date.now(), (productWhere.updatedAt?.getTime() || 0) + 1),
      ),
    },
  });
  if (claimedProduct.count !== 1)
    fail("Cette fiche a été modifiée. Actualisez-la avant de réessayer.", 409);
}
async function updateProduct(req, res) {
  try {
    const { shared, local, grades } = normalize(req.body);
    if ("stockQty" in local)
      fail("Utilisez l’action Ajuster le stock pour modifier les quantités.");
    const updated = await prisma.$transaction(async (tx) => {
      await lockAvailability(tx, req, req.params.id);
      const before = await tx.product.findUnique({
          where: { id: req.params.id },
          include: select(req.countryId),
        }),
        previous = dto(before, req.countryId);
      const sharedChanges = changed(previous, shared),
        localChanges = changed(previous, local);
      if (Object.keys(sharedChanges).length)
        await tx.product.update({
          where: { id: before.id },
          data: sharedChanges,
        });
      if (Object.keys(localChanges).length)
        await tx.countryProduct.update({
          where: {
            countryId_productId: {
              countryId: req.countryId,
              productId: before.id,
            },
          },
          data: localChanges,
        });
      await saveGrades(tx, before.id, req.countryId, grades);
      await audit(tx, req, before.id, "UPDATE", {
        before: Object.fromEntries(
          Object.keys({ ...sharedChanges, ...localChanges }).map((key) => [
            key,
            previous[key],
          ]),
        ),
        after: { ...sharedChanges, ...localChanges },
        grades: { before: previous.gradePrices, after: grades },
      });
      return tx.product.findUnique({
        where: { id: before.id },
        include: select(req.countryId),
      });
    });
    return res.json(dto(updated, req.countryId));
  } catch (e) {
    return error(res, e);
  }
}
async function deleteProduct(req, res) {
  try {
    await prisma.$transaction(async (tx) => {
      await lockAvailability(tx, req, req.params.id);
      await tx.countryProduct.update({
        where: {
          countryId_productId: {
            countryId: req.countryId,
            productId: req.params.id,
          },
        },
        data: { actif: false },
      });
      await audit(tx, req, req.params.id, "DEACTIVATE", {
        after: { actif: false },
      });
    });
    return res.json({ ok: true, deactivated: true });
  } catch (e) {
    return error(res, e);
  }
}
async function history(req, res) {
  try {
    const p = await prisma.product.findFirst({
      where: {
        id: req.params.id,
        countryProducts: { some: { countryId: req.countryId } },
      },
      select: { id: true },
    });
    if (!p) fail("Produit introuvable dans ce pays.", 404);
    const page = integer(req.query.page ?? 1, "Page", 1),
      pageSize = 30,
      where = { productId: p.id, countryId: req.countryId };
    const [items, totalCount] = await Promise.all([
      prisma.productAuditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      prisma.productAuditLog.count({ where }),
    ]);
    return res.json({ items, totalCount, page, pageSize });
  } catch (e) {
    return error(res, e);
  }
}
async function exportProducts(req, res) {
  try {
    const parsed = listQuery(req.query, req.countryId),
      where = availabilityWhere(parsed),
      count = await prisma.countryProduct.count({ where });
    if (count > 10000)
      fail("L’export est limité à 10 000 produits. Affinez vos filtres.");
    const rows = await prisma.countryProduct.findMany({
      where,
      orderBy: parsed.orderBy,
      take: 10000,
      include: { product: { include: select(req.countryId) } },
    });
    const headers = [
      "sku",
      "nom",
      "prixBaseFcfa",
      ...GRADES,
      "cc",
      "poidsKg",
      "actif",
      "imageUrl",
      "category",
      "stockQty",
      "maxQtyPerOrder",
      "details",
    ];
    const lines = rows.map((row) => {
      const p = dto(row.product, req.countryId);
      return headers
        .map((key) =>
          csvCell(GRADES.includes(key) ? p.gradePrices[key] : p[key]),
        )
        .join(";");
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="produits.csv"');
    return res.send("\uFEFF" + [headers.join(";"), ...lines].join("\r\n"));
  } catch (e) {
    return error(res, e);
  }
}
function importInput(row) {
  const output = { ...row };
  if (output.category === undefined && output.categorie !== undefined)
    output.category = output.categorie;
  if (output.stockQty === undefined)
    output.stockQty = output.stock ?? output.quantite;
  output.gradePrices = { ...(row.gradePrices || {}) };
  for (const grade of GRADES)
    if (row[grade] !== undefined && row[grade] !== "")
      output.gradePrices[grade] = row[grade];
  for (const key of Object.keys(output))
    if (output[key] === "" && !["sku", "nom"].includes(key)) delete output[key];
  return output;
}
async function importProductsCsv(req, res) {
  try {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
      fail("Importez de 1 à 1 000 lignes par fichier.");
    const dryRun = req.body.dryRun === true,
      errors = [],
      clean = [],
      seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      try {
        const input = importInput(rows[i]),
          patch = normalize(input);
        if (!patch.shared.sku) fail("SKU requis.");
        if (seen.has(patch.shared.sku))
          fail("SKU présent plusieurs fois dans le fichier.");
        seen.add(patch.shared.sku);
        clean.push({ index: i + 2, input, patch });
      } catch (e) {
        errors.push({
          index: i + 2,
          sku: String(rows[i]?.sku || ""),
          errors: [e.message],
        });
      }
    }
    const existing = await prisma.product.findMany({
        where: { sku: { in: clean.map((row) => row.patch.shared.sku) } },
        include: select(req.countryId),
      }),
      bySku = new Map(existing.map((p) => [p.sku, p])),
      plan = [];
    for (const row of clean) {
      const previous = bySku.get(row.patch.shared.sku);
      try {
        if (!previous) row.patch = normalize(row.input, true);
        if (previous && !previous.countryProducts.length)
          fail(
            "SKU déjà utilisé dans un autre pays. Utilisez la copie de catalogue pour l’ajouter ici.",
          );
        plan.push({ ...row, previous, action: previous ? "UPDATE" : "CREATE" });
      } catch (e) {
        errors.push({
          index: row.index,
          sku: row.patch.shared.sku,
          errors: [e.message],
        });
      }
    }
    const previewToken = require("node:crypto")
      .createHash("sha256")
      .update(
        JSON.stringify({
          countryId: req.countryId,
          rows,
          versions: plan.map((row) => [
            row.previous?.id,
            row.previous?.updatedAt,
            row.previous?.countryProducts?.[0]?.updatedAt,
          ]),
        }),
      )
      .digest("hex");
    if (
      !dryRun &&
      req.body.previewToken &&
      req.body.previewToken !== previewToken
    )
      fail(
        "Le catalogue a changé depuis l’aperçu. Prévisualisez de nouveau l’import.",
        409,
      );
    const preview = {
      previewToken,
      totalReceived: rows.length,
      totalValid: plan.length,
      created: plan.filter((row) => row.action === "CREATE").length,
      updated: plan.filter((row) => row.action === "UPDATE").length,
      errors,
      rows: plan.map((row) => ({
        line: row.index,
        sku: row.patch.shared.sku,
        nom: row.patch.shared.nom || row.previous?.nom,
        action: row.action,
        sharedChanges: row.previous
          ? Object.keys(changed(row.previous, row.patch.shared))
          : [],
        stockIgnored:
          row.action === "UPDATE" && row.patch.local.stockQty !== undefined,
      })),
    };
    if (dryRun) return res.json({ ...preview, dryRun: true });
    if (errors.length)
      return res.status(400).json({
        message: "Corrigez les lignes signalées avant de confirmer l’import.",
        ...preview,
      });
    if (
      plan.some(
        (row) =>
          row.previous &&
          Object.keys(changed(row.previous, row.patch.shared)).length > 0,
      ) &&
      req.body.confirmSharedChanges !== true
    )
      fail(
        "Confirmez les modifications des informations communes à tous les pays.",
      );
    await prisma.$transaction(
      async (tx) => {
        for (const row of plan) {
          const { shared, local, grades } = row.patch;
          if (row.previous) {
            const operation = {
              ...req,
              body: {
                expectedUpdatedAt: row.previous.updatedAt,
                expectedCountryUpdatedAt:
                  row.previous.countryProducts[0].updatedAt,
              },
            };
            await lockAvailability(tx, operation, row.previous.id);
            const sharedChanges = changed(row.previous, shared),
              { stockQty: ignored, ...localChanges } = local;
            if (Object.keys(sharedChanges).length)
              await tx.product.update({
                where: { id: row.previous.id },
                data: sharedChanges,
              });
            if (Object.keys(localChanges).length)
              await tx.countryProduct.update({
                where: {
                  countryId_productId: {
                    countryId: req.countryId,
                    productId: row.previous.id,
                  },
                },
                data: localChanges,
              });
            await saveGrades(tx, row.previous.id, req.countryId, grades);
            await audit(tx, req, row.previous.id, "IMPORT_UPDATE", {
              before: dto(row.previous, req.countryId),
              after: { ...sharedChanges, ...localChanges, gradePrices: grades },
              stockIgnored: ignored !== undefined,
            });
          } else {
            const product = await tx.product.create({
              data: scopeCreate(req, {
                ...shared,
                prixBaseFcfa: local.prixBaseFcfa,
                stockQty: 0,
                actif: local.actif,
                maxQtyPerOrder: local.maxQtyPerOrder ?? null,
              }),
            });
            await tx.countryProduct.create({
              data: {
                countryId: req.countryId,
                productId: product.id,
                ...local,
                stockQty: local.stockQty ?? 0,
              },
            });
            await initialStock(tx, req, product.id, local.stockQty ?? 0);
            await saveGrades(tx, product.id, req.countryId, grades);
            await audit(tx, req, product.id, "IMPORT_CREATE", {
              after: { ...shared, ...local, gradePrices: grades },
            });
          }
        }
      },
      { timeout: 30000 },
    );
    return res.json({ ...preview, rows: undefined, dryRun: false });
  } catch (e) {
    return error(res, e);
  }
}
async function copyProductsFromCountry(req, res) {
  try {
    if (req.user?.role !== "SUPER_ADMIN")
      fail("La copie entre pays est réservée au super administrateur.", 403);
    const sourceCode = String(req.body.sourceCode || "CIV")
        .trim()
        .toUpperCase(),
      codes = req.body.destinationCodes;
    if (!Array.isArray(codes) || !codes.length || codes.length > 30)
      fail("Sélectionnez les pays de destination.");
    const destinationCodes = [
      ...new Set(codes.map((code) => String(code).trim().toUpperCase())),
    ];
    if (destinationCodes.includes(sourceCode))
      fail("Le pays source ne peut pas être une destination.");
    const overwrite =
        req.body.overwrite === undefined ? false : boolean(req.body.overwrite),
      source = await prisma.country.findUnique({ where: { code: sourceCode } });
    if (!source) fail("Pays source introuvable.", 404);
    const countries = await prisma.country.findMany({
      where: { code: { in: destinationCodes }, actif: true },
      orderBy: { code: "asc" },
    });
    if (countries.length !== destinationCodes.length)
      fail("Un pays sélectionné est introuvable ou inactif.");
    const rows = await prisma.countryProduct.findMany({
      where: { countryId: source.id },
      include: { product: { include: select(source.id) } },
    });
    if (!rows.length) fail("Le catalogue source est vide.");
    const summary = [];
    const versions = [];
    let previewToken;
    await prisma.$transaction(
      async (tx) => {
        for (const country of countries) {
          let created = 0,
            updated = 0,
            skipped = 0;
          for (const row of rows) {
            const exists = await tx.countryProduct.findUnique({
              where: {
                countryId_productId: {
                  countryId: country.id,
                  productId: row.productId,
                },
              },
            });
            versions.push({
              country: country.code,
              productId: row.productId,
              source: row,
              previous: exists,
            });
            if (exists && !overwrite) {
              skipped++;
              continue;
            }
            if (req.body.dryRun !== true) {
              const local = {
                prixBaseFcfa: row.prixBaseFcfa,
                actif: row.actif,
                maxQtyPerOrder: row.maxQtyPerOrder,
              };
              if (exists) {
                const claim = await tx.countryProduct.updateMany({
                  where: { id: exists.id, updatedAt: exists.updatedAt },
                  data: local,
                });
                if (claim.count !== 1)
                  fail(
                    "Un catalogue de destination a changé. Prévisualisez de nouveau la copie.",
                    409,
                  );
              } else
                await tx.countryProduct.create({
                  data: {
                    countryId: country.id,
                    productId: row.productId,
                    ...local,
                    stockQty: 0,
                  },
                });
              await saveGrades(
                tx,
                row.productId,
                country.id,
                Object.fromEntries(
                  (row.product.gradePrices || []).map((price) => [
                    price.grade,
                    Number(price.prixFcfa),
                  ]),
                ),
              );
              await audit(
                tx,
                { ...req, countryId: country.id },
                row.productId,
                "COPY_COUNTRY",
                { sourceCode, overwrite, stockPreserved: true },
              );
            }
            if (exists) updated++;
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
        previewToken = require("node:crypto")
          .createHash("sha256")
          .update(
            JSON.stringify({
              sourceCode,
              destinationCodes,
              overwrite,
              versions,
            }),
          )
          .digest("hex");
        if (
          req.body.dryRun !== true &&
          req.body.previewToken &&
          req.body.previewToken !== previewToken
        )
          fail(
            "Le catalogue a changé depuis l’aperçu. Prévisualisez de nouveau la copie.",
            409,
          );
      },
      { timeout: 30000 },
    );
    return res.json({
      ok: true,
      previewToken,
      sourceCode,
      productsCopied: rows.length,
      overwrite,
      dryRun: req.body.dryRun === true,
      countries: summary,
    });
  } catch (e) {
    return error(res, e);
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
      try {
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
            .json({ message: "Le stockage des images est indisponible." });
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
        const assetId = `${skuSafe}_${require("node:crypto").randomUUID()}`;
        const publicId = `appfbo/products/${assetId}`;

        let result;
        try {
          result = await uploadBufferToCloudinary(file.buffer, {
            folder: "appfbo/products",
            public_id: assetId,
            overwrite: false,
            resource_type: "image",
          });
        } catch (upErr) {
          console.error("Cloudinary upload error:", upErr);
          return res
            .status(400)
            .json({ message: "L’image n’a pas pu être envoyée. Réessayez." });
        }

        const updated = await prisma.$transaction(async (tx) => {
          await lockAvailability(tx, req, id);
          const product = await tx.product.update({
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
          await audit(tx, req, id, "IMAGE", {
            before: { imageUrl: exists.imageUrl },
            after: { imageUrl: result.secure_url },
          });
          const availability = await tx.countryProduct.findUnique({
            where: {
              countryId_productId: { countryId: req.countryId, productId: id },
            },
          });
          return { ...product, countryUpdatedAt: availability.updatedAt };
        });

        return res.json({ ...updated, cloudinaryPublicId: publicId });
      } catch (e) {
        return error(res, e);
      }
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
  copyProductsFromCountry,
  exportProducts,
  history,
};
