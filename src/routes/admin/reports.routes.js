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

module.exports = router;
