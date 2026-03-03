// pricing.service.js6
.30

const prisma = require("../prisma");

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

// Règle simple de livraison (MVP) : tu pourras remplacer plus tard
function computeDeliveryFeeFcfa({ deliveryMode, totalPoidsKg }) {
  if (deliveryMode !== "LIVRAISON") return 0;

  const w = Number(totalPoidsKg);
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
  });
  return row ? Number(row.discountPercent) : 0;
}

function applyDiscount(prixBaseFcfa, discountPercent) {
  const p = Number(prixBaseFcfa);
  const d = Number(discountPercent);
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
      items: { include: { product: true } },
    },
  });
  if (!preorder) throw new Error("PREORDER_NOT_FOUND");

  const discountPercent = await getDiscountPercentByGrade(
    preorder.fboGrade,
    preorder.countryId
  );

  let totalCc = 0;
  let totalPoids = 0;
  let totalProduitsFcfa = 0;

  const computedItems = preorder.items.map((it) => {
    if (it.product.countryId !== preorder.countryId) {
      throw new Error("PRODUCT_COUNTRY_MISMATCH");
    }

    const qty = it.qty;

    const ccU = Number(it.product.cc);
    const poidsU = Number(it.product.poidsKg);
    const prixU = applyDiscount(it.product.prixBaseFcfa, discountPercent);

    const lineCc = ccU * qty;
    const linePoids = poidsU * qty;
    const lineFcfa = prixU * qty;

    totalCc += lineCc;
    totalPoids += linePoids;
    totalProduitsFcfa += lineFcfa;

    return {
      productId: it.productId,
      qty,
      prixUnitaireFcfa: prixU,
      ccUnitaire: ccU,
      poidsUnitaireKg: poidsU,
      lineTotalFcfa: lineFcfa,
      lineTotalCc: round3(lineCc),
      lineTotalPoids: round3(linePoids),
      nom: it.product.nom,
      sku: it.product.sku,
      imageUrl: it.product.imageUrl || null,
    };
  });

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
      totalProduitsFcfa,
      fraisLivraisonFcfa,
      totalFcfa,
    },
  };
}

module.exports = {
  computePreorderTotals,
  getDiscountPercentByGrade,
  computeDeliveryFeeFcfa,
  applyDiscount,
};
