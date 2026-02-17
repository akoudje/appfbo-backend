const prisma = require("../prisma");

async function listProducts(req, res) {
  const search = (req.query.search || "").trim();
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "24", 10), 1), 100);

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
      },
    }),
  ]);

  res.json({ page, pageSize, total, items });
}

module.exports = { listProducts };
