const prisma = require("../../prisma");
const { scopeWhere } = require("../../helpers/countryScope");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeInt(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function getStockDashboard(req, res) {
  try {
    const lowStockThreshold = Math.min(
      50,
      Math.max(1, parsePositiveInt(req.query.lowStockThreshold, 5)),
    );

    const countryId = req.countryId;

    const [
      totalProducts,
      inStockCount,
      outOfStockCount,
      lowStockCount,
      stockAggregate,
      toPrepareCount,
      readyCount,
      openAnomaliesCount,
      criticalProducts,
      recentMovements,
    ] = await Promise.all([
      prisma.product.count({ where: scopeWhere(req) }),
      prisma.product.count({ where: scopeWhere(req, { stockQty: { gt: 0 } }) }),
      prisma.product.count({ where: scopeWhere(req, { stockQty: { lte: 0 } }) }),
      prisma.product.count({
        where: scopeWhere(req, {
          stockQty: { gt: 0, lte: lowStockThreshold },
        }),
      }),
      prisma.product.aggregate({
        where: scopeWhere(req),
        _sum: { stockQty: true },
      }),
      prisma.preorder.count({
        where: {
          countryId,
          status: "PAID",
          preparationLaunchedAt: { not: null },
        },
      }),
      prisma.preorder.count({
        where: { countryId, status: "READY" },
      }),
      prisma.preparationAnomaly.count({
        where: {
          preorder: { is: { countryId } },
          resolvedAt: null,
        },
      }),
      prisma.product.findMany({
        where: scopeWhere(req, {
          stockQty: { lte: lowStockThreshold },
        }),
        orderBy: [{ stockQty: "asc" }, { nom: "asc" }],
        take: 8,
        select: {
          id: true,
          sku: true,
          nom: true,
          category: true,
          stockQty: true,
          actif: true,
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          product: { is: { countryId } },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              nom: true,
            },
          },
          preorder: {
            select: {
              id: true,
              preorderNumber: true,
              factureReference: true,
              parcelNumber: true,
            },
          },
          createdByAdmin: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      summary: {
        totalProducts,
        inStockCount,
        outOfStockCount,
        lowStockCount,
        unitsInStock: stockAggregate?._sum?.stockQty || 0,
        toPrepareCount,
        readyCount,
        openAnomaliesCount,
        lowStockThreshold,
      },
      criticalProducts,
      recentMovements,
    });
  } catch (error) {
    console.error("getStockDashboard error:", error);
    return res
      .status(500)
      .json({ message: "Erreur serveur (getStockDashboard)" });
  }
}

async function listStockMovements(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 30));
    const q = String(req.query.q || "").trim();
    const type = String(req.query.type || "").trim().toUpperCase();
    const reason = String(req.query.reason || "").trim().toUpperCase();
    const days = Math.min(180, parsePositiveInt(req.query.days, 30));

    const where = {
      product: { is: { countryId: req.countryId } },
      ...(days
        ? {
            createdAt: {
              gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            },
          }
        : {}),
    };

    if (type && ["DEBIT", "CREDIT"].includes(type)) {
      where.type = type;
    }

    if (
      reason &&
      ["PREPARE_ORDER", "CANCEL_ORDER", "MANUAL_ADJUSTMENT"].includes(reason)
    ) {
      where.reason = reason;
    }

    if (q) {
      where.OR = [
        { product: { is: { nom: { contains: q, mode: "insensitive" } } } },
        { product: { is: { sku: { contains: q, mode: "insensitive" } } } },
        { preorder: { is: { preorderNumber: { contains: q, mode: "insensitive" } } } },
        { preorder: { is: { factureReference: { contains: q, mode: "insensitive" } } } },
        { preorder: { is: { parcelNumber: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              nom: true,
              stockQty: true,
            },
          },
          preorder: {
            select: {
              id: true,
              preorderNumber: true,
              factureReference: true,
              parcelNumber: true,
            },
          },
          createdByAdmin: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    console.error("listStockMovements error:", error);
    return res
      .status(500)
      .json({ message: "Erreur serveur (listStockMovements)" });
  }
}

async function adjustStock(req, res) {
  try {
    const { productId, targetStockQty, deltaQty, note } = req.body || {};

    if (!productId || !String(productId).trim()) {
      return res.status(400).json({ message: "productId requis" });
    }

    const targetQty = parseNonNegativeInt(targetStockQty);
    const delta = deltaQty === undefined || deltaQty === null || deltaQty === ""
      ? null
      : Number.parseInt(deltaQty, 10);

    if (targetQty === null && !Number.isFinite(delta)) {
      return res.status(400).json({
        message: "targetStockQty ou deltaQty requis",
      });
    }

    const product = await prisma.product.findFirst({
      where: scopeWhere(req, { id: String(productId).trim() }),
      select: {
        id: true,
        sku: true,
        nom: true,
        stockQty: true,
      },
    });

    if (!product) {
      return res.status(404).json({ message: "Produit introuvable" });
    }

    const nextStockQty =
      targetQty !== null ? targetQty : Math.max(0, product.stockQty + delta);

    if (nextStockQty < 0) {
      return res
        .status(400)
        .json({ message: "Le stock ne peut pas être négatif" });
    }

    const effectiveDelta = nextStockQty - product.stockQty;

    if (effectiveDelta === 0) {
      return res.json({
        product,
        movement: null,
        changed: false,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: { stockQty: nextStockQty },
        select: {
          id: true,
          sku: true,
          nom: true,
          stockQty: true,
          category: true,
          actif: true,
          updatedAt: true,
        },
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: effectiveDelta > 0 ? "CREDIT" : "DEBIT",
          reason: "MANUAL_ADJUSTMENT",
          qty: Math.abs(effectiveDelta),
          note: note ? String(note).trim() : null,
          meta: {
            previousQty: product.stockQty,
            nextQty: nextStockQty,
            mode: targetQty !== null ? "TARGET" : "DELTA",
          },
          createdById: req.user?.id || null,
        },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              nom: true,
              stockQty: true,
            },
          },
          createdByAdmin: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      });

      return { updatedProduct, movement };
    });

    return res.json({
      product: result.updatedProduct,
      movement: result.movement,
      changed: true,
    });
  } catch (error) {
    console.error("adjustStock error:", error);
    return res.status(500).json({ message: "Erreur serveur (adjustStock)" });
  }
}

module.exports = {
  getStockDashboard,
  listStockMovements,
  adjustStock,
};
