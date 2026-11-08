// Rappels « colis payés à lancer » de l'espace agent de vente.
//
// Le lancement de préparation reste manuel (l'agent récupère la référence
// AS400, valide la commande dans l'AS400 et certifie la facture avant de
// cliquer « Lancer prep »). Ce service ne lance donc rien : il expose la
// liste des commandes payées en attente de lancement et les seuils du pays,
// pour que l'interface affiche l'ancienneté de chaque colis et rappelle
// l'agent (son, notification) sans le harceler.
//
// Le chrono part de la confirmation du paiement (paidAt), jamais de la
// préfacture : un client Wave qui paie tard ne pénalise pas l'agent.

const DEFAULT_LAUNCH_ALERT_SETTINGS = Object.freeze({
  warnAfterMinutes: 15,
  alertAfterMinutes: 25,
  reminderIntervalMinutes: 10,
  maxReminders: 3,
});

function positiveInt(value, fallback, { min = 1 } = {}) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

function normalizeLaunchAlertSettings(settings) {
  const defaults = DEFAULT_LAUNCH_ALERT_SETTINGS;
  const alertAfterMinutes = positiveInt(
    settings?.cashierLaunchAlertAfterMinutes,
    defaults.alertAfterMinutes,
  );
  let warnAfterMinutes = positiveInt(
    settings?.cashierLaunchWarnAfterMinutes,
    defaults.warnAfterMinutes,
  );
  // Garde-fou si la base contient un réglage incohérent (la validation des
  // paramètres l'interdit, mais une ancienne ligne pourrait le contenir).
  if (warnAfterMinutes >= alertAfterMinutes) {
    warnAfterMinutes = Math.max(1, alertAfterMinutes - 1);
  }
  return {
    warnAfterMinutes,
    alertAfterMinutes,
    reminderIntervalMinutes: positiveInt(
      settings?.cashierLaunchReminderIntervalMinutes,
      defaults.reminderIntervalMinutes,
    ),
    maxReminders: positiveInt(settings?.cashierLaunchMaxReminders, defaults.maxReminders, {
      min: 0,
    }),
  };
}

async function loadLaunchAlertSettings(db, countryId) {
  const row = await db.countrySettings.findUnique({
    where: { countryId },
    select: {
      cashierLaunchWarnAfterMinutes: true,
      cashierLaunchAlertAfterMinutes: true,
      cashierLaunchReminderIntervalMinutes: true,
      cashierLaunchMaxReminders: true,
    },
  });
  return normalizeLaunchAlertSettings(row);
}

// Même périmètre que la liste « À lancer en préparation » de
// cashier.controller.js#getWorkspace (contentieux AS400 ouverts exclus :
// l'agent ne peut pas les lancer), mais sans les filtres de recherche ou de
// date de l'écran : un rappel ne doit pas disparaître parce que l'agent a
// filtré sur « Espèces ».
function buildPendingLaunchWhere(countryId, { ownerId = null } = {}) {
  return {
    countryId,
    status: "PAID",
    paymentStatus: "PAID",
    preparationLaunchedAt: null,
    paidAt: { not: null },
    OR: [
      { billingEscalationType: null },
      { billingEscalationType: { not: "AS400_CERTIFICATION_MISSING" } },
      { as400CertificationStatus: null },
      { as400CertificationStatus: { notIn: ["OPEN", "REPORTED"] } },
    ],
    ...(ownerId ? { assignedInvoicerId: ownerId } : {}),
  };
}

async function listPendingLaunches(db, countryId, { ownerId = null } = {}) {
  const rows = await db.preorder.findMany({
    where: buildPendingLaunchWhere(countryId, { ownerId }),
    select: {
      id: true,
      paidAt: true,
      parcelNumber: true,
      preorderNumber: true,
      factureReference: true,
      fboNomComplet: true,
      preorderPaymentMode: true,
    },
    orderBy: [{ paidAt: "asc" }],
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    paidAt: row.paidAt,
    label: row.parcelNumber || row.preorderNumber || row.factureReference || row.id,
    factureReference: row.factureReference || null,
    fboNomComplet: row.fboNomComplet || null,
    preorderPaymentMode: row.preorderPaymentMode || null,
  }));
}

module.exports = {
  DEFAULT_LAUNCH_ALERT_SETTINGS,
  normalizeLaunchAlertSettings,
  loadLaunchAlertSettings,
  buildPendingLaunchWhere,
  listPendingLaunches,
};
