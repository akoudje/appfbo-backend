// src/services/sponsorship-promotion.service.js
// Promotion d'office d'un filleul au grade Animateur adjoint.
//
// Règle (validée le 2026-11-04) : un filleul dont le parrainage est VALIDÉ et
// dont l'achat de parrainage (la commande qui a validé le parrainage) totalise
// au moins 2 CC, ou contient un pack 634 ou 635, est Animateur adjoint dès le
// lendemain de la validation :
//   - il commande au prix Animateur adjoint ;
//   - il peut parrainer à son tour (ses propres filleuls restent facturés au
//     prix Client privilégié, voir sponsorship-purchase.service RECRUIT_GRADE).
//
// La promotion est calculée à la volée (pas de colonne en base) : l'annuaire
// AS400 peut encore indiquer Client privilégié tant qu'il n'est pas à jour, et
// la règle s'applique aussi aux parrainages validés avant sa mise en place.
// Elle ne fait jamais descendre un grade supérieur.

const prisma = require("../prisma");
const { normalizeGrade } = require("./fboDirectory.service");

const PROMOTION_GRADE = "ANIMATEUR_ADJOINT";
const PROMOTION_MIN_CC = 2;
const PROMOTION_PACK_SKUS = new Set(["634", "635"]);
const GRADE_RANK = {
  CLIENT_PRIVILEGIE: 0,
  ANIMATEUR_ADJOINT: 1,
  ANIMATEUR: 2,
  MANAGER_ADJOINT: 3,
  MANAGER: 4,
};

function numeroVariants(numeroFbo) {
  const raw = String(numeroFbo || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return [];
  const canonical = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  return [...new Set([canonical, digits, raw])];
}

// Lendemain de la validation, à minuit UTC (heure de Côte d'Ivoire et du
// Burkina Faso, GMT sans heure d'été).
function nextDayStart(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

function roundCc(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

// Analyse les lignes de l'achat de parrainage : total CC et pack déclencheur.
function analyzePurchaseItems(items = []) {
  let totalCc = 0;
  let packSku = null;
  for (const item of items) {
    totalCc += Number(item.lineTotalCc ?? Number(item.ccUnitaire || 0) * Number(item.qty || 0)) || 0;
    const sku = String(item.productSkuSnapshot || item.product?.sku || "").trim();
    if (!packSku && PROMOTION_PACK_SKUS.has(sku)) packSku = sku;
  }
  totalCc = roundCc(totalCc);
  return { totalCc, packSku, qualifies: totalCc >= PROMOTION_MIN_CC || Boolean(packSku) };
}

// Promotion du filleul portant ce numéro, ou null s'il n'y a pas droit.
// { grade, eligibleFrom, active, sponsorshipId, preorderId, totalCc, packSku }
async function findRecruitPromotion(numeroFbo, { now = new Date(), db = prisma } = {}) {
  const variants = numeroVariants(numeroFbo);
  if (!variants.length) return null;
  const sponsorships = await db.sponsorship.findMany({
    where: {
      recruitFboNumero: { in: variants },
      status: "VALIDATED",
      validatedAt: { not: null },
      qualifyingPreorderId: { not: null },
    },
    orderBy: { validatedAt: "asc" },
    select: { id: true, validatedAt: true, qualifyingPreorderId: true },
  });
  for (const sponsorship of sponsorships) {
    const items = await db.preorderItem.findMany({
      where: { preorderId: sponsorship.qualifyingPreorderId },
      select: {
        qty: true,
        ccUnitaire: true,
        lineTotalCc: true,
        productSkuSnapshot: true,
        product: { select: { sku: true } },
      },
    });
    const analysis = analyzePurchaseItems(items);
    if (!analysis.qualifies) continue;
    const eligibleFrom = nextDayStart(sponsorship.validatedAt);
    return {
      grade: PROMOTION_GRADE,
      eligibleFrom,
      active: now.getTime() >= eligibleFrom.getTime(),
      sponsorshipId: sponsorship.id,
      preorderId: sponsorship.qualifyingPreorderId,
      totalCc: analysis.totalCc,
      packSku: analysis.packSku,
    };
  }
  return null;
}

// Seul un Client privilégié (ou un grade absent) peut être relevé. Un libellé
// brut de l'annuaire est d'abord normalisé (« Supervisor » -> ANIMATEUR) ; un
// libellé inconnu n'est jamais touché, pour ne pas descendre un grade.
function isBelowPromotionGrade(grade) {
  if (!String(grade || "").trim()) return true;
  const rank = GRADE_RANK[normalizeGrade(grade)];
  return rank !== undefined && rank < GRADE_RANK[PROMOTION_GRADE];
}

// Grade effectif : celui de l'annuaire, relevé à Animateur adjoint si le
// filleul y a droit et que la promotion a pris effet. Ne consulte la base que
// pour un Client privilégié.
async function resolveEffectiveGrade(numeroFbo, grade, options = {}) {
  if (!isBelowPromotionGrade(grade)) return { grade, promoted: false, promotion: null };
  const promotion = await findRecruitPromotion(numeroFbo, options);
  if (promotion?.active) return { grade: PROMOTION_GRADE, promoted: true, promotion };
  return { grade, promoted: false, promotion };
}

module.exports = {
  PROMOTION_GRADE,
  PROMOTION_MIN_CC,
  PROMOTION_PACK_SKUS,
  analyzePurchaseItems,
  nextDayStart,
  findRecruitPromotion,
  resolveEffectiveGrade,
};
