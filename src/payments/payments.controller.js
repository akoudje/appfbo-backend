// src/payments/payments.controller.js

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
  try {
    const result = await paymentsService.handleWaveWebhook({ req });
    return res.status(200).json(result);
  } catch (e) {
    console.error("waveWebhook error:", e);
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
  simulateWaveStatus,
  waveWebhook,
};