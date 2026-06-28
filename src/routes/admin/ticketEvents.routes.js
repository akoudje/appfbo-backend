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
  "/orders/:orderId/wave/sync",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.syncOrderWavePayment,
);

router.post(
  "/orders/:orderId/cancel",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.cancelOrder,
);

router.post(
  "/assets",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.uploadPosterMiddleware,
  ticketEventsController.uploadPoster,
);

router.post(
  "/check-in",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.checkInTicket,
);

router.post(
  "/check-in/sessions",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.openCheckInSession,
);

router.post(
  "/check-in/sessions/:sessionId/close",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.closeCheckInSession,
);

router.get(
  "/check-in/logs",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.listCheckInLogs,
);

router.get(
  "/check-in/summary",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.getCheckInSummary,
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

router.delete(
  "/:id/ticket-types/:ticketTypeId",
  requirePermission(Permission.MARKETING_WRITE),
  ticketEventsController.deleteTicketType,
);

module.exports = router;
