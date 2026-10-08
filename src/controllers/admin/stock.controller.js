const prisma = require("../../prisma");

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
      prisma.countryProduct.count({ where: { countryId } }),
      prisma.countryProduct.count({
        where: { countryId, stockQty: { gt: 0 } },
      }),
      prisma.countryProduct.count({
        where: { countryId, stockQty: { lte: 0 } },
      }),
      prisma.countryProduct.count({
        where: {
          countryId,
          stockQty: { gt: 0, lte: lowStockThreshold },
        },
      }),
      prisma.countryProduct.aggregate({
        where: { countryId },
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
      prisma.countryProduct.findMany({
        where: {
          countryId,
          stockQty: { lte: lowStockThreshold },
        },
        orderBy: [{ stockQty: "asc" }, { product: { nom: "asc" } }],
        take: 8,
        select: {
          id: true,
          stockQty: true,
          actif: true,
          product: {
            select: {
              id: true,
              sku: true,
              nom: true,
              category: true,
            },
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          countryId,
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
      criticalProducts: criticalProducts.map((item) => ({
        id: item.product.id,
        sku: item.product.sku,
        nom: item.product.nom,
        category: item.product.category,
        stockQty: item.stockQty,
        actif: item.actif,
      })),
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
    const type = String(req.query.type || "")
      .trim()
      .toUpperCase();
    const reason = String(req.query.reason || "")
      .trim()
      .toUpperCase();
    const days = Math.min(180, parsePositiveInt(req.query.days, 30));

    const where = {
      countryId: req.countryId,
      ...(days
        ? {
            createdAt: {
              gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            },
          }
        : {}),
    };

    if (req.query.productId)
      where.productId = String(req.query.productId).trim();
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
        {
          preorder: {
            is: { preorderNumber: { contains: q, mode: "insensitive" } },
          },
        },
        {
          preorder: {
            is: { factureReference: { contains: q, mode: "insensitive" } },
          },
        },
        {
          preorder: {
            is: { parcelNumber: { contains: q, mode: "insensitive" } },
          },
        },
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
    const { integer, text, fail } = require("../../helpers/product-domain");
    const { productId, targetStockQty, deltaQty, note, expectedStockQty } =
      req.body || {};
    if (typeof productId !== "string" || !productId.trim())
      fail("Produit requis.");
    const hasTarget =
      targetStockQty !== undefined &&
      targetStockQty !== null &&
      targetStockQty !== "";
    const hasDelta =
      deltaQty !== undefined && deltaQty !== null && deltaQty !== "";
    if (hasTarget === hasDelta)
      fail("Renseignez une nouvelle quantité ou un écart, pas les deux.");
    const target = hasTarget ? integer(targetStockQty, "Stock") : null;
    const delta = hasDelta ? Number(deltaQty) : null;
    if (
      hasDelta &&
      (!/^-?\d+$/.test(String(deltaQty).trim()) ||
        !Number.isSafeInteger(delta) ||
        Math.abs(delta) > 2147483647)
    )
      fail("Écart de stock invalide.");
    const cleanNote = text(note, "Motif de l’ajustement", 1000);
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.countryProduct.findUnique({
        where: { countryId_productId: { countryId: req.countryId, productId } },
        include: { product: true },
      });
      if (!current) fail("Produit introuvable dans ce pays.", 404);
      if (
        expectedStockQty !== undefined &&
        integer(expectedStockQty, "Stock précédent") !== current.stockQty
      )
        fail("Le stock a changé. Actualisez avant de réessayer.", 409);
      const next = target !== null ? target : current.stockQty + delta;
      if (next < 0 || next > 2147483647)
        fail("Le stock obtenu doit être un entier positif ou nul.");
      const effectiveDelta = next - current.stockQty;
      if (!effectiveDelta)
        return {
          product: { ...current.product, stockQty: current.stockQty },
          movement: null,
          changed: false,
        };
      const claim = await tx.countryProduct.updateMany({
        where: { id: current.id, stockQty: current.stockQty },
        data: { stockQty: next },
      });
      if (claim.count !== 1)
        fail("Le stock a changé. Actualisez avant de réessayer.", 409);
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          countryId: req.countryId,
          type: effectiveDelta > 0 ? "CREDIT" : "DEBIT",
          reason: "MANUAL_ADJUSTMENT",
          qty: Math.abs(effectiveDelta),
          note: cleanNote,
          meta: {
            previousQty: current.stockQty,
            nextQty: next,
            mode: target !== null ? "TARGET" : "DELTA",
          },
          createdById: req.user?.id || null,
        },
      });
      return {
        product: { ...current.product, stockQty: next },
        movement,
        changed: true,
      };
    });
    return res.json(result);
  } catch (error) {
    if (error.statusCode)
      return res.status(error.statusCode).json({ message: error.message });
    console.error("adjustStock error:", error);
    return res
      .status(500)
      .json({ message: "Impossible d’ajuster le stock. Réessayez." });
  }
}

module.exports = {
  getStockDashboard,
  listStockMovements,
  adjustStock,
};
