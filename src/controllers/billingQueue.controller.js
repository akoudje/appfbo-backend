// src/controllers/billingQueue.controller.js
// Contrôleur pour gérer la file de précommandes à facturer

const billingQueueService = require("../services/billingQueue.service");
const { publishRealtimeEvent } = require("../services/realtime-events.service");

async function claimNext(req, res) {
  try {
    const userId = req.user?.id;
    const countryId = req.country?.id || req.countryId;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

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

module.exports = {
  claimNext,
  startWork,
  releaseWork,
  escalateWork,
  resolveAs400CertificationDispute,
};
