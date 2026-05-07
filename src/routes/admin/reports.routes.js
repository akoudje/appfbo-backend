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

module.exports = router;
