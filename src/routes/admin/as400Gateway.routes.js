const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const as400GatewayController = require("../../controllers/admin/as400Gateway.controller");

const router = express.Router();

router.get(
  "/config",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.getConfig,
);

router.put(
  "/config",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.updateConfig,
);

router.post(
  "/config/heartbeat",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.heartbeatConfig,
);

router.get(
  "/requests",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.listRequests,
);

router.post(
  "/requests",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.enqueueRequest,
);

router.post(
  "/requests/claim-next",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.claimNextRequest,
);

router.get(
  "/requests/:id",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.getRequest,
);

router.post(
  "/requests/:id/waiting-human",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.markWaitingHuman,
);

router.post(
  "/requests/:id/cancel",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.cancelRequest,
);

router.post(
  "/requests/:id/complete",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.completeRequest,
);

router.post(
  "/requests/:id/fail",
  requirePermission(Permission.INVOICE_CREATE),
  as400GatewayController.failRequest,
);

module.exports = router;
