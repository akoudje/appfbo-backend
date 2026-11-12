// Onglet « En attente paiement » : état des notifications de paiement et
// renvoi groupé (réservé aux superviseurs de la facturation, voir la route).
const service = require("../../services/billing-payment-notifications.service");
const { performInvoiceResend } = require("./orders.controller");
const { pickCountryId } = require("../../helpers/countryScope");

const countryIdOf = (req) => pickCountryId(req) || null;

function actorOf(req) {
  return {
    id: req.user?.id || null,
    label: req.user?.fullName || req.user?.email || null,
  };
}

// GET /api/admin/billing/payment-notifications?ids=a,b,c
async function getStatuses(req, res) {
  try {
    const statuses = await service.getNotificationStatuses({
      countryId: countryIdOf(req),
      ids: req.query.ids,
    });
    return res.json({ ok: true, statuses, minIntervalMinutes: service.RESEND_MIN_INTERVAL_MS / 60000 });
  } catch (e) {
    console.error("billing payment notifications status error:", e);
    return res.status(500).json({ message: "Impossible de lire l'état des notifications." });
  }
}

// POST /api/admin/billing/payment-notifications/bulk-preview { ids? }
async function previewBulkResend(req, res) {
  try {
    const plan = await service.buildBulkResendPlan({
      countryId: countryIdOf(req),
      ids: Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids : null,
    });
    return res.json({ ok: true, ...plan, current: service.getCurrentJob(countryIdOf(req)) });
  } catch (e) {
    console.error("billing bulk resend preview error:", e);
    return res.status(500).json({ message: "Impossible de préparer le renvoi groupé." });
  }
}

// POST /api/admin/billing/payment-notifications/bulk-resend { ids? }
async function startBulkResend(req, res) {
  try {
    const job = await service.startBulkResend({
      countryId: countryIdOf(req),
      ids: Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids : null,
      actor: actorOf(req),
      resendOne: (orderId) =>
        performInvoiceResend(req, orderId, {
          logLabel: "Notification de paiement renvoyée (renvoi groupé)",
        }),
    });
    return res.status(202).json({ ok: true, job });
  } catch (e) {
    if (e.statusCode === 409) return res.status(409).json({ message: e.message, job: e.job || null });
    console.error("billing bulk resend start error:", e);
    return res.status(500).json({ message: "Impossible de lancer le renvoi groupé." });
  }
}

// GET /api/admin/billing/payment-notifications/bulk-resend/current
// GET /api/admin/billing/payment-notifications/bulk-resend/:jobId
async function getBulkResendJob(req, res) {
  const countryId = countryIdOf(req);
  const job =
    req.params.jobId === "current"
      ? service.getCurrentJob(countryId)
      : service.getJob(req.params.jobId, countryId);
  if (!job && req.params.jobId !== "current") {
    return res.status(404).json({ message: "Renvoi groupé introuvable (terminé depuis plus d'une heure ?)." });
  }
  return res.json({ ok: true, job });
}

module.exports = { getStatuses, previewBulkResend, startBulkResend, getBulkResendJob };
