// order-simulation.service.js
// Simulation de commande : catalogue aux prix du grade et total à prévoir,
// SANS commande, sans contrôle de stock, de quantité maximale ni de fenêtre
// de soumission. Rien n'est enregistré ni réservé.
//
// Le total reprend exactement le calcul de la vraie commande
// (computeLineFromProduct, emballage, timbre) pour que le budget annoncé
// soit celui de la commande. Pas de frais d'expédition (retrait).

const crypto = require("crypto");
const prisma = require("../prisma");
const {
  computeCatalogProductsForGrade,
  computeLineFromProduct,
  computePackagingFeeFcfa,
  computeStateStampFcfa,
} = require("./pricing.service");
const { analyzePurchaseItems, PROMOTION_MIN_CC } = require("./sponsorship-promotion.service");
const { getSponsorshipSettings } = require("./sponsorship.service");

// Futur filleul (pas encore de numéro) : prix de l'achat de parrainage.
const RECRUIT_GRADE = "CLIENT_PRIVILEGIE";

// Garde-fous techniques uniquement (pas des règles commerciales).
const MAX_LINES = 300;
const MAX_QTY_PER_LINE = 9999;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function httpError(status, message, code) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  return error;
}

function tokenSecret() {
  const secret = process.env.SIMULATION_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw httpError(500, "Simulation indisponible.", "SIMULATION_NOT_CONFIGURED");
  return secret;
}

function sign(payload) {
  return crypto.createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
}

// Jeton de simulation : le grade est vérifié une fois (numéro FBO), le total
// est ensuite recalculé sans réinterroger l'annuaire. Le grade ne peut pas
// être choisi librement par le visiteur.
function createSimulationToken({ countryId, grade, futureRecruit = false, now = Date.now() }) {
  const payload = Buffer.from(
    JSON.stringify({ c: countryId, g: grade, e: now + TOKEN_TTL_MS, ...(futureRecruit ? { r: 1 } : {}) }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSimulationToken(token, { countryId, now = Date.now() } = {}) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw httpError(401, "Simulation expirée, saisissez à nouveau le numéro FBO.", "SIMULATION_TOKEN_INVALID");
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw httpError(401, "Simulation expirée, saisissez à nouveau le numéro FBO.", "SIMULATION_TOKEN_INVALID");
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw httpError(401, "Simulation expirée, saisissez à nouveau le numéro FBO.", "SIMULATION_TOKEN_INVALID");
  }
  if (!data?.g || !data?.c || Number(data.e) < now) {
    throw httpError(401, "Simulation expirée, saisissez à nouveau le numéro FBO.", "SIMULATION_TOKEN_EXPIRED");
  }
  if (countryId && data.c !== countryId) {
    throw httpError(401, "Cette simulation concerne un autre pays.", "SIMULATION_COUNTRY_MISMATCH");
  }
  return { countryId: data.c, grade: data.g, futureRecruit: data.r === 1 };
}

// Catalogue de simulation : tous les produits actifs du pays aux prix du
// grade, la rupture est seulement signalée (inStock), jamais bloquante.
function toSimulationCatalog(items = []) {
  return items.map((item) => ({
    id: item.id,
    sku: item.sku,
    nom: item.nom,
    imageUrl: item.imageUrl,
    category: item.category,
    details: item.details,
    prixBaseFcfa: item.prixBaseFcfa,
    prixFinalFcfa: item.prixFinalFcfa,
    discountPercent: item.discountPercent,
    cc: item.cc,
    inStock: Number(item.stockQty || 0) > 0,
  }));
}

function normalizeLines(rawItems) {
  if (!Array.isArray(rawItems)) throw httpError(400, "items doit être une liste.", "SIMULATION_ITEMS_INVALID");
  const qtyById = new Map();
  for (const raw of rawItems) {
    const productId = String(raw?.productId || "").trim();
    const qty = Math.floor(Number(raw?.qty || 0));
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
    qtyById.set(productId, Math.min(MAX_QTY_PER_LINE, (qtyById.get(productId) || 0) + qty));
  }
  if (qtyById.size > MAX_LINES) throw httpError(400, "Trop de produits dans la simulation.", "SIMULATION_TOO_MANY_LINES");
  return qtyById;
}

// Calcul pur (testable) : lignes + totaux à partir du catalogue du grade.
// Un produit qui n'est plus au catalogue est renvoyé dans `unavailable`
// au lieu de faire échouer toute la simulation.
function computeSimulationQuote({ catalog = [], items = [], discountPercent = 0, packagingFeeFcfa, countryCode }) {
  const qtyById = normalizeLines(items);
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const lines = [];
  const unavailable = [];
  let totalProduitsFcfa = 0;
  let totalCc = 0;

  for (const [productId, qty] of qtyById) {
    const product = byId.get(productId);
    if (!product) {
      unavailable.push(productId);
      continue;
    }
    const direct = product.pricingMode === "DIRECT_GRADE_PRICE";
    const line = computeLineFromProduct(
      {
        actif: true,
        prixBaseFcfa: product.prixBaseFcfa,
        cc: product.cc,
        poidsKg: product.poidsKg,
        ...(direct ? { directGradePriceFcfa: product.prixFinalFcfa } : {}),
      },
      qty,
      direct ? 0 : discountPercent,
    );
    totalProduitsFcfa += line.lineTotalFcfa;
    totalCc += line.lineTotalCc;
    lines.push({
      productId,
      sku: product.sku,
      nom: product.nom,
      qty,
      prixUnitaireFcfa: line.prixUnitaireFcfa,
      lineTotalFcfa: line.lineTotalFcfa,
      lineTotalCc: line.lineTotalCc,
      inStock: Number(product.stockQty || 0) > 0,
    });
  }

  const hasLines = lines.length > 0;
  const emballageFcfa = hasLines ? computePackagingFeeFcfa({ packagingFeeFcfa }) : 0;
  const taxable = totalProduitsFcfa + emballageFcfa;
  const timbreEtatFcfa = hasLines ? computeStateStampFcfa({ countryCode, taxableAmountFcfa: taxable }) : 0;

  return {
    lines,
    unavailable,
    totals: {
      totalProduitsFcfa: Math.round(totalProduitsFcfa),
      emballageFcfa: Math.round(emballageFcfa),
      timbreEtatFcfa: Math.round(timbreEtatFcfa),
      totalFcfa: Math.round(taxable + timbreEtatFcfa),
      totalCc: Math.round(totalCc * 1000) / 1000,
      itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    },
  };
}

async function loadGradeCatalog({ countryId, countryCode, grade }) {
  const [catalog, settings, discount] = await Promise.all([
    computeCatalogProductsForGrade({ countryId, countryCode, grade }),
    prisma.countrySettings.findUnique({ where: { countryId }, select: { packagingFeeFcfa: true } }),
    prisma.gradeDiscount.findUnique({
      where: { countryId_grade: { countryId, grade } },
      select: { discountPercent: true },
    }),
  ]);
  return {
    catalog,
    packagingFeeFcfa: settings?.packagingFeeFcfa,
    discountPercent: discount ? Number(discount.discountPercent) : 0,
  };
}

// Repères de l'achat de parrainage pour un futur filleul : minimum d'achat
// (total des produits au prix Client privilégié, comme à la soumission de la
// fiche) et promotion Animateur adjoint (2 CC ou pack 634/635).
function recruitPurchaseCheck(quote, minPurchaseFcfa) {
  const min = Math.max(0, Number(minPurchaseFcfa || 0));
  const total = Number(quote?.totals?.totalProduitsFcfa || 0);
  const promotion = analyzePurchaseItems(
    (quote?.lines || []).map((line) => ({ lineTotalCc: line.lineTotalCc, productSkuSnapshot: line.sku })),
  );
  return {
    minPurchaseFcfa: min,
    minReached: total >= min,
    missingFcfa: Math.max(0, min - total),
    promotion: { minCc: PROMOTION_MIN_CC, totalCc: promotion.totalCc, packSku: promotion.packSku, qualifies: promotion.qualifies },
  };
}

async function quoteSimulation({ token, items, country }) {
  const { grade, futureRecruit } = readSimulationToken(token, { countryId: country.id });
  const context = await loadGradeCatalog({ countryId: country.id, countryCode: country.code, grade });
  const quote = computeSimulationQuote({ ...context, items, countryCode: country.code });
  if (!futureRecruit) return { grade, ...quote };
  const settings = await getSponsorshipSettings(country.id);
  return { grade, futureRecruit: true, ...quote, sponsorship: recruitPurchaseCheck(quote, settings.minPurchaseFcfa) };
}

module.exports = {
  RECRUIT_GRADE,
  recruitPurchaseCheck,
  MAX_LINES,
  MAX_QTY_PER_LINE,
  createSimulationToken,
  readSimulationToken,
  toSimulationCatalog,
  computeSimulationQuote,
  loadGradeCatalog,
  quoteSimulation,
};
