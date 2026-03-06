// src/routes/payments.routes.js

const express = require("express");
const { paydunyaWebhook } = require("../controllers/admin.controller");

const router = express.Router();

router.post("/paydunya/webhook", paydunyaWebhook);

module.exports = router;
