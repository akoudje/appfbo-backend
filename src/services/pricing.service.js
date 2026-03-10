// src/services/pricing.service.js

const prisma = require("../prisma");

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function toInt(n) {
  return Math.round(Number(n || 0));
}

// Règle simple de livraison (MVP)
function computeDeliveryFeeFcfa({ deliveryMode, totalPoidsKg }) {
  if (deliveryMode !== "LIVRAISON") return 0;

  const w = Number(totalPoidsKg || 0);
  if (w <= 1) return 1000;
  if (w <= 3) return 2000;
  if (w <= 5) return 3000;
  return 5000;
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

function applyDiscount(prixBaseFcfa, discountPercent) {
  const p = Number(prixBaseFcfa || 0);
  const d = Number(discountPercent || 0);

  const discounted = Math.round(p * (1 - d / 100));
  return Math.max(discounted, 0);
}

async function computePreorderTotals(preorderId, countryId) {
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

    if (!it.product.actif) {
      throw new Error("PRODUCT_INACTIVE");
    }

    const qty = Math.max(0, Number(it.qty || 0));
    if (qty <= 0) continue;

    const prixCatalogueFcfa = Number(it.product.prixBaseFcfa || 0);
    const ccUnitaire = Number(it.product.cc || 0);
    const poidsUnitaireKg = Number(it.product.poidsKg || 0);
    const prixUnitaireFcfa = applyDiscount(
      prixCatalogueFcfa,
      discountPercent
    );

    const lineCc = ccUnitaire * qty;
    const linePoids = poidsUnitaireKg * qty;
    const lineFcfa = prixUnitaireFcfa * qty;

    totalCc += lineCc;
    totalPoids += linePoids;
    totalProduitsFcfa += lineFcfa;

    computedItems.push({
      productId: it.productId,
      qty,

      productSkuSnapshot: it.product.sku || null,
      productNameSnapshot: it.product.nom || null,

      prixCatalogueFcfa,
      discountPercent,
      prixUnitaireFcfa,

      ccUnitaire: round3(ccUnitaire),
      poidsUnitaireKg: round3(poidsUnitaireKg),

      lineTotalFcfa: toInt(lineFcfa),
      lineTotalCc: round3(lineCc),
      lineTotalPoids: round3(linePoids),

      nom: it.product.nom,
      sku: it.product.sku,
      imageUrl: it.product.imageUrl || null,
      stockQty: Number(it.product.stockQty || 0),
    });
  }

  const fraisLivraisonFcfa = computeDeliveryFeeFcfa({
    deliveryMode: preorder.deliveryMode,
    totalPoidsKg: totalPoids,
  });

  const totalFcfa = totalProduitsFcfa + fraisLivraisonFcfa;

  return {
    preorder,
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

module.exports = {
  computePreorderTotals,  
  computeCatalogProductsForPreorder,
  getDiscountPercentByGrade,
  computeDeliveryFeeFcfa,
  applyDiscount,
};