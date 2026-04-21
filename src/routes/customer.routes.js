const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { requireCustomerAuth } = require("../middlewares/customerAuth");
const customerAuthController = require("../controllers/customerAuth.controller");
const customerPortalController = require("../controllers/customerPortal.controller");

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

router.get("/me", requireCustomerAuth, customerAuthController.me);
router.get("/me/orders", requireCustomerAuth, customerPortalController.listMyOrders);
router.get("/me/orders/:id", requireCustomerAuth, customerPortalController.getMyOrder);
router.post("/me/orders/:id/reorder", requireCustomerAuth, customerPortalController.reorderMyOrder);
router.get(
  "/me/orders/:id/bank-proofs/:proofId/file",
  requireCustomerAuth,
  customerPortalController.downloadMyBankProof,
);
router.post(
  "/me/orders/:id/bank-proof",
  requireCustomerAuth,
  customerPortalController.uploadBankProofMiddleware,
  customerPortalController.submitMyBankProof,
);

module.exports = router;
