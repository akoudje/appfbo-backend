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

    const periodFilter = {};
    if (from || to) {
      periodFilter.createdAt = {};
      if (from) periodFilter.createdAt.gte = from;
      if (to) periodFilter.createdAt.lte = to;
    }

    const baseWhere = { countryId, status: { not: "DRAFT" }, ...periodFilter };
    const activeWhere = {
      countryId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...periodFilter,
    };
    const cancelledWhere = { countryId, status: "CANCELLED", ...periodFilter };
    const testCancelledWhere = {
      ...cancelledWhere,
      cancelReason: { contains: "test", mode: "insensitive" },
    };

    const [grossAgg, activeAgg, cancelledAgg, testCancelledAgg, byStatus] = await Promise.all([
      prisma.preorder.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
      prisma.preorder.aggregate({
        where: activeWhere,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
      prisma.preorder.aggregate({
        where: cancelledWhere,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
      prisma.preorder.aggregate({
        where: testCancelledWhere,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
      prisma.preorder.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { _all: true },
        _sum: { totalFcfa: true },
      }),
    ]);

    const topRaw = await prisma.preorderItem.groupBy({
      by: ["productId"],
      where: { preorder: activeWhere },
      _sum: { qty: true, lineTotalFcfa: true },
      orderBy: { _sum: { lineTotalFcfa: "desc" } },
      take: 5,
    });

    const ids = topRaw.map((x) => x.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
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
      totalOrders: activeAgg._count._all,
      totalRevenueFcfa: activeAgg._sum.totalFcfa || 0,
      grossOrders: grossAgg._count._all,
      grossRevenueFcfa: grossAgg._sum.totalFcfa || 0,
      cancelledOrders: cancelledAgg._count._all,
      cancelledRevenueFcfa: cancelledAgg._sum.totalFcfa || 0,
      testCancelledOrders: testCancelledAgg._count._all,
      testCancelledRevenueFcfa: testCancelledAgg._sum.totalFcfa || 0,
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
