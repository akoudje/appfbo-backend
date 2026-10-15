// src/controllers/admin/homeFeatured.controller.js
// Admin > Visuels marketing > « Sélection produits » de la page d'accueil,
// par pays. Enregistré directement (pas de brouillon), visible sous 30 s.

const prisma = require("../../prisma");
const { pickCountryId } = require("../../helpers/countryScope");
const { MAX_HOME_FEATURED_PRODUCTS, normalizeHomeFeatured } = require("../../services/homeFeatured.service");
const { clearStorefrontConfigCache } = require("../publicConfig.controller");

const PRODUCT_SELECT = { id: true, sku: true, nom: true, imageUrl: true, actif: true, stockQty: true };

async function loadProducts(productIds) {
  if (!productIds.length) return [];
  const rows = await prisma.product.findMany({ where: { id: { in: productIds } }, select: PRODUCT_SELECT });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return productIds.map((id) => byId.get(id)).filter(Boolean);
}

async function payload(countryId) {
  const content = await prisma.countryMarketingContent.findUnique({
    where: { countryId },
    select: { homeFeaturedJson: true, updatedAt: true },
  });
  const config = normalizeHomeFeatured(content?.homeFeaturedJson);
  return { ...config, maxProducts: MAX_HOME_FEATURED_PRODUCTS, products: await loadProducts(config.productIds) };
}

// GET /api/admin/home-featured
async function getHomeFeatured(req, res) {
  try {
    return res.json(await payload(pickCountryId(req)));
  } catch (error) {
    console.error("getHomeFeatured error:", error);
    return res.status(500).json({ message: "Erreur serveur (sélection produits)." });
  }
}

// PUT /api/admin/home-featured { enabled, productIds }
async function updateHomeFeatured(req, res) {
  try {
    const countryId = pickCountryId(req);
    const body = req.body || {};
    if (Array.isArray(body.productIds) && body.productIds.length > MAX_HOME_FEATURED_PRODUCTS) {
      return res.status(400).json({ message: `${MAX_HOME_FEATURED_PRODUCTS} produits au maximum.` });
    }
    const config = normalizeHomeFeatured(body);
    const known = await loadProducts(config.productIds);
    if (known.length !== config.productIds.length) {
      return res.status(400).json({ message: "Un produit choisi n'existe plus. Rechargez la page." });
    }
    await prisma.countryMarketingContent.upsert({
      where: { countryId },
      update: { homeFeaturedJson: config },
      create: { countryId, homeFeaturedJson: config },
    });
    clearStorefrontConfigCache(countryId);
    return res.json(await payload(countryId));
  } catch (error) {
    console.error("updateHomeFeatured error:", error);
    return res.status(500).json({ message: "Erreur serveur (sélection produits)." });
  }
}

module.exports = { getHomeFeatured, updateHomeFeatured };
