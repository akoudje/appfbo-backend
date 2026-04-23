// backend/src/routes/payments.routes.js

"use strict";

const express = require("express");
const router  = express.Router();

const paymentsController         = require("../payments/payments.controller");
const customerBankProofController = require("../controllers/customerBankProof.controller");
const { requireAuth }            = require("../middlewares/rbac");
const { resolveCountry }         = require("../middlewares/resolveCountry");
const { createRateLimiter }      = require("../middlewares/rateLimit");
const { validateBody }           = require("../middlewares/validate");
const {
  initiatePublicWaveSchema,
  syncPublicWaveSchema,
  initiateAdminWaveSchema,
} = require("../payments/payment-schemas");

// ─── Rate limiters ────────────────────────────────────────────────────────────

/** Webhooks Wave (volume élevé attendu) */
const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 240,
  keyPrefix: "wave-webhook",
});

/** Initiation de paiement public : 10 tentatives / minute par IP */
const publicInitiateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyPrefix: "wave-public-initiate",
});

/** Sync statut public : 30 requêtes / minute par IP */
const publicSyncLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: "wave-public-sync",
});

/** Upload preuve bancaire : 5 uploads / minute par IP */
const bankProofUploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  keyPrefix: "bank-proof-upload",
});

// ─── Guard : endpoint interdit en production ──────────────────────────────────

function devOnlyGuard(req, res, next) {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    return res.status(404).json({ error: "Not Found" });
  }
  next();
}

// ─── Routes publiques ─────────────────────────────────────────────────────────

router.get(
  "/wave/short/:token/resolve",
  paymentsController.resolveShortWavePaymentLink,
);

router.get(
  "/bank-proof/public/:token/context",
  customerBankProofController.getPublicBankProofContext,
);

router.get(
  "/bank-proof/public/order/:orderId/context",
  resolveCountry,
  customerBankProofController.getPublicBankProofContextByOrderId,
);

router.post(
  "/bank-proof/public/:token/upload",
  bankProofUploadLimiter,
  customerBankProofController.uploadBankProofMiddleware,
  customerBankProofController.submitPublicBankProof,
);

router.post(
  "/bank-proof/public/order/:orderId/upload",
  bankProofUploadLimiter,
  resolveCountry,
  customerBankProofController.uploadBankProofMiddleware,
  customerBankProofController.submitPublicBankProofByOrderId,
);

router.get(
  "/wave/public/:orderId/context",
  resolveCountry,
  paymentsController.getPublicWavePaymentContext,
);

router.post(
  "/wave/public/initiate",
  publicInitiateLimiter,
  resolveCountry,
  validateBody(initiatePublicWaveSchema),
  paymentsController.initiatePublicWavePayment,
);

router.post(
  "/wave/public/:orderId/sync",
  publicSyncLimiter,
  resolveCountry,
  validateBody(syncPublicWaveSchema),
  paymentsController.syncPublicWavePaymentStatus,
);

// ─── Routes admin (protégées) ─────────────────────────────────────────────────

router.post(
  "/wave/initiate",
  requireAuth,
  resolveCountry,
  validateBody(initiateAdminWaveSchema),
  paymentsController.initiateWavePayment,
);

router.get(
  "/wave/:orderId/status",
  requireAuth,
  resolveCountry,
  paymentsController.syncWavePaymentStatus,
);

router.get(
  "/wave/:orderId/transactions",
  requireAuth,
  resolveCountry,
  paymentsController.listPaymentTransactionLogs,
);

// ─── Simulation (dev/test uniquement — bloqué en production) ─────────────────

router.post(
  "/wave/:orderId/simulate",
  devOnlyGuard,   // ← retourne 404 si NODE_ENV=production
  requireAuth,
  resolveCountry,
  paymentsController.simulateWaveStatus,
);

// ─── Webhook Wave ─────────────────────────────────────────────────────────────

router.post(
  "/wave/webhook",
  webhookLimiter,
  paymentsController.waveWebhook,
);

module.exports = router;
