// pricing.service.js
// Service de calcul des prix et totaux pour les précommandes, en tenant compte des remises liées au grade FBO, des frais de livraison selon le poids, et des détails produits.

const prisma = require("../prisma");

const DIRECT_GRADE_PRICE_COUNTRY_CODES = new Set(["BFA"]);

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function toInt(n) {
  return Math.round(Number(n || 0));
}

function computeDeliveryFeeFcfa({ deliveryMode, totalPoidsKg }) {
  if (deliveryMode !== "LIVRAISON") return 0;

  const w = Number(totalPoidsKg || 0);
  if (w <= 1) return 1000;
  if (w <= 3) return 2000;
  if (w <= 5) return 3000;
  return 5000;
}

function applyDiscount(prixBaseFcfa, discountPercent) {
  const p = Number(prixBaseFcfa || 0);
  const d = Number(discountPercent || 0);

  const discounted = Math.round(p * (1 - d / 100));
  return Math.max(discounted, 0);
}

function usesDirectGradePricing(countryCode) {
  return DIRECT_GRADE_PRICE_COUNTRY_CODES.has(
    String(countryCode || "").trim().toUpperCase(),
  );
}

function pickGradePrice(product, countryId, grade) {
  if (!Array.isArray(product?.gradePrices)) return null;
  const normalizedGrade = String(grade || "").trim().toUpperCase();
  return (
    product.gradePrices.find(
      (item) => item.countryId === countryId && item.grade === normalizedGrade,
    ) || null
  );
}

function pickCountryProduct(product, countryId) {
  if (!Array.isArray(product?.countryProducts)) return null;
  return product.countryProducts.find((item) => item.countryId === countryId) || null;
}

function applyCountryAvailability(product, countryId) {
  const availability = pickCountryProduct(product, countryId);
  if (!availability) return product;
  return {
    ...product,
    prixBaseFcfa: availability.prixBaseFcfa,
    stockQty: availability.stockQty,
    actif: availability.actif,
    maxQtyPerOrder: availability.maxQtyPerOrder,
  };
}

async function getDiscountPercentByGrade(grade, countryId) {
  const row = await prisma.gradeDiscount.findUnique({
    where: {
      countryId_grade: {
        countryId,
        grade,
      },
    },
    select: {
      discountPercent: true,
    },
  });

  return row ? Number(row.discountPercent) : 0;
}

async function getPreorderPricingContext(preorderId, countryId) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      ...(countryId ? { countryId } : {}),
    },
    include: {
      items: {
        include: {
          product: {
            include: {
              countryProducts: true,
              gradePrices: {
                where: { countryId },
              },
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      country: {
        include: {
          settings: true,
        },
      },
    },
  });

  if (!preorder) {
    throw new Error("PREORDER_NOT_FOUND");
  }

  const discountPercent = await getDiscountPercentByGrade(
    preorder.fboGrade,
    preorder.countryId
  );

  return {
    preorder,
    discountPercent,
  };
}

async function getPreorderPricingContextForGrade(
  preorderId,
  countryId,
  gradeOverride,
) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      ...(countryId ? { countryId } : {}),
    },
    include: {
      items: {
        include: {
          product: {
            include: {
              countryProducts: true,
              gradePrices: {
                where: { countryId },
              },
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      country: {
        include: {
          settings: true,
        },
      },
    },
  });

  if (!preorder) {
    throw new Error("PREORDER_NOT_FOUND");
  }

  const effectiveGrade = String(gradeOverride || preorder.fboGrade || "")
    .trim()
    .toUpperCase();

  const discountPercent = await getDiscountPercentByGrade(
    effectiveGrade,
    preorder.countryId
  );

  return {
    preorder: {
      ...preorder,
      fboGrade: effectiveGrade,
    },
    discountPercent,
  };
}

function computeLineFromProduct(product, qty, discountPercent, countryId = null) {
  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const effectiveProduct = countryId
    ? applyCountryAvailability(product, countryId)
    : product;

  if (!effectiveProduct.actif) {
    throw new Error("PRODUCT_INACTIVE");
  }

  const safeQty = Math.max(0, Number(qty || 0));
  if (safeQty <= 0) return null;

  const prixCatalogueFcfa = Number(effectiveProduct.prixBaseFcfa || 0);
  const ccUnitaire = Number(effectiveProduct.cc || 0);
  const poidsUnitaireKg = Number(effectiveProduct.poidsKg || 0);
  const directGradePrice = Number(effectiveProduct.directGradePriceFcfa);
  const hasDirectGradePrice = Number.isFinite(directGradePrice) && directGradePrice >= 0;
  const prixUnitaireFcfa = hasDirectGradePrice
    ? Math.round(directGradePrice)
    : applyDiscount(prixCatalogueFcfa, discountPercent);
  const appliedDiscountPercent = hasDirectGradePrice ? 0 : discountPercent;

  const lineTotalFcfa = prixUnitaireFcfa * safeQty;
  const lineTotalCc = ccUnitaire * safeQty;
  const lineTotalPoids = poidsUnitaireKg * safeQty;

  return {
    qty: safeQty,

    prixCatalogueFcfa,
    discountPercent: appliedDiscountPercent,
    prixUnitaireFcfa,

    ccUnitaire: round3(ccUnitaire),
    poidsUnitaireKg: round3(poidsUnitaireKg),

    lineTotalFcfa: toInt(lineTotalFcfa),
    lineTotalCc: round3(lineTotalCc),
    lineTotalPoids: round3(lineTotalPoids),
  };
}

async function computeCatalogProductsForPreorder(preorderId, countryId) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      ...(countryId ? { countryId } : {}),
    },
    select: {
      id: true,
      countryId: true,
      fboGrade: true,
      country: {
        select: { code: true },
      },
    },
  });

  if (!preorder) {
    throw new Error("PREORDER_NOT_FOUND");
  }

  const discountPercent = await getDiscountPercentByGrade(
    preorder.fboGrade,
    preorder.countryId
  );

  const products = await prisma.product.findMany({
    where: {
      countryProducts: {
        some: {
          countryId: preorder.countryId,
          actif: true,
        },
      },
    },
    orderBy: { nom: "asc" },
    include: {
      countryProducts: {
        where: { countryId: preorder.countryId },
      },
      gradePrices: {
        where: { countryId: preorder.countryId },
      },
    },
  });

  const directPricing = usesDirectGradePricing(preorder.country?.code);

  return products
    .map((product) => {
      const effectiveProduct = applyCountryAvailability(product, preorder.countryId);
      const prixBaseFcfa = Number(effectiveProduct.prixBaseFcfa || 0);
      const gradePrice = directPricing
        ? pickGradePrice(product, preorder.countryId, preorder.fboGrade)
        : null;

      if (directPricing && !gradePrice) return null;

      const prixFinalFcfa = gradePrice
        ? Number(gradePrice.prixFcfa || 0)
        : applyDiscount(prixBaseFcfa, discountPercent);

      return {
        id: product.id,
        sku: product.sku,
        nom: product.nom,
        imageUrl: product.imageUrl || null,
        category: product.category,
        details: product.details || null,
        stockQty: Number(effectiveProduct.stockQty || 0),
        maxQtyPerOrder:
          effectiveProduct.maxQtyPerOrder == null ? null : Number(effectiveProduct.maxQtyPerOrder),

        prixBaseFcfa,
        discountPercent: gradePrice ? 0 : discountPercent,
        prixFinalFcfa,
        pricingMode: gradePrice ? "DIRECT_GRADE_PRICE" : "DISCOUNT_FROM_PUBLIC_PRICE",

        cc: Number(product.cc || 0),
        poidsKg: Number(product.poidsKg || 0),
      };
    })
    .filter(Boolean);
}

async function computePreorderTotals(preorderId, countryId) {
  const { preorder, discountPercent } = await getPreorderPricingContext(
    preorderId,
    countryId
  );

  let totalCc = 0;
  let totalPoids = 0;
  let totalProduitsFcfa = 0;

  const computedItems = [];

  for (const it of preorder.items) {
    if (!it.product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    if (!pickCountryProduct(it.product, preorder.countryId)) {
      throw new Error("PRODUCT_COUNTRY_MISMATCH");
    }

    const product = applyCountryAvailability(it.product, preorder.countryId);
    const directPricing = usesDirectGradePricing(preorder.country?.code);
    const gradePrice = directPricing
      ? pickGradePrice(it.product, preorder.countryId, preorder.fboGrade)
      : null;
    if (directPricing && !gradePrice) {
      throw new Error("PRODUCT_GRADE_PRICE_MISSING");
    }
    if (gradePrice) {
      product.directGradePriceFcfa = Number(gradePrice.prixFcfa || 0);
    }
    const line = computeLineFromProduct(product, it.qty, discountPercent);
    if (!line) continue;

    totalCc += line.lineTotalCc;
    totalPoids += line.lineTotalPoids;
    totalProduitsFcfa += line.lineTotalFcfa;

    computedItems.push({
      productId: it.productId,
      qty: line.qty,

      productSkuSnapshot: product.sku || null,
      productNameSnapshot: product.nom || null,

      prixCatalogueFcfa: line.prixCatalogueFcfa,
      discountPercent: line.discountPercent,
      prixUnitaireFcfa: line.prixUnitaireFcfa,

      ccUnitaire: line.ccUnitaire,
      poidsUnitaireKg: line.poidsUnitaireKg,

      lineTotalFcfa: line.lineTotalFcfa,
      lineTotalCc: line.lineTotalCc,
      lineTotalPoids: line.lineTotalPoids,

      nom: product.nom,
      sku: product.sku,
      imageUrl: product.imageUrl || null,
      stockQty: Number(product.stockQty || 0),
      maxQtyPerOrder:
        product.maxQtyPerOrder == null
          ? null
          : Number(product.maxQtyPerOrder),
      category: product.category,
      details: product.details || null,
    });
  }

  const fraisLivraisonFcfa = computeDeliveryFeeFcfa({
    deliveryMode: preorder.deliveryMode,
    totalPoidsKg: totalPoids,
  });

  const totalFcfa = totalProduitsFcfa + fraisLivraisonFcfa;

  return {
    preorder: {
      ...preorder,
      preorderPaymentMode: preorder?.preorderPaymentMode || null,
    },
    discountPercent,
    items: computedItems,
    totals: {
      totalCc: round3(totalCc),
      totalPoidsKg: round3(totalPoids),
      totalProduitsFcfa: toInt(totalProduitsFcfa),
      fraisLivraisonFcfa: toInt(fraisLivraisonFcfa),
      totalFcfa: toInt(totalFcfa),
    },
  };
}

async function computePreorderTotalsForGrade(preorderId, countryId, gradeOverride) {
  const { preorder, discountPercent } = await getPreorderPricingContextForGrade(
    preorderId,
    countryId,
    gradeOverride
  );

  let totalCc = 0;
  let totalPoids = 0;
  let totalProduitsFcfa = 0;

  const computedItems = [];

  for (const it of preorder.items) {
    if (!it.product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    if (!pickCountryProduct(it.product, preorder.countryId)) {
      throw new Error("PRODUCT_COUNTRY_MISMATCH");
    }

    const product = applyCountryAvailability(it.product, preorder.countryId);
    const directPricing = usesDirectGradePricing(preorder.country?.code);
    const gradePrice = directPricing
      ? pickGradePrice(it.product, preorder.countryId, preorder.fboGrade)
      : null;
    if (directPricing && !gradePrice) {
      throw new Error("PRODUCT_GRADE_PRICE_MISSING");
    }
    if (gradePrice) {
      product.directGradePriceFcfa = Number(gradePrice.prixFcfa || 0);
    }
    const line = computeLineFromProduct(product, it.qty, discountPercent);
    if (!line) continue;

    totalCc += line.lineTotalCc;
    totalPoids += line.lineTotalPoids;
    totalProduitsFcfa += line.lineTotalFcfa;

    computedItems.push({
      productId: it.productId,
      qty: line.qty,

      productSkuSnapshot: product.sku || null,
      productNameSnapshot: product.nom || null,

      prixCatalogueFcfa: line.prixCatalogueFcfa,
      discountPercent: line.discountPercent,
      prixUnitaireFcfa: line.prixUnitaireFcfa,

      ccUnitaire: line.ccUnitaire,
      poidsUnitaireKg: line.poidsUnitaireKg,

      lineTotalFcfa: line.lineTotalFcfa,
      lineTotalCc: line.lineTotalCc,
      lineTotalPoids: line.lineTotalPoids,

      nom: product.nom,
      sku: product.sku,
      imageUrl: product.imageUrl || null,
      stockQty: Number(product.stockQty || 0),
      maxQtyPerOrder:
        product.maxQtyPerOrder == null
          ? null
          : Number(product.maxQtyPerOrder),
      category: product.category,
      details: product.details || null,
    });
  }

  const fraisLivraisonFcfa = computeDeliveryFeeFcfa({
    deliveryMode: preorder.deliveryMode,
    totalPoidsKg: totalPoids,
  });

  const totalFcfa = totalProduitsFcfa + fraisLivraisonFcfa;

  return {
    preorder: {
      ...preorder,
      preorderPaymentMode: preorder?.preorderPaymentMode || null,
    },
    discountPercent,
    items: computedItems,
    totals: {
      totalCc: round3(totalCc),
      totalPoidsKg: round3(totalPoids),
      totalProduitsFcfa: toInt(totalProduitsFcfa),
      fraisLivraisonFcfa: toInt(fraisLivraisonFcfa),
      totalFcfa: toInt(totalFcfa),
    },
  };
}

module.exports = {
  computePreorderTotals,
  computePreorderTotalsForGrade,
  computeCatalogProductsForPreorder,
  getDiscountPercentByGrade,
  getPreorderPricingContext,
  getPreorderPricingContextForGrade,
  computeDeliveryFeeFcfa,
  computeLineFromProduct,
  applyDiscount,
  usesDirectGradePricing,
};
