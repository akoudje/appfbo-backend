const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const cashierController = require("../../controllers/admin/cashier.controller");

const router = express.Router();

router.get(
  "/workspace",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashierController.getWorkspace,
);

router.get(
  "/paid-today",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashierController.getPaidToday,
);

router.post(
  "/orders/:id/prepare",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashierController.launchPreparation,
);

router.post(
  "/orders/:id/as400-certification/missing",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashierController.reportAs400CertificationMissing,
);

module.exports = router;
