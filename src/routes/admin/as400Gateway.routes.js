const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const as400GatewayController = require("../../controllers/admin/as400Gateway.controller");

const router = express.Router();

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

module.exports = router;
