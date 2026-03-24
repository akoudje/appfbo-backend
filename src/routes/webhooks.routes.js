// backend/src/routes/webhooks.routes.js
// Alias webhooks publics (compatibilité providers)

const express = require("express");
const router = express.Router();

const paymentsController = require("../payments/payments.controller");

router.post("/wave", paymentsController.waveWebhook);

module.exports = router;
