const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const controller = require("../../controllers/admin/externalPaymentLinks.controller");

const router = express.Router();
const requireExternalPaymentLinksManage = requirePermission(
  Permission.EXTERNAL_PAYMENT_LINKS_MANAGE,
);

router.get(
  "/",
  requireExternalPaymentLinksManage,
  controller.listLinks,
);

router.get(
  "/qr-config",
  requireExternalPaymentLinksManage,
  controller.getQrConfig,
);

router.post(
  "/",
  requireExternalPaymentLinksManage,
  controller.createLink,
);

router.post(
  "/:id/resend-sms",
  requireExternalPaymentLinksManage,
  controller.resendSms,
);

router.post(
  "/:id/sync-wave",
  requireExternalPaymentLinksManage,
  controller.syncWave,
);

router.post(
  "/:id/attach-order",
  requireExternalPaymentLinksManage,
  controller.attachToOrder,
);

router.patch(
  "/:id/status",
  requireExternalPaymentLinksManage,
  controller.updateStatus,
);

module.exports = router;
