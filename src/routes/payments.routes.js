// src/routes/payments.routes.js

const express = require("express");
const router = express.Router();

const paymentsController = require("../payments/payments.controller");
const { requireAuth } = require("../middlewares/rbac");

// Admin protégé
router.post(
  "/wave/initiate",
  requireAuth,
  paymentsController.initiateWavePayment
);

router.get(
  "/wave/:orderId/status",
  requireAuth,
  paymentsController.syncWavePaymentStatus
);

// ✅ simulation dev/test
router.post(
  "/wave/:orderId/simulate",
  requireAuth,
  paymentsController.simulateWaveStatus
);

// Provider webhook
router.post(
  "/wave/webhook",
  paymentsController.waveWebhook
);

module.exports = router;