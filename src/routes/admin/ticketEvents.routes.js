const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const ticketEventsController = require("../../controllers/admin/ticketEvents.controller");

const router = express.Router();

router.get(
  "/",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.listEvents,
);

router.post(
  "/",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.upsertEvent,
);

router.get(
  "/orders",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.listOrders,
);

router.post(
  "/orders/expire",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.expireOrders,
);

router.post(
  "/orders/:orderId/paid",
  requirePermission(Permission.PAYMENT_VALIDATE),
  ticketEventsController.markOrderPaid,
);

router.post(
  "/orders/:orderId/cancel",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.cancelOrder,
);

router.post(
  "/check-in",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.checkInTicket,
);

router.get(
  "/:id",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.getEvent,
);

router.post(
  "/:id/ticket-types",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.upsertTicketType,
);

module.exports = router;
