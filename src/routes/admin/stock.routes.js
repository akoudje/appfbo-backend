const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const stockController = require("../../controllers/admin/stock.controller");

const router = express.Router();

router.get(
  "/dashboard",
  requirePermission(Permission.PRODUCT_READ),
  stockController.getStockDashboard,
);

router.get(
  "/movements",
  requirePermission(Permission.PRODUCT_READ),
  stockController.listStockMovements,
);

router.post(
  "/adjust",
  requirePermission(Permission.PRODUCT_WRITE),
  stockController.adjustStock,
);

module.exports = router;
