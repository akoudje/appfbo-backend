// backend/src/routes/webhooks.routes.js
// Alias webhooks publics (compatibilité providers)

const express = require("express");
const router = express.Router();

const paymentsController = require("../payments/payments.controller");
const { orangeSmsDlrWebhook } = require("../controllers/smsWebhook.controller");

router.post("/wave", paymentsController.waveWebhook);
router.post("/orange-sms/dlr", orangeSmsDlrWebhook);

module.exports = router;
