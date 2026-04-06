// backend/src/routes/webhooks.routes.js
// Alias webhooks publics (compatibilité providers)

const express = require("express");
const router = express.Router();

const paymentsController = require("../payments/payments.controller");
const { orangeSmsDlrWebhook } = require("../controllers/smsWebhook.controller");
const { createRateLimiter } = require("../middlewares/rateLimit");

const genericWebhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 240,
  keyPrefix: "public-webhook",
});

router.post("/wave", genericWebhookLimiter, paymentsController.waveWebhook);
router.post("/orange-sms/dlr", genericWebhookLimiter, orangeSmsDlrWebhook);

module.exports = router;
