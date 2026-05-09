// controllers/products.controller.js : gère la liste des produits disponibles pour les précommandes. Implémente une fonction listProducts qui supporte la recherche par nom ou SKU, et la pagination. Utilise Prisma pour interagir avec la DB.

// controllers/products.controller.js
const prisma = require("../prisma");
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
    countryProducts: undefined,
    cc: product.cc?.toString?.() ?? String(product.cc ?? "0.000"),
    poidsKg: product.poidsKg?.toString?.() ?? String(product.poidsKg ?? "0.000"),
  };
}

// GET /api/products?search=&page=&pageSize=&category=&inStock=
async function listProducts(req, res) {
  try {
    const search = (req.query.search || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize || "100", 10), 1),
      100
    );

    const category = (req.query.category || "").trim();
    const inStock = String(req.query.inStock || "").trim(); // "true" | "false" | ""

    const countryId = req.country?.id || req.countryId;
    const productFilters = {
      ...(search
        ? {
            OR: [
              { nom: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(category ? { category } : {}),
    };
    const countryProductFilters = {
      countryId,
      actif: true,
      ...(inStock === "true" ? { stockQty: { gt: 0 } } : {}),
      ...(inStock === "false" ? { stockQty: { lte: 0 } } : {}),
    };
    const where = {
      ...productFilters,
      countryProducts: { some: countryProductFilters },
    };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { nom: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sku: true,
          nom: true,
          imageUrl: true,
          prixBaseFcfa: true,
          cc: true,
          poidsKg: true,
          actif: true,

          category: true,
          details: true,
          stockQty: true,
          maxQtyPerOrder: true,
          countryProducts: {
            where: { countryId },
            select: {
              countryId: true,
              prixBaseFcfa: true,
              stockQty: true,
              actif: true,
              maxQtyPerOrder: true,
            },
          },
        },
      }),
    ]);

    res.json({
      page,
      pageSize,
      total,
      items: items.map((p) => productToCountryDto(p, countryId)),
    });
  } catch (e) {
    console.error("listProducts error:", e);
    res.status(500).json({ message: "Erreur serveur (listProducts)" });
  }
}

// ✅ GET /api/products/:id
async function getProductById(req, res) {
  try {
    const { id } = req.params;
    const countryId = req.country?.id || req.countryId;
    const p = await prisma.product.findFirst({
      where: {
        id,
        countryProducts: { some: { countryId, actif: true } },
      },
      select: {
        id: true,
        sku: true,
        nom: true,
        imageUrl: true,
        prixBaseFcfa: true,
        cc: true,
        poidsKg: true,
        actif: true,

        // ✅ nouveaux champs
        category: true,
        details: true,
        stockQty: true,
        maxQtyPerOrder: true,
        countryProducts: {
          where: { countryId },
          select: {
            countryId: true,
            prixBaseFcfa: true,
            stockQty: true,
            actif: true,
            maxQtyPerOrder: true,
          },
        },

        createdAt: true,
        updatedAt: true,
      },
    });

    // on ne renvoie pas un produit inactif côté public
    if (!p) return res.status(404).json({ message: "Produit introuvable" });

    return res.json(productToCountryDto(p, countryId));
  } catch (e) {
    console.error("getProductById error:", e);
    res.status(500).json({ message: "Erreur serveur (getProductById)" });
  }
}

module.exports = { listProducts, getProductById };
