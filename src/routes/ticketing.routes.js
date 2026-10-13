const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const ticketingController = require("../controllers/ticketing.controller");
const portal = require('../controllers/ticketPortal.controller');
const distribution = require('../controllers/ticketDistribution.controller');
const portalSession = require('../services/ticket-portal-session.service');
const smsRecovery = require('../controllers/ticketSmsRecovery.controller');
const contactKey = req => req.body?.channel === 'SMS' ? smsRecovery.rateKey(req) : `${req.countryId}:EMAIL:${String(req.body?.email || '').trim().toLowerCase()}`;
const smsCooldown = createRateLimiter({ keyPrefix: 'ticket-sms-cooldown', windowMs: 60000, max: 1, keyFn: smsRecovery.rateKey });
const smsHourly = createRateLimiter({ keyPrefix: 'ticket-sms-hourly', windowMs: 3600000, max: 3, keyFn: smsRecovery.rateKey });

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
  max: 120,
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

router.get('/portal/capabilities', smsRecovery.capabilities);
router.post('/portal/otp/request', portalSession.requireJson,
  createRateLimiter({ keyPrefix: 'ticket-portal-request-ip', windowMs: 600000, max: 5 }),
  (req, res, next) => req.body?.channel === 'SMS' ? smsCooldown(req, res, next) : next(),
  (req, res, next) => req.body?.channel === 'SMS' ? smsHourly(req, res, next) : next(),
  createRateLimiter({ keyPrefix: 'ticket-portal-request-contact', windowMs: 60000, max: 1, keyFn: contactKey }),
  createRateLimiter({ keyPrefix: 'ticket-portal-request-hour', windowMs: 3600000, max: 3, keyFn: contactKey }), portal.requestOtp);
router.post('/portal/otp/verify', portalSession.requireJson, createRateLimiter({keyPrefix:'ticket-portal-verify',windowMs:600000,max:20}), portal.verifyOtp);
router.get('/portal/session', portalSession.requireSession, portal.getSession);
router.post('/portal/logout', portalSession.requireJson, portal.logout);
router.get('/portal/orders', portalSession.requireSession, portal.listOrders);
router.post('/portal/order-reference', portalSession.requireJson, portalSession.requireSession,
  createRateLimiter({ keyPrefix: 'ticket-sms-reference', windowMs: 600000, max: 10, keyFn: req => `${req.countryId}:${req.ticketPortal.phone || req.ip}` }), smsRecovery.selectReference);
router.post('/orders/:orderNumber/phone/otp/request', portalSession.requireJson,
  createRateLimiter({ keyPrefix: 'ticket-phone-bind-ip', windowMs: 600000, max: 5 }), smsRecovery.ownedPhone, smsCooldown, smsHourly, smsRecovery.requestBinding);
router.post('/orders/:orderNumber/phone/otp/verify', portalSession.requireJson,
  createRateLimiter({ keyPrefix: 'ticket-phone-bind-verify', windowMs: 600000, max: 20 }), smsRecovery.ownedPhone, smsRecovery.verifyBinding);
router.get('/shared-tickets/:ticketId', orderLookupLimiter, distribution.getSharedTicket);
router.get('/orders/:orderNumber/tickets/:ticketId/share-link', orderLookupLimiter, distribution.getShareLink);
router.patch('/orders/:orderNumber/tickets/:ticketId/guest', portalSession.requireJson, orderLookupLimiter, distribution.assignGuest);
router.post('/orders/:orderNumber/ticket-shares', portalSession.requireJson, orderLookupLimiter, distribution.recordShare);

router.get("/events", ticketingController.listPublicEvents);
router.get("/events/:slug", ticketingController.getPublicEvent);
router.post(
  "/events/:slug/quote",
  createRateLimiter({ keyPrefix: "ticket-quote", windowMs: 60000, max: 90 }),
  ticketingController.quote,
);
router.post(
  "/orders",
  orderCreateLimiter,
  ticketingController.createTicketOrder,
);
router.post(
  "/orders/recover",
  orderRecoverLimiter,
  ticketingController.recoverTicketOrder,
);
router.post(
  "/orders/resume",
  orderLookupLimiter,
  ticketingController.resumeTicketOrder,
);
router.get(
  "/orders/:orderNumber",
  orderLookupLimiter,
  ticketingController.getTicketOrder,
);
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
