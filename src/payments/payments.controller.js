// backend/src/payments/payments.controller.js
// ce controller gère les endpoints liés aux paiements, en particulier pour le fournisseur Wave. 
// Il reçoit les requêtes HTTP, valide les données d'entrée, et délègue la logique métier au service de paiement (payments.service.js). 
// Les fonctions incluent l'initiation d'un paiement Wave, la synchronisation du statut d'un paiement, la simulation de scénarios de paiement pour le développement/test, et la gestion des webhooks envoyés par Wave. 
// Chaque fonction gère également les erreurs et retourne des réponses JSON appropriées au client.

const paymentsService = require("./payments.service");

async function initiateWavePayment(req, res) {
  try {
    const { orderId, restrictPayerMobile } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ message: "orderId requis" });
    }

    const result = await paymentsService.initiateWavePayment({
      req,
      preorderId: orderId,
      restrictPayerMobile,
    });

    return res.json(result);
  } catch (e) {
    console.error("initiateWavePayment error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (initiateWavePayment)" });
  }
}

async function syncWavePaymentStatus(req, res) {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ message: "orderId requis" });
    }

    const result = await paymentsService.syncWavePaymentStatus({
      req,
      preorderId: orderId,
    });

    return res.json(result);
  } catch (e) {
    console.error("syncWavePaymentStatus error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (syncWavePaymentStatus)" });
  }
}

// ✅ simulation dev/test
async function simulateWaveStatus(req, res) {
  try {
    const { orderId } = req.params;
    const { scenario } = req.body || {};

    const result = await paymentsService.simulateWaveStatus({
      req,
      preorderId: orderId,
      scenario,
    });

    return res.json(result);
  } catch (e) {
    console.error("simulateWaveStatus error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (simulateWaveStatus)" });
  }
}

async function waveWebhook(req, res) {
  console.log("[payments.controller][waveWebhook] endpoint hit", {
    method: req.method,
    url: req.originalUrl,
    originalUrl: req.originalUrl,
    contentType:
      req.get?.("content-type") || req.headers?.["content-type"] || null,
    hasRawBody: Boolean(req.rawBody),
    bodyType: Array.isArray(req.body) ? "array" : typeof req.body,
  });

  try {
    const result = await paymentsService.handleWaveWebhook({ req });
    return res.status(200).json(result);
  } catch (e) {
    console.error("[payments.controller][waveWebhook] error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur webhook Wave",
    });
  }
}

async function listPaymentTransactionLogs(req, res) {
  try {
    const { orderId } = req.params;
    const { take } = req.query || {};

    if (!orderId) {
      return res.status(400).json({ message: "orderId requis" });
    }

    const result = await paymentsService.listPaymentTransactionLogs({
      req,
      preorderId: orderId,
      take,
    });

    return res.json(result);
  } catch (e) {
    console.error("listPaymentTransactionLogs error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (listPaymentTransactionLogs)" });
  }
}

module.exports = {
  initiateWavePayment,
  syncWavePaymentStatus,
  simulateWaveStatus,
  waveWebhook,
  listPaymentTransactionLogs,
};
