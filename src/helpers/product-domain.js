const { ProductCategory } = require("@prisma/client");

const GRADES = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];
function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function integer(value, name, min = 0) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === "" ||
    !/^\d+$/.test(String(value).trim())
  )
    fail(`${name} doit être un entier supérieur ou égal à ${min}.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > 2147483647)
    fail(`${name} invalide.`);
  return n;
}
function decimal(value, name, scale = 3, max = 9999999.999) {
  const str = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(str) || Number(str) > max)
    fail(
      `${name} doit être un nombre positif avec au plus ${scale} décimales.`,
    );
  return str;
}
function boolean(value, name = "Actif") {
  if (value === true || value === "true" || value === 1 || value === "1")
    return true;
  if (value === false || value === "false" || value === 0 || value === "0")
    return false;
  fail(`${name} doit être vrai ou faux.`);
}
function text(value, name, max, optional = false) {
  if (value == null && optional) return null;
  if (typeof value !== "string") fail(`${name} invalide.`);
  const str = value.trim();
  if ((!str && !optional) || str.length > max)
    fail(`${name} requis (${max} caractères maximum).`);
  return str || null;
}
function image(value) {
  const str = text(value, "Image", 2048, true);
  if (str && !/^https?:\/\//i.test(str))
    fail("L’image doit utiliser une adresse HTTP ou HTTPS.");
  if (str) {
    try {
      new URL(str);
    } catch {
      fail("Adresse de l’image invalide.");
    }
  }
  return str;
}
function category(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
  if (!Object.values(ProductCategory).includes(normalized))
    fail("Catégorie inconnue.");
  return normalized;
}
function gradePrices(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    fail("Tarifs par grade invalides.");
  const output = {};
  for (const grade of GRADES) {
    if (source[grade] === undefined) continue;
    const raw = source[grade];
    output[grade] =
      raw === null || raw === ""
        ? null
        : Number(decimal(raw, `Tarif ${grade}`, 4, 99999999.9999));
  }
  return output;
}
function normalize(input, create = false) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Fiche produit invalide.");
  const shared = {},
    local = {};
  for (const key of ["sku", "nom"])
    if (create || input[key] !== undefined)
      shared[key] = text(
        input[key],
        key === "sku" ? "SKU" : "Nom",
        key === "sku" ? 100 : 250,
      );
  for (const key of ["cc", "poidsKg"])
    if (create || input[key] !== undefined)
      shared[key] = decimal(
        input[key],
        key === "cc" ? "Coefficient CC" : "Poids",
      );
  if (input.category !== undefined || create)
    shared.category = category(input.category ?? "NON_CLASSE");
  if (input.imageUrl !== undefined) shared.imageUrl = image(input.imageUrl);
  if (input.details !== undefined)
    shared.details = text(input.details, "Description", 20000, true);
  if (input.prixBaseFcfa !== undefined || create)
    local.prixBaseFcfa = integer(input.prixBaseFcfa, "Prix de base");
  if (input.actif !== undefined || create)
    local.actif = boolean(input.actif ?? true);
  if (input.maxQtyPerOrder !== undefined)
    local.maxQtyPerOrder =
      input.maxQtyPerOrder === null || input.maxQtyPerOrder === ""
        ? null
        : integer(input.maxQtyPerOrder, "Limite par commande", 1);
  if (input.stockQty !== undefined)
    local.stockQty = integer(input.stockQty, "Stock");
  return { shared, local, grades: gradePrices(input.gradePrices || {}) };
}
function listQuery(query, countryId) {
  const availability = { countryId },
    where = { countryProducts: { some: availability } };
  const q = String(query.q || "").trim();
  if (q.length > 200) fail("Recherche trop longue.");
  if (q)
    where.OR = [
      { nom: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      {
        packagings: { some: { barcode: { contains: q, mode: "insensitive" } } },
      },
    ];
  if (query.actif !== undefined && query.actif !== "")
    availability.actif = boolean(query.actif);
  if (query.category) where.category = category(query.category);
  if (query.inStock !== undefined && query.inStock !== "")
    availability.stockQty = boolean(query.inStock) ? { gt: 0 } : { lte: 0 };
  if (query.stock === "low") availability.stockQty = { gt: 0, lte: 5 };
  else if (query.stock && !["in", "out"].includes(query.stock))
    fail("Filtre stock invalide.");
  if (query.stock === "in") availability.stockQty = { gt: 0 };
  if (query.stock === "out") availability.stockQty = { lte: 0 };
  if (query.incomplete === "true")
    where.AND = [
      {
        OR: [{ imageUrl: null }, { imageUrl: "" }, { category: "NON_CLASSE" }],
      },
    ];
  const page = integer(query.page ?? 1, "Page", 1),
    pageSize = Math.min(
      100,
      integer(query.pageSize ?? 30, "Taille de page", 1),
    );
  const sort = query.sort || "nom";
  if (!["nom", "sku", "updatedAt", "stockQty", "prixBaseFcfa"].includes(sort))
    fail("Tri invalide.");
  const dir = query.dir || "asc";
  if (!["asc", "desc"].includes(dir)) fail("Sens du tri invalide.");
  const orderBy = ["stockQty", "prixBaseFcfa"].includes(sort)
    ? [{ [sort]: dir }, { product: { nom: "asc" } }, { productId: "asc" }]
    : [{ product: { [sort]: dir } }, { productId: "asc" }];
  return { where, page, pageSize, orderBy };
}
function changed(before, after) {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) => String(before?.[key] ?? "") !== String(value ?? ""),
    ),
  );
}
async function audit(tx, req, productId, action, changes = {}) {
  await tx.productAuditLog.create({
    data: {
      productId,
      countryId: req.countryId,
      actorId: req.user?.id || null,
      actorName: req.user?.fullName || req.user?.email || null,
      action,
      changes: JSON.parse(JSON.stringify(changes)),
    },
  });
}
module.exports = {
  GRADES,
  fail,
  integer,
  decimal,
  boolean,
  text,
  normalize,
  listQuery,
  changed,
  audit,
};
