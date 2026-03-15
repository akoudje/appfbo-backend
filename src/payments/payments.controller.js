// src/payments/payments.controllerjs
// Controller de l'API pour les paiements, exposant des endpoints pour initier un paiement Wave, 
// synchroniser le statut d'un paiement Wave et recevoir les webhooks de Wave. Ce controller valide les entrées, 
// appelle les méthodes du service de paiement correspondant et gère les réponses HTTP.

// Controller HTTP des paiements : validation des entrées, réponses HTTP,
// délégation vers payments.service.js

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

async function waveWebhook(req, res) {
  try {
    const result = await paymentsService.handleWaveWebhook({ req });
    return res.status(200).json(result);
  } catch (e) {
    console.error("waveWebhook error:", e);

    // Ack 200 pour éviter les retry agressifs provider côté webhook
    return res.status(200).json({
      ok: true,
      ignored: true,
      message: e.message || "Webhook reçu mais non traité",
    });
  }
}

module.exports = {
  initiateWavePayment,
  syncWavePaymentStatus,
  waveWebhook,
};
