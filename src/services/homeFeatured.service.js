// src/services/homeFeatured.service.js
// Accueil > « Sélection produits » : section activable et produits choisis
// (dans l'ordre d'affichage). Aucun produit choisi : sélection automatique
// côté site (un produit en stock par catégorie).

const MAX_HOME_FEATURED_PRODUCTS = 10;

function normalizeHomeFeatured(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const ids = Array.isArray(value.productIds) ? value.productIds : [];
  const productIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, MAX_HOME_FEATURED_PRODUCTS);
  return { enabled: value.enabled !== false, productIds };
}

module.exports = { MAX_HOME_FEATURED_PRODUCTS, normalizeHomeFeatured };
