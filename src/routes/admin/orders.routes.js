const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const ordersController = require("../../controllers/admin/orders.controller");

const router = express.Router();

router.get("/", requirePermission(Permission.PREORDER_READ), ordersController.listOrders);
router.get("/:id/messages", requirePermission(Permission.PREORDER_READ), ordersController.listOrderMessages);
router.get("/:id", requirePermission(Permission.PREORDER_READ), ordersController.getOrderById);

router.patch(
  "/:id/status",
  requirePermission(Permission.PREORDER_UPDATE_STATUS),
  ordersController.updateOrderStatus,
);

router.post(
  "/:id/invoice",
  requirePermission(Permission.INVOICE_CREATE),
  ordersController.invoiceOrder,
);

router.post(
  "/:id/prepare",
  requirePermission(Permission.PREPARATION_UPDATE),
  ordersController.prepareOrder,
);

router.post(
  "/:id/fulfill",
  requirePermission(Permission.PREPARATION_UPDATE),
  ordersController.fulfillOrder,
);

router.post(
  "/:id/cancel",
  requirePermission(Permission.PREORDER_UPDATE_STATUS),
  ordersController.cancelOrder,
);

module.exports = router;
