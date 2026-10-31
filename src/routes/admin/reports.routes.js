const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const reportsController = require("../../controllers/admin/reports.controller");

const router = express.Router();

router.get(
  "/daily-sales",
  requirePermission(Permission.EXPORT_READ),
  reportsController.getDailySalesReport,
);

router.get(
  "/packaging-summary",
  requirePermission(Permission.EXPORT_READ),
  reportsController.getPackagingSummaryReport,
);

router.get(
  "/packaging-summary/export",
  requirePermission(Permission.EXPORT_READ),
  reportsController.exportPackagingSummaryReport,
);

router.get(
  "/cash-supervision",
  requirePermission(Permission.EXPORT_READ),
  reportsController.getCashSupervisionReport,
);

router.get(
  "/cash-supervision/pulse",
  requirePermission(Permission.EXPORT_READ),
  reportsController.getCashSupervisionPulse,
);

router.get(
  "/cash-supervision/closures",
  requirePermission(Permission.EXPORT_READ),
  reportsController.getCashSupervisionClosures,
);

router.get(
  "/cash-supervision/recovery",
  requirePermission(Permission.EXPORT_READ),
  reportsController.getCashRecoveryReport,
);

router.get(
  "/cash-supervision/export",
  requirePermission(Permission.EXPORT_READ),
  reportsController.exportCashSupervisionReport,
);

module.exports = router;
