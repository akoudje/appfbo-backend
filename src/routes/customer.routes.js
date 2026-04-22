const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { requireCustomerAuth } = require("../middlewares/customerAuth");
const customerAuthController = require("../controllers/customerAuth.controller");
const customerOrdersController = require("../controllers/customerOrders.controller");
const customerBankProofController = require("../controllers/customerBankProof.controller");

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
router.get("/me/orders", requireCustomerAuth, customerOrdersController.listMyOrders);
router.get("/me/orders/:id", requireCustomerAuth, customerOrdersController.getMyOrder);
router.post("/me/orders/:id/reorder", requireCustomerAuth, customerOrdersController.reorderMyOrder);
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

module.exports = router;
