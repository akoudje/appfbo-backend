const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const cashierController = require("../../controllers/admin/cashier.controller");
const reportsController = require("../../controllers/admin/reports.controller");

const router = express.Router();

// Bilan emballages accessible à la caisse (droit caisse, sans droit d'export
// global) : même calcul que /admin/reports/packaging-summary.
router.get(
  "/packaging-summary",
  requirePermission(Permission.PAYMENT_VALIDATE),
  reportsController.getPackagingSummaryReport,
);

router.get(
  "/packaging-summary/export",
  requirePermission(Permission.PAYMENT_VALIDATE),
  reportsController.exportPackagingSummaryReport,
);

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
