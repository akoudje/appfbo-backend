const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const ticketingController = require("../controllers/ticketing.controller");

const router = express.Router();

// ─── Rate limiters ──────────────────────────────────────────────────────────
// GET /orders/:orderNumber est un point sensible : il renvoie le qrToken des
// billets (credential de contrôle d'accès) sans authentification ni preuve
// de possession, à quiconque connaît le orderNumber. Ce numéro a été durci
// (voir ticket-order-ticketing.service.js), mais un rate-limit par IP reste
// la seconde ligne de défense contre l'énumération/brute-force.

/** Consultation d'une commande par numéro : 20 tentatives / 10 min / IP. */
const orderLookupLimiter = createRateLimiter({
  keyPrefix: "ticketing-order-lookup",
  windowMs: 10 * 60 * 1000,
  max: 20,
});

/** Création de commande (avant tout paiement) : 10 / min / IP. */
const orderCreateLimiter = createRateLimiter({
  keyPrefix: "ticketing-order-create",
  windowMs: 60 * 1000,
  max: 10,
});

/** Récupération de commande par email/téléphone (déclenche un envoi email). */
const orderRecoverLimiter = createRateLimiter({
  keyPrefix: "ticketing-order-recover",
  windowMs: 10 * 60 * 1000,
  max: 5,
});

/** Initiation Wave : même budget que le reste des endpoints Wave publics. */
const waveInitiateLimiter = createRateLimiter({
  keyPrefix: "ticketing-wave-initiate",
  windowMs: 60 * 1000,
  max: 10,
});

/** Sync statut Wave : polling client, budget plus large. */
const waveSyncLimiter = createRateLimiter({
  keyPrefix: "ticketing-wave-sync",
  windowMs: 60 * 1000,
  max: 30,
});

router.use(resolveCountry);

router.get("/events", ticketingController.listPublicEvents);
router.get("/events/:slug", ticketingController.getPublicEvent);
router.post("/orders", orderCreateLimiter, ticketingController.createTicketOrder);
router.post("/orders/recover", orderRecoverLimiter, ticketingController.recoverTicketOrder);
router.get("/orders/:orderNumber", orderLookupLimiter, ticketingController.getTicketOrder);
router.post(
  "/orders/:orderNumber/wave/initiate",
  waveInitiateLimiter,
  ticketingController.initiateTicketWavePayment,
);
router.post(
  "/orders/:orderNumber/wave/sync",
  waveSyncLimiter,
  ticketingController.syncTicketWavePaymentStatus,
);

module.exports = router;
