/**
 * Crée 10 précommandes fictives (CIV, isTest=true) pour tester le workflow
 * du rôle Facturier caissier (file de facturation, encaissement,
 * certification AS400, lancement préparation) sans fausser les rapports.
 *
 * Réutilise la même logique de tarification/numérotation que la vraie
 * soumission (preorders.controller.js#submit), mais sans déclencher l'envoi
 * de SMS/email (sendPreorderNotification n'est jamais appelé ici).
 *
 * Usage: node backend/scripts/create-test-preorders-facturier-caissier.js
 */

const prisma = require("../src/prisma");
const { formatDateKey, formatPreorderNumber } = require("../src/helpers/preorder-number");
const { computePreorderTotals } = require("../src/services/pricing.service");
const { publishRealtimeEvent } = require("../src/services/realtime-events.service");

const COUNTRY_CODE = "CIV";

// Produits actifs avec prix par grade CLIENT_PRIVILEGIE déjà configuré en CIV.
const PRODUCT_IDS = {
  FAB_X: "cmmxovlf5000e202culidwemp", // Fab X Forever Active Boost X
  FAB: "cmmp1om56000l8cv7ngtr6vuz", // FAB - Forever Active Boost
  ALOE_BERRY: "cmmp1oqgx001n8cv7sp7sjgcs", // Aloe Berry Nectar
  FOREVER_KIDS: "cmngfwg4g00f1rrvijn0w8e52", // Forever Kids
};

const TEST_FBOS = [
  {
    numeroFbo: "000-000-000-901",
    nomComplet: "FBO TEST FACTURIER CAISSIER 1",
    email: "test-facturier-caissier-1@example.invalid",
  },
  {
    numeroFbo: "000-000-000-902",
    nomComplet: "FBO TEST FACTURIER CAISSIER 2",
    email: "test-facturier-caissier-2@example.invalid",
  },
];

// 10 paniers variés, répartis entre les 2 FBO de test et les 2 modes de
// paiement les plus utiles à tester côté caisse (espèces = encaissement
// manuel, Wave = suivi paiement électronique).
const ORDER_PLANS = [
  { fbo: 0, mode: "ESPECES", items: [{ productId: PRODUCT_IDS.FAB_X, qty: 10 }] },
  { fbo: 1, mode: "WAVE", items: [{ productId: PRODUCT_IDS.ALOE_BERRY, qty: 2 }] },
  { fbo: 0, mode: "ESPECES", items: [{ productId: PRODUCT_IDS.FAB, qty: 8 }, { productId: PRODUCT_IDS.FOREVER_KIDS, qty: 1 }] },
  { fbo: 1, mode: "WAVE", items: [{ productId: PRODUCT_IDS.FAB_X, qty: 15 }] },
  { fbo: 0, mode: "ESPECES", items: [{ productId: PRODUCT_IDS.ALOE_BERRY, qty: 3 }] },
  { fbo: 1, mode: "ESPECES", items: [{ productId: PRODUCT_IDS.FOREVER_KIDS, qty: 4 }] },
  { fbo: 0, mode: "WAVE", items: [{ productId: PRODUCT_IDS.FAB, qty: 12 }] },
  { fbo: 1, mode: "ESPECES", items: [{ productId: PRODUCT_IDS.FAB_X, qty: 6 }, { productId: PRODUCT_IDS.ALOE_BERRY, qty: 1 }] },
  { fbo: 0, mode: "WAVE", items: [{ productId: PRODUCT_IDS.FOREVER_KIDS, qty: 3 }] },
  { fbo: 1, mode: "ESPECES", items: [{ productId: PRODUCT_IDS.FAB, qty: 20 }] },
];

async function ensureTestFbo(profile, pointDeVente) {
  return prisma.fbo.upsert({
    where: { numeroFbo: profile.numeroFbo },
    update: {},
    create: {
      numeroFbo: profile.numeroFbo,
      nomComplet: profile.nomComplet,
      email: profile.email,
      grade: "CLIENT_PRIVILEGIE",
      pointDeVente,
    },
  });
}

async function nextPreorderNumber(countryId, countryCode, dateKey) {
  const last = await prisma.preorder.findFirst({
    where: { countryId, preorderDateKey: dateKey },
    orderBy: { preorderSeq: "desc" },
    select: { preorderSeq: true },
  });
  const seq = (last?.preorderSeq || 0) + 1;
  return { seq, preorderNumber: formatPreorderNumber({ countryCode, dateKey, seq }) };
}

async function createTestOrder({ country, countrySettings, fbo, items, paymentMode }) {
  const dateKey = formatDateKey(new Date());
  const { seq, preorderNumber } = await nextPreorderNumber(country.id, country.code, dateKey);
  const now = new Date();

  const preorder = await prisma.preorder.create({
    data: {
      countryId: country.id,
      fboId: fbo.id,
      fboNumero: fbo.numeroFbo,
      fboNomComplet: fbo.nomComplet,
      fboEmail: fbo.email,
      fboGrade: fbo.grade,
      pointDeVente: fbo.pointDeVente,
      preorderPaymentMode: paymentMode,
      deliveryMode: "RETRAIT_SITE_FLP",
      personalDataConsentAccepted: true,
      personalDataConsentAcceptedAt: now,
      personalDataConsentVersion: "preorder-recap-v1",
      status: "DRAFT",
      billingWorkStatus: "NONE",
      paymentStatus: "UNPAID",
      preorderNumber,
      preorderSeq: seq,
      preorderDateKey: dateKey,
      isTest: true,
    },
  });

  // Lignes créées à zéro puis repricées via computePreorderTotals, exactement
  // comme setItems() + submit() le font pour une vraie soumission.
  await prisma.preorderItem.createMany({
    data: items.map((it) => ({
      preorderId: preorder.id,
      productId: it.productId,
      qty: it.qty,
      prixCatalogueFcfa: 0,
      discountPercent: "0.00",
      prixUnitaireFcfa: 0,
      ccUnitaire: "0.000",
      poidsUnitaireKg: "0.000",
      lineTotalFcfa: 0,
      lineTotalCc: "0.000",
      lineTotalPoids: "0.000",
    })),
  });

  const summary = await computePreorderTotals(preorder.id, country.id);
  const timeoutMin = countrySettings?.billingClaimTimeoutMin || 30;
  const sla = new Date(now.getTime() + timeoutMin * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    for (const it of summary.items) {
      await tx.preorderItem.update({
        where: { preorderId_productId: { preorderId: preorder.id, productId: it.productId } },
        data: {
          productSkuSnapshot: it.sku || null,
          productNameSnapshot: it.nom || null,
          prixCatalogueFcfa: it.prixCatalogueFcfa != null ? it.prixCatalogueFcfa : it.prixUnitaireFcfa,
          discountPercent: String(Number(it.discountPercent != null ? it.discountPercent : 0).toFixed(2)),
          prixUnitaireFcfa: it.prixUnitaireFcfa,
          ccUnitaire: String(Number(it.ccUnitaire || 0).toFixed(3)),
          poidsUnitaireKg: String(Number(it.poidsUnitaireKg || 0).toFixed(3)),
          lineTotalFcfa: it.lineTotalFcfa,
          lineTotalCc: String(Number(it.lineTotalCc || 0).toFixed(3)),
          lineTotalPoids: String(Number(it.lineTotalPoids || 0).toFixed(3)),
        },
      });
    }

    await tx.preorder.update({
      where: { id: preorder.id },
      data: {
        status: "SUBMITTED",
        paymentStatus: "UNPAID",
        billingWorkStatus: "QUEUED",
        billingQueueEnteredAt: now,
        billingSlaDeadlineAt: sla,
        totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
        totalPoidsKg: String(Number(summary.totals.totalPoidsKg || 0).toFixed(3)),
        totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
        fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
        emballageFcfa: summary.totals.emballageFcfa || 0,
        totalFcfa: summary.totals.totalFcfa || 0,
        submittedAt: now,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "SUBMIT",
        note: "Précommande de test soumise (génération automatique pour valider le rôle Facturier caissier).",
        meta: { preorderNumber, totalFcfa: summary.totals.totalFcfa, itemsCount: summary.items.length, isTest: true },
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "ENQUEUE_BILLING",
        note: "Précommande de test ajoutée à la file de facturation",
        meta: { billingWorkStatus: "QUEUED", billingSlaDeadlineAt: sla.toISOString() },
      },
    });
  });

  publishRealtimeEvent({
    countryId: country.id,
    eventKey: "billing_queue_new",
    orderId: preorder.id,
    meta: { status: "SUBMITTED", billingWorkStatus: "QUEUED", assignedInvoicerId: null, autoAssigned: false },
  });

  return { preorderNumber, totalFcfa: summary.totals.totalFcfa };
}

async function main() {
  const country = await prisma.country.findUnique({ where: { code: COUNTRY_CODE } });
  if (!country) throw new Error(`Pays introuvable: ${COUNTRY_CODE}`);

  const countrySettings = await prisma.countrySettings.findUnique({ where: { countryId: country.id } });
  const pointDeVente = countrySettings?.defaultPointDeVente || "ABIDJAN";

  const fbos = await Promise.all(TEST_FBOS.map((profile) => ensureTestFbo(profile, pointDeVente)));

  for (const [index, plan] of ORDER_PLANS.entries()) {
    const result = await createTestOrder({
      country,
      countrySettings,
      fbo: fbos[plan.fbo],
      items: plan.items,
      paymentMode: plan.mode,
    });
    console.log(`[${index + 1}/10] ${result.preorderNumber} — ${result.totalFcfa} FCFA (${plan.mode})`);
  }
}

main()
  .catch((error) => {
    console.error("[ERREUR]", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
