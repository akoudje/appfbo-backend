const express = require("express");
const router = express.Router();

const ordersController = require("../controllers/admin/orders.controller");
const paymentsController = require("../controllers/admin/payments.controller");

router.get("/", ordersController.listOrders);
router.get("/:id/messages", ordersController.listOrderMessages);
router.get("/:id", ordersController.getOrderById);

router.post("/:id/invoice", ordersController.invoiceOrder);

router.post("/:id/manual-payment-pending", paymentsController.markManualPaymentPending);
router.post("/:id/validate-manual-payment", paymentsController.validateManualPayment);
router.post("/:id/pay", paymentsController.markCashPayment);

router.post("/:id/prepare", ordersController.prepareOrder);
router.post("/:id/fulfill", ordersController.fulfillOrder);
router.post("/:id/cancel", ordersController.cancelOrder);

module.exports = router;
