const prisma = require("../../prisma");

function normalizeDateStart(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function normalizeDateEnd(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(23, 59, 59, 999);
  return dt;
}

async function getStats(req, res) {
  try {
    const countryId = req.countryId || req.country?.id;
    const { date, dateFrom, dateTo } = req.query;

    let from = null;
    let to = null;

    if (date) {
      from = normalizeDateStart(String(date));
      to = normalizeDateEnd(String(date));
    } else {
      from = dateFrom ? normalizeDateStart(String(dateFrom)) : null;
      to = dateTo ? normalizeDateEnd(String(dateTo)) : null;
    }

    const where = { countryId, status: { not: "DRAFT" } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [agg, byStatus] = await Promise.all([
      prisma.preorder.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
      prisma.preorder.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
    ]);

    const topRaw = await prisma.preorderItem.groupBy({
      by: ["productId"],
      where: { preorder: where },
      _sum: { qty: true, lineTotalFcfa: true },
      orderBy: { _sum: { lineTotalFcfa: "desc" } },
      take: 5,
    });

    const ids = topRaw.map((x) => x.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, countryId },
      select: { id: true, nom: true, sku: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const topProducts = topRaw.map((x) => ({
      productId: x.productId,
      sku: map.get(x.productId)?.sku || "",
      nom: map.get(x.productId)?.nom || "Produit",
      qty: x._sum.qty || 0,
      revenueFcfa: x._sum.lineTotalFcfa || 0,
    }));

    return res.json({
      period: {
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      },
      totalOrders: agg._count._all,
      totalRevenueFcfa: agg._sum.totalFcfa || 0,
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
        revenueFcfa: s._sum.totalFcfa || 0,
      })),
      topProducts,
    });
  } catch (e) {
    console.error("getStats error:", e);
    return res.status(500).json({ message: "Erreur serveur (getStats)" });
  }
}

module.exports = {
  getStats,
};
