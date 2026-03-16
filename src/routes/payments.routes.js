const express = require("express");
const router = express.Router();

const paymentsController = require("../payments/payments.controller");
const { requireAuth } = require("../middlewares/rbac");
const { resolveCountry } = require("../middlewares/resolveCountry");

// Admin protégé
router.post(
  "/wave/initiate",
  requireAuth,
  resolveCountry,
  paymentsController.initiateWavePayment
);

router.get(
  "/wave/:orderId/status",
  requireAuth,
  resolveCountry,
  paymentsController.syncWavePaymentStatus
);

// ✅ simulation dev/test
router.post(
  "/wave/:orderId/simulate",
  requireAuth,
  resolveCountry,
  paymentsController.simulateWaveStatus
);

// Provider webhook
router.post(
  "/wave/webhook",
  paymentsController.waveWebhook
);

module.exports = router;