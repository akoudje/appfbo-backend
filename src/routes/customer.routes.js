const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { requireCustomerAuth } = require("../middlewares/customerAuth");
const customerAuthController = require("../controllers/customerAuth.controller");
const customerOrdersController = require("../controllers/customerOrders.controller");
const customerBankProofController = require("../controllers/customerBankProof.controller");
const customerNotificationsController = require("../controllers/customerNotifications.controller");
const { createCustomerDraft } = require("../controllers/preorders.controller");
const customerSponsorshipsController = require("../controllers/customerSponsorships.controller");
const { uploadSponsorshipDocumentsMiddleware } = require("../services/sponsorship.service");

const router = express.Router();

function normalizeNumeroFbo(value = "") {
  return String(value || "").replace(/\D/g, "").slice(0, 12);
}

const otpRequestLimiter = createRateLimiter({
  keyPrefix: "customer_otp_request",
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyFn: (req) => ({
    ip: req.ip,
    country:
      req.header("X-Country") || req.query?.country || req.query?.countryCode || "",
    numeroFbo: normalizeNumeroFbo(req.body?.numeroFbo),
  }),
});

const otpVerifyLimiter = createRateLimiter({
  keyPrefix: "customer_otp_verify",
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyFn: (req) => ({
    ip: req.ip,
    country:
      req.header("X-Country") || req.query?.country || req.query?.countryCode || "",
    numeroFbo: normalizeNumeroFbo(req.body?.numeroFbo),
  }),
});

router.use(resolveCountry);

router.post("/auth/otp/request", otpRequestLimiter, customerAuthController.requestOtp);
router.post("/auth/otp/verify", otpVerifyLimiter, customerAuthController.verifyOtp);
router.post("/auth/logout", customerAuthController.logout);

router.get("/me", requireCustomerAuth, customerAuthController.me);
router.post("/me/preorders", requireCustomerAuth, createRateLimiter({ keyPrefix: "customer_draft", windowMs: 60000, max: 10, keyFn: req => ({ ip: req.ip, fboId: req.customer.fboId, country: req.countryId }) }), createCustomerDraft);
router.get("/me/dashboard", requireCustomerAuth, customerAuthController.dashboard);
router.get("/me/orders", requireCustomerAuth, customerOrdersController.listMyOrders);
router.get("/me/notifications", requireCustomerAuth, customerNotificationsController.listMyNotifications);
router.post("/me/notifications/read", requireCustomerAuth, customerNotificationsController.markMyNotificationsRead);
router.post("/me/notifications/read-all", requireCustomerAuth, customerNotificationsController.markAllMyNotificationsRead);
router.get("/me/orders/:id", requireCustomerAuth, customerOrdersController.getMyOrder);
router.post("/me/orders/:id/reorder", requireCustomerAuth, customerOrdersController.reorderMyOrder);
router.post("/me/orders/:id/cancel", requireCustomerAuth, customerOrdersController.cancelMyOrder);
router.get(
  "/me/orders/:id/bank-proofs/:proofId/file",
  requireCustomerAuth,
  customerBankProofController.downloadMyBankProof,
);
router.post(
  "/me/orders/:id/bank-proof",
  requireCustomerAuth,
  customerBankProofController.uploadBankProofMiddleware,
  customerBankProofController.submitMyBankProof,
);

// Parrainage : un FBO (Animateur adjoint et plus) inscrit un filleul.
const sponsorshipSubmitLimiter = createRateLimiter({
  keyPrefix: "customer_sponsorship_submit",
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyFn: (req) => ({ ip: req.ip, fboId: req.customer?.fboId, country: req.countryId }),
});
router.get("/me/sponsorships", requireCustomerAuth, customerSponsorshipsController.listMySponsorships);
router.get("/me/sponsorships/catalog", requireCustomerAuth, customerSponsorshipsController.getSponsorshipCatalog);
router.get("/me/sponsorships/:id", requireCustomerAuth, customerSponsorshipsController.getMySponsorship);
router.post("/me/sponsorships/:id/purchase", requireCustomerAuth, customerSponsorshipsController.startSponsorshipPurchase);
router.post(
  "/me/sponsorships",
  requireCustomerAuth,
  sponsorshipSubmitLimiter,
  uploadSponsorshipDocumentsMiddleware,
  customerSponsorshipsController.submitSponsorship,
);
router.put(
  "/me/sponsorships/:id",
  requireCustomerAuth,
  sponsorshipSubmitLimiter,
  uploadSponsorshipDocumentsMiddleware,
  customerSponsorshipsController.resubmitSponsorship,
);
router.get(
  "/me/sponsorships/:id/documents/:documentId/file",
  requireCustomerAuth,
  customerSponsorshipsController.downloadMySponsorshipDocument,
);

module.exports = router;
