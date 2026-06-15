const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const controller = require("../../controllers/admin/externalPaymentLinks.controller");

const router = express.Router();

router.get(
  "/",
  requirePermission(Permission.PAYMENT_VALIDATE),
  controller.listLinks,
);

router.get(
  "/qr-config",
  requirePermission(Permission.PAYMENT_VALIDATE),
  controller.getQrConfig,
);

router.post(
  "/",
  requirePermission(Permission.PAYMENT_VALIDATE),
  controller.createLink,
);

router.post(
  "/:id/resend-sms",
  requirePermission(Permission.PAYMENT_VALIDATE),
  controller.resendSms,
);

router.post(
  "/:id/sync-wave",
  requirePermission(Permission.PAYMENT_VALIDATE),
  controller.syncWave,
);

router.post(
  "/:id/attach-order",
  requirePermission(Permission.PAYMENT_VALIDATE),
  controller.attachToOrder,
);

router.patch(
  "/:id/status",
  requirePermission(Permission.PAYMENT_VALIDATE),
  controller.updateStatus,
);

module.exports = router;
