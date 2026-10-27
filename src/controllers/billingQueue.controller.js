// src/controllers/billingQueue.controller.js
// Contrôleur pour gérer la file de précommandes à facturer

const billingQueueService = require("../services/billingQueue.service");
const { publishRealtimeEvent, getConnectedRealtimeUserIds } = require("../services/realtime-events.service");
const { buildInvoicerReport, buildSupervisionReport } = require("../services/billing-report.service");

// Facturier caissier : les dossiers lui sont attribués par la répartition
// automatique (dispatchBillingQueue), il ne se sert pas dans la file.
function isAutoDispatched(req) {
  return billingQueueService.BILLING_AUTO_DISPATCH_ROLES.includes(req.user?.role);
}

async function claimNext(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }
    if (isAutoDispatched(req)) return res.json({ ok: false, reason: "AUTO_DISPATCH" });

    const result = await billingQueueService.claimNextPreorderForInvoicer({
      userId,
      countryId,
    });

    return res.json(result);
  } catch (e) {
    console.error("claimNext error:", e);
    return res.status(500).json({ message: e.message || "Erreur claimNext" });
  }
}

async function claimSpecific(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }
    if (isAutoDispatched(req)) return res.json({ ok: false, reason: "AUTO_DISPATCH" });

    const result = await billingQueueService.claimSpecificPreorderForInvoicer({
      preorderId: id,
      userId,
      countryId,
    });

    return res.json(result);
  } catch (e) {
    console.error("claimSpecific error:", e);
    return res.status(500).json({ message: e.message || "Erreur claimSpecific" });
  }
}

async function startWork(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    const result = await billingQueueService.startBillingWork({
      preorderId: id,
      userId,
      countryId,
    });

    return res.json(result);
  } catch (e) {
    console.error("startWork error:", e);
    return res.status(400).json({ message: e.message || "Erreur startWork" });
  }
}

async function releaseWork(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    const result = await billingQueueService.releaseBillingWork({
      preorderId: id,
      userId,
      countryId,
      reason,
    });

    publishRealtimeEvent({
      countryId,
      eventKey: "billing_queue_new",
      orderId: id,
      meta: {
        billingWorkStatus: result?.billingWorkStatus || "RELEASED",
        assignedInvoicerId: result?.assignedInvoicerId || null,
        autoAssigned: false,
      },
    });

    // Dossier remis en file : la répartition automatique le reprend aussitôt.
    billingQueueService.dispatchBillingQueue({ countryId }).catch((error) => {
      console.error("[billingQueue] dispatch after release error:", error);
    });

    return res.json({
      ...result,
      reassigned: false,
      reassignedTo: null,
      billingWorkStatus: result?.billingWorkStatus || "RELEASED",
      assignedInvoicerId: result?.assignedInvoicerId || null,
    });
  } catch (e) {
    console.error("releaseWork error:", e);
    return res.status(400).json({ message: e.message || "Erreur releaseWork" });
  }
}

async function escalateWork(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;
    const { id } = req.params;
    const { reason, escalationType, as400Reference, as400AmountFcfa } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    const result = await billingQueueService.escalateBillingWork({
      preorderId: id,
      userId,
      countryId,
      reason,
      escalationType,
      as400Reference,
      as400AmountFcfa,
    });

    publishRealtimeEvent({
      countryId,
      eventKey:
        String(escalationType || "").trim().toUpperCase() ===
        billingQueueService.AS400_CERTIFICATION_MISSING_TYPE
          ? "as400_certification_dispute_new"
          : "billing_escalated_new",
      orderId: id,
      meta: {
        billingWorkStatus: "ESCALATED",
        billingEscalationType: result?.billingEscalationType || null,
        as400CertificationStatus: result?.as400CertificationStatus || null,
      },
    });

    return res.json(result);
  } catch (e) {
    console.error("escalateWork error:", e);
    return res.status(400).json({ message: e.message || "Erreur escalateWork" });
  }
}

async function resolveAs400CertificationDispute(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;
    const { id } = req.params;
    const { note, as400Reference, as400AmountFcfa } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    const result = await billingQueueService.resolveAs400CertificationDispute({
      preorderId: id,
      userId,
      countryId,
      note,
      as400Reference,
      as400AmountFcfa,
    });

    publishRealtimeEvent({
      countryId,
      eventKey: "as400_certification_dispute_resolved",
      orderId: id,
      meta: {
        billingEscalationType: result?.billingEscalationType || null,
        as400CertificationStatus: result?.as400CertificationStatus || null,
      },
    });

    return res.json(result);
  } catch (e) {
    console.error("resolveAs400CertificationDispute error:", e);
    return res.status(400).json({
      message: e.message || "Erreur resolveAs400CertificationDispute",
    });
  }
}

async function resolveEscalation(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;
    const { id } = req.params;
    const { note } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    const result = await billingQueueService.resolveBillingEscalation({
      preorderId: id,
      userId,
      countryId,
      note,
    });

    publishRealtimeEvent({
      countryId,
      eventKey: "billing_escalation_resolved",
      orderId: id,
      meta: {
        billingWorkStatus: result?.billingWorkStatus || null,
      },
    });

    return res.json(result);
  } catch (e) {
    console.error("resolveEscalation error:", e);
    return res.status(e.statusCode || 400).json({
      message: e.message || "Erreur resolveEscalation",
    });
  }
}

// GET /api/admin/billing/invoicers : facturiers du pays, connexion et charge.
async function listInvoicers(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const invoicers = await billingQueueService.listBillingInvoicers({ countryId });
    return res.json({ invoicers });
  } catch (e) {
    console.error("listInvoicers error:", e);
    return res.status(500).json({ message: "Impossible de charger les facturiers." });
  }
}

const ASSIGN_ERROR_MESSAGES = {
  INVOICER_NOT_FOUND: "Facturier introuvable ou inactif.",
  PREORDER_NOT_FOUND: "Précommande introuvable.",
  PREORDER_NOT_ASSIGNABLE: "Cette précommande n'est plus à facturer : elle ne peut pas être attribuée.",
  PREORDER_CHANGED: "La précommande vient d'être modifiée. Rechargez la file et réessayez.",
};

// POST /api/admin/billing/:id/assign { invoicerId } : attribution manuelle
// par un superviseur (responsable facturation, directeur commercial, admin).
async function assignToInvoicer(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const invoicerId = String(req.body?.invoicerId || "").trim();
    if (!invoicerId) return res.status(400).json({ message: "Choisissez un facturier." });

    const result = await billingQueueService.assignPreorderToInvoicerManually({
      preorderId: req.params.id,
      invoicerId,
      countryId,
      actorAdminId: req.user?.id || null,
    });
    if (!result.ok) {
      return res.status(result.reason === "PREORDER_NOT_FOUND" ? 404 : 409).json({
        message: ASSIGN_ERROR_MESSAGES[result.reason] || "Attribution impossible.",
        reason: result.reason,
      });
    }
    return res.json(result);
  } catch (e) {
    if (e?.code === "PREORDER_CHANGED") {
      return res.status(409).json({ message: ASSIGN_ERROR_MESSAGES.PREORDER_CHANGED, reason: e.code });
    }
    console.error("assignToInvoicer error:", e);
    return res.status(500).json({ message: "Attribution impossible." });
  }
}

// GET /api/admin/billing/report?from=YYYY-MM-DD&to=YYYY-MM-DD[&invoicerId=]
// Bilan d'activité : le sien, ou celui d'un facturier pour un superviseur.
async function getReport(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const requested = String(req.query.invoicerId || "").trim();
    const isSupervisor = billingQueueService.BILLING_SUPERVISOR_ROLES.includes(req.user?.role);
    const userId = requested && isSupervisor ? requested : req.user?.id;
    if (!userId) return res.status(401).json({ message: "Utilisateur non authentifié" });

    const report = await buildInvoicerReport({ countryId, userId, from: req.query.from, to: req.query.to });
    return res.json({ ok: true, invoicerId: userId, ...report });
  } catch (e) {
    if (e.statusCode === 400) return res.status(400).json({ message: e.message });
    console.error("getReport error:", e);
    return res.status(500).json({ message: "Impossible de calculer le bilan." });
  }
}

// GET /api/admin/billing/supervision?from&to : tableau du responsable, une
// ligne par facturier (connexion, charge, dernière activité, bilan).
async function getSupervision(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const { maxActiveBillingPerInvoicer } = await billingQueueService.getBillingSettings(countryId);
    const report = await buildSupervisionReport({
      countryId,
      from: req.query.from,
      to: req.query.to,
      connectedUserIds: getConnectedRealtimeUserIds({ countryId }),
      maxActive: maxActiveBillingPerInvoicer,
    });
    return res.json({ ok: true, ...report });
  } catch (e) {
    if (e.statusCode === 400) return res.status(400).json({ message: e.message });
    console.error("getSupervision error:", e);
    return res.status(500).json({ message: "Impossible de charger la supervision." });
  }
}

module.exports = {
  claimNext,
  claimSpecific,
  getReport,
  getSupervision,
  listInvoicers,
  assignToInvoicer,
  startWork,
  releaseWork,
  escalateWork,
  resolveAs400CertificationDispute,
  resolveEscalation,
};
