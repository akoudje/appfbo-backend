// src/controllers/admin/navBadges.controller.js
// Compteurs légers pour les pastilles du menu latéral (facturation, caisse,
// parrainages). Volontairement séparé des endpoints de liste complets
// (billingQueue, cashier.getWorkspace, sponsorships.listSponsorships) pour
// rester bon marché à appeler à chaque événement temps réel.

const prisma = require("../../prisma");
const { scopeWhere } = require("../../helpers/countryScope");
const { Permission, AdminRole } = require("../../auth/permissions");
const { BILLING_ACTIVE_STATUSES } = require("../../services/billingQueue.service");

function isFacturierCaissier(role) {
  return String(role || "").trim().toUpperCase() === AdminRole.FACTURIER_CAISSIER;
}

async function countBillingPending(req) {
  // "Pastille facturation" = dossiers déjà attribués à CET utilisateur et
  // encore actifs — même principe que la file de facturation elle-même
  // (assignedInvoicerId), pas le pot commun non réclamé.
  return prisma.preorder.count({
    where: scopeWhere(req, {
      status: "SUBMITTED",
      assignedInvoicerId: req.user?.id || "__no_user__",
      billingWorkStatus: { in: BILLING_ACTIVE_STATUSES },
    }),
  });
}

async function countCashierPending(req) {
  // Mêmes règles que getWorkspace() (cashier.controller.js) : pot commun
  // pour la caissière classique, scopé par assignedInvoicerId pour le
  // facturier caissier. À garder synchronisé si getWorkspace évolue.
  const ownership = isFacturierCaissier(req.user?.role)
    ? { assignedInvoicerId: req.user?.id || "__no_user__" }
    : {};

  const toCollectWhere = scopeWhere(req, {
    status: { in: ["INVOICED", "PAYMENT_PENDING"] },
    ...ownership,
  });
  const toLaunchWhere = scopeWhere(req, {
    status: "PAID",
    paymentStatus: "PAID",
    preparationLaunchedAt: null,
    OR: [
      { billingEscalationType: null },
      { billingEscalationType: { not: "AS400_CERTIFICATION_MISSING" } },
      { as400CertificationStatus: null },
      { as400CertificationStatus: { notIn: ["OPEN", "REPORTED"] } },
    ],
    ...ownership,
  });

  const [toCollect, toLaunch] = await Promise.all([
    prisma.preorder.count({ where: toCollectWhere }),
    prisma.preorder.count({ where: toLaunchWhere }),
  ]);
  return toCollect + toLaunch;
}

async function countSponsorshipsPending(req) {
  // Parrainages pas encore pris en charge : pot commun, pareil pour tous
  // les rôles ayant SPONSORSHIP_REVIEW (voir listSponsorships).
  return prisma.sponsorship.count({
    where: scopeWhere(req, { status: "SUBMITTED" }),
  });
}

// GET /api/admin/nav-badges
async function getNavBadges(req, res) {
  try {
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];

    const [billing, cashier, sponsorships] = await Promise.all([
      permissions.includes(Permission.INVOICE_CREATE) ? countBillingPending(req) : 0,
      permissions.includes(Permission.PAYMENT_VALIDATE) ? countCashierPending(req) : 0,
      permissions.includes(Permission.SPONSORSHIP_REVIEW) ? countSponsorshipsPending(req) : 0,
    ]);

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.json({ billing, cashier, sponsorships });
  } catch (error) {
    console.error("getNavBadges error:", error);
    return res.status(500).json({ message: "Erreur serveur (nav-badges)" });
  }
}

module.exports = {
  getNavBadges,
};
