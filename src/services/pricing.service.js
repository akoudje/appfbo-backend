// pricing.service.js
// Service de calcul des prix et totaux pour les précommandes, en tenant compte des remises liées au grade FBO, des frais de livraison selon le poids, et des détails produits.

const prisma = require("../prisma");

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
          product: true,
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

function computeLineFromProduct(product, qty, discountPercent) {
  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  if (!product.actif) {
    throw new Error("PRODUCT_INACTIVE");
  }

  const safeQty = Math.max(0, Number(qty || 0));
  if (safeQty <= 0) return null;

  const prixCatalogueFcfa = Number(product.prixBaseFcfa || 0);
  const ccUnitaire = Number(product.cc || 0);
  const poidsUnitaireKg = Number(product.poidsKg || 0);
  const prixUnitaireFcfa = applyDiscount(prixCatalogueFcfa, discountPercent);

  const lineTotalFcfa = prixUnitaireFcfa * safeQty;
  const lineTotalCc = ccUnitaire * safeQty;
  const lineTotalPoids = poidsUnitaireKg * safeQty;

  return {
    qty: safeQty,

    prixCatalogueFcfa,
    discountPercent,
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
      countryId: preorder.countryId,
      actif: true,
    },
    orderBy: { nom: "asc" },
  });

  return products.map((product) => {
    const prixBaseFcfa = Number(product.prixBaseFcfa || 0);
    const prixFinalFcfa = applyDiscount(prixBaseFcfa, discountPercent);

    return {
      id: product.id,
      sku: product.sku,
      nom: product.nom,
      imageUrl: product.imageUrl || null,
      category: product.category,
      details: product.details || null,
      stockQty: Number(product.stockQty || 0),

      prixBaseFcfa,
      discountPercent,
      prixFinalFcfa,

      cc: Number(product.cc || 0),
      poidsKg: Number(product.poidsKg || 0),
    };
  });
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

    if (it.product.countryId !== preorder.countryId) {
      throw new Error("PRODUCT_COUNTRY_MISMATCH");
    }

    const line = computeLineFromProduct(it.product, it.qty, discountPercent);
    if (!line) continue;

    totalCc += line.lineTotalCc;
    totalPoids += line.lineTotalPoids;
    totalProduitsFcfa += line.lineTotalFcfa;

    computedItems.push({
      productId: it.productId,
      qty: line.qty,

      productSkuSnapshot: it.product.sku || null,
      productNameSnapshot: it.product.nom || null,

      prixCatalogueFcfa: line.prixCatalogueFcfa,
      discountPercent: line.discountPercent,
      prixUnitaireFcfa: line.prixUnitaireFcfa,

      ccUnitaire: line.ccUnitaire,
      poidsUnitaireKg: line.poidsUnitaireKg,

      lineTotalFcfa: line.lineTotalFcfa,
      lineTotalCc: line.lineTotalCc,
      lineTotalPoids: line.lineTotalPoids,

      nom: it.product.nom,
      sku: it.product.sku,
      imageUrl: it.product.imageUrl || null,
      stockQty: Number(it.product.stockQty || 0),
      category: it.product.category,
      details: it.product.details || null,
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
  computeCatalogProductsForPreorder,
  getDiscountPercentByGrade,
  getPreorderPricingContext,
  computeDeliveryFeeFcfa,
  computeLineFromProduct,
  applyDiscount,
};