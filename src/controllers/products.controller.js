// controllers/products.controller.js : gère la liste des produits disponibles pour les précommandes. Implémente une fonction listProducts qui supporte la recherche par nom ou SKU, et la pagination. Utilise Prisma pour interagir avec la DB.

// controllers/products.controller.js
const prisma = require("../prisma");

// GET /api/products?search=&page=&pageSize=&category=&inStock=
async function listProducts(req, res) {
  try {
    const search = (req.query.search || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize || "24", 10), 1),
      100
    );

    const category = (req.query.category || "").trim();
    const inStock = String(req.query.inStock || "").trim(); // "true" | "false" | ""

    const where = {
      actif: true,
      ...(search
        ? {
            OR: [
              { nom: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(category ? { category } : {}),
      ...(inStock === "true" ? { stockQty: { gt: 0 } } : {}),
      ...(inStock === "false" ? { stockQty: { lte: 0 } } : {}),
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

          // ✅ nouveaux champs
          category: true,
          details: true,
          stockQty: true,
        },
      }),
    ]);

    res.json({
      page,
      pageSize,
      total,
      items: items.map((p) => ({
        ...p,
        cc: p.cc?.toString?.() ?? String(p.cc ?? "0.000"),
        poidsKg: p.poidsKg?.toString?.() ?? String(p.poidsKg ?? "0.000"),
      })),
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

    const p = await prisma.product.findUnique({
      where: { id },
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

        createdAt: true,
        updatedAt: true,
      },
    });

    // on ne renvoie pas un produit inactif côté public
    if (!p || !p.actif) return res.status(404).json({ message: "Produit introuvable" });

    return res.json({
      ...p,
      cc: p.cc?.toString?.() ?? String(p.cc ?? "0.000"),
      poidsKg: p.poidsKg?.toString?.() ?? String(p.poidsKg ?? "0.000"),
    });
  } catch (e) {
    console.error("getProductById error:", e);
    res.status(500).json({ message: "Erreur serveur (getProductById)" });
  }
}

module.exports = { listProducts, getProductById };