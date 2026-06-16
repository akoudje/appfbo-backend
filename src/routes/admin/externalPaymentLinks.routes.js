const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requireAnyPermission } = require("../../middlewares/rbac");
const controller = require("../../controllers/admin/externalPaymentLinks.controller");

const router = express.Router();
const requireBillingOrCashier = requireAnyPermission([
  Permission.INVOICE_CREATE,
  Permission.PAYMENT_VALIDATE,
]);

router.get(
  "/",
  requireBillingOrCashier,
  controller.listLinks,
);

router.get(
  "/qr-config",
  requireBillingOrCashier,
  controller.getQrConfig,
);

router.post(
  "/",
  requireBillingOrCashier,
  controller.createLink,
);

router.post(
  "/:id/resend-sms",
  requireBillingOrCashier,
  controller.resendSms,
);

router.post(
  "/:id/sync-wave",
  requireBillingOrCashier,
  controller.syncWave,
);

router.post(
  "/:id/attach-order",
  requireBillingOrCashier,
  controller.attachToOrder,
);

router.patch(
  "/:id/status",
  requireBillingOrCashier,
  controller.updateStatus,
);

module.exports = router;
