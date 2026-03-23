const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const paymentsController = require("../../controllers/admin/payments.controller");

const router = express.Router();

router.post(
  "/:id/proof",
  requirePermission(Permission.PAYMENT_VALIDATE),
  paymentsController.markManualPaymentPending,
);

router.post(
  "/:id/verify-payment",
  requirePermission(Permission.PAYMENT_VALIDATE),
  paymentsController.validateManualPayment,
);

router.post(
  "/:id/pay",
  requirePermission(Permission.PAYMENT_VALIDATE),
  paymentsController.markCashPayment,
);

module.exports = router;
