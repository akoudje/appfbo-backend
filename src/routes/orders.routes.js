// src/routes/admin/orders.routes.js
const express = require("express");
const router = express.Router();

const ordersController = require("../../controllers/admin/orders.controller");

/**
 * Si tu as déjà des middlewares du genre:
 * - requireAdminAuth
 * - requireRole
 * - injectCountry
 * branche-les ici ou au niveau parent.
 */

// Listing / détail
router.get("/", ordersController.listOrders);
router.get("/:id", ordersController.getOrderById);
router.get("/:id/messages", ordersController.listOrderMessages);

// Facturation
router.post("/:id/invoice", ordersController.invoiceOrder);

// Paiements manuels
router.post("/:id/manual-payment-pending", ordersController.markManualPaymentPending);
router.post("/:id/validate-manual-payment", ordersController.validateManualPayment);
router.post("/:id/pay", ordersController.markCashPayment);

// Préparation / fulfillment / annulation
router.post("/:id/prepare", ordersController.prepareOrder);
router.post("/:id/fulfill", ordersController.fulfillOrder);
router.post("/:id/cancel", ordersController.cancelOrder);

module.exports = router;