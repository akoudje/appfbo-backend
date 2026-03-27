const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const cashierController = require("../../controllers/admin/cashier.controller");
const ordersController = require("../../controllers/admin/orders.controller");

const router = express.Router();

router.get(
  "/workspace",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashierController.getWorkspace,
);

router.post(
  "/orders/:id/prepare",
  requirePermission(Permission.PAYMENT_VALIDATE),
  ordersController.prepareOrder,
);

module.exports = router;
