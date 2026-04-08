const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { requireCustomerAuth } = require("../middlewares/customerAuth");
const customerAuthController = require("../controllers/customerAuth.controller");
const customerPortalController = require("../controllers/customerPortal.controller");

const router = express.Router();

const otpRequestLimiter = createRateLimiter({
  keyPrefix: "customer_otp_request",
  windowMs: 10 * 60 * 1000,
  max: 5,
});

const otpVerifyLimiter = createRateLimiter({
  keyPrefix: "customer_otp_verify",
  windowMs: 10 * 60 * 1000,
  max: 10,
});

router.use(resolveCountry);

router.post("/auth/otp/request", otpRequestLimiter, customerAuthController.requestOtp);
router.post("/auth/otp/verify", otpVerifyLimiter, customerAuthController.verifyOtp);

router.get("/me", requireCustomerAuth, customerAuthController.me);
router.get("/me/orders", requireCustomerAuth, customerPortalController.listMyOrders);
router.get("/me/orders/:id", requireCustomerAuth, customerPortalController.getMyOrder);
router.post(
  "/me/orders/:id/bank-proof",
  requireCustomerAuth,
  customerPortalController.uploadBankProofMiddleware,
  customerPortalController.submitMyBankProof,
);

module.exports = router;

