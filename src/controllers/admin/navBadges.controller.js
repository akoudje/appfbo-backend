// src/controllers/admin/navBadges.controller.js
// Compteurs légers pour les pastilles du menu latéral (facturation, caisse,
// parrainages). Volontairement séparé des endpoints de liste complets
// (billingQueue, cashier.getWorkspace, sponsorships.listSponsorships) pour
// rester bon marché à appeler à chaque événement temps réel.

const prisma = require("../../prisma");
const { scopeWhere, pickCountryId } = require("../../helpers/countryScope");
const { Permission, AdminRole } = require("../../auth/permissions");
const { BILLING_ACTIVE_STATUSES } = require("../../services/billingQueue.service");
const {
  buildPendingLaunchWhere,
  loadLaunchAlertSettings,
} = require("../../services/cashier-launch-alerts.service");

function isFacturierCaissier(role) {
  return String(role || "").trim().toUpperCase() === AdminRole.FACTURIER_CAISSIER;
}

function countBillingPending(req) {
  // Dossiers attribués à CET utilisateur et encore à facturer (même règle que
  // la charge d'un facturier dans billingQueue.service), pas le pot commun.
  return prisma.preorder.count({
    where: scopeWhere(req, {
      status: "SUBMITTED",
      assignedInvoicerId: req.user?.id || "__no_user__",
      billingWorkStatus: { in: BILLING_ACTIVE_STATUSES },
    }),
  });
}

// Niveau d'urgence de la pastille Caisse, d'après le plus ancien colis payé
// pas encore lancé et les seuils du pays (mêmes que le bandeau de rappel) :
// « none » = chiffre neutre, « warn » = orange, « alert » = rouge.
function launchLevel(oldestPaidAt, settings, now) {
  if (!oldestPaidAt) return "none";
  const waitedMinutes = (now.getTime() - new Date(oldestPaidAt).getTime()) / 60000;
  if (waitedMinutes >= settings.alertAfterMinutes) return "alert";
  if (waitedMinutes >= settings.warnAfterMinutes) return "warn";
  return "none";
}

async function countCashierPending(req, now) {
  // Pot commun pour la caissière classique, dossiers personnels pour l'agent
  // de vente (mêmes règles que getWorkspace dans cashier.controller.js).
  const countryId = pickCountryId(req);
  const ownerId = isFacturierCaissier(req.user?.role) ? req.user?.id || "__no_user__" : null;
  const ownership = ownerId ? { assignedInvoicerId: ownerId } : {};

  // « À lancer » : exactement la règle du bandeau de rappel, pour que le menu
  // et le bandeau n'affichent jamais deux chiffres différents.
  const launchWhere = buildPendingLaunchWhere(countryId, { ownerId });

  const [toCollect, toLaunch, oldest, settings] = await Promise.all([
    prisma.preorder.count({
      where: scopeWhere(req, { status: { in: ["INVOICED", "PAYMENT_PENDING"] }, ...ownership }),
    }),
    prisma.preorder.count({ where: launchWhere }),
    prisma.preorder.findFirst({
      where: launchWhere,
      select: { paidAt: true },
      orderBy: { paidAt: "asc" },
    }),
    loadLaunchAlertSettings(prisma, countryId),
  ]);

  const oldestPaidAt = oldest?.paidAt || null;
  return {
    total: toCollect + toLaunch,
    toCollect,
    toLaunch,
    oldestLaunchPaidAt: oldestPaidAt,
    level: launchLevel(oldestPaidAt, settings, now),
  };
}

function countSponsorshipsPending(req) {
  // Parrainages pas encore pris en charge : pot commun, pareil pour tous
  // les rôles ayant SPONSORSHIP_REVIEW (voir listSponsorships).
  return prisma.sponsorship.count({
    where: scopeWhere(req, { status: "SUBMITTED" }),
  });
}

const EMPTY_CASHIER = { total: 0, toCollect: 0, toLaunch: 0, oldestLaunchPaidAt: null, level: "none" };

// GET /api/admin/nav-badges
// Pas de droit unique requis : chaque compteur vaut 0 si le droit
// correspondant est absent.
async function getNavBadges(req, res) {
  try {
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const now = new Date();

    const [billing, cashier, sponsorships] = await Promise.all([
      permissions.includes(Permission.INVOICE_CREATE) ? countBillingPending(req) : 0,
      permissions.includes(Permission.PAYMENT_VALIDATE) ? countCashierPending(req, now) : EMPTY_CASHIER,
      permissions.includes(Permission.SPONSORSHIP_REVIEW) ? countSponsorshipsPending(req) : 0,
    ]);

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.json({
      serverNow: now.toISOString(),
      billing,
      cashier: cashier.total,
      sponsorships,
      levels: { cashier: cashier.level },
      cashierDetail: {
        toCollect: cashier.toCollect,
        toLaunch: cashier.toLaunch,
        oldestLaunchPaidAt: cashier.oldestLaunchPaidAt,
      },
    });
  } catch (error) {
    console.error("getNavBadges error:", error);
    return res.status(error.statusCode || 500).json({ message: "Erreur serveur (nav-badges)" });
  }
}

module.exports = {
  getNavBadges,
  launchLevel,
};
