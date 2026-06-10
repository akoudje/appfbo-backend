// src/routes/admin.routes.js
// Routes d'administration (protegees par auth + RBAC)

const express = require("express");
const { AdminRole, Permission } = require("../auth/permissions.js");
const { resolveCountry } = require("../middlewares/resolveCountry");
const {
  requireAuth,
  requirePermission,
  requireRole,
  requireCountryScope,
} = require("../middlewares/rbac");

const {
  getGradeDiscounts,
  upsertGradeDiscounts,
} = require("../controllers/gradeDiscounts.controller");

const {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
} = require("../controllers/users.controller");

const {
  claimNext,
  startWork,
  releaseWork,
  escalateWork,
} = require("../controllers/billingQueue.controller");

const ordersController = require("../controllers/admin/orders.controller");
const ordersRoutes = require("./admin/orders.routes");
const paymentsRoutes = require("./admin/payments.routes");
const statsRoutes = require("./admin/stats.routes");
const settingsRoutes = require("./admin/settings.routes");
const productsRoutes = require("./admin/products.routes");
const cashierRoutes = require("./admin/cashier.routes");
const cashClosuresRoutes = require("./admin/cashClosures.routes");
const stockRoutes = require("./admin/stock.routes");
const reportsRoutes = require("./admin/reports.routes");
const ticketEventsRoutes = require("./admin/ticketEvents.routes");
const externalPaymentLinksRoutes = require("./admin/externalPaymentLinks.routes");
const marketingCampaignsController = require("../controllers/admin/marketingCampaigns.controller");
const eventsController = require("../controllers/admin/events.controller");
const paymentLinkResendRequestsController = require("../controllers/paymentLinkResendRequests.controller");
const { adminListCountries, toggleCountry } = require("../controllers/countries.controller");

const router = express.Router();

router.use(resolveCountry, requireAuth, requireCountryScope);

router.use("/orders", ordersRoutes);
router.use("/orders", paymentsRoutes);
router.use("/external-payment-links", externalPaymentLinksRoutes);
router.get(
  "/events/stream",
  requirePermission(Permission.PREORDER_READ),
  eventsController.stream,
);
router.get(
  "/events/health",
  requirePermission(Permission.PREORDER_READ),
  eventsController.health,
);
router.post(
  "/events/ack",
  requirePermission(Permission.PREORDER_READ),
  eventsController.ackAlertPlayback,
);

// alias "preorders" pour compatibilite
router.get(
  "/preorders",
  requirePermission(Permission.PREORDER_READ),
  ordersController.listOrders,
);

router.get(
  "/preorders/:id",
  requirePermission(Permission.PREORDER_READ),
  ordersController.getOrderById,
);

router.get(
  "/preorders/:id/messages",
  requirePermission(Permission.PREORDER_READ),
  ordersController.listOrderMessages,
);

router.patch(
  "/preorders/:id/status",
  requirePermission(Permission.PREORDER_UPDATE_STATUS),
  ordersController.updateOrderStatus,
);

router.post(
  "/billing/claim-next",
  requirePermission(Permission.INVOICE_CREATE),
  claimNext,
);

router.post(
  "/billing/:id/start",
  requirePermission(Permission.INVOICE_CREATE),
  startWork,
);

router.post(
  "/billing/:id/release",
  requirePermission(Permission.INVOICE_CREATE),
  releaseWork,
);

router.post(
  "/billing/:id/escalate",
  requirePermission(Permission.INVOICE_CREATE),
  escalateWork,
);

router.use("/stats", statsRoutes);
router.use("/reports", reportsRoutes);
router.use("/products", productsRoutes);
router.use("/cashier", cashierRoutes);
router.use("/cash-closures", cashClosuresRoutes);
router.use("/stock", stockRoutes);
router.use("/ticket-events", ticketEventsRoutes);

router.get(
  "/grade-discounts",
  requirePermission(Permission.DISCOUNT_READ),
  getGradeDiscounts,
);

router.put(
  "/grade-discounts",
  requirePermission(Permission.DISCOUNT_WRITE),
  upsertGradeDiscounts,
);

router.get(
  "/users",
  requirePermission(Permission.USER_ADMIN),
  listUsers,
);

router.get(
  "/users/:id",
  requirePermission(Permission.USER_ADMIN),
  getUserById,
);

router.post(
  "/users",
  requirePermission(Permission.USER_ADMIN),
  createUser,
);

router.put(
  "/users/:id",
  requirePermission(Permission.USER_ADMIN),
  updateUser,
);

router.patch(
  "/users/:id/status",
  requirePermission(Permission.USER_ADMIN),
  updateUserStatus,
);

router.use("/country-settings", settingsRoutes);

router.get(
  "/payment-link-resend-requests",
  requirePermission(Permission.INVOICE_CREATE),
  paymentLinkResendRequestsController.listPaymentLinkResendRequests,
);

router.patch(
  "/payment-link-resend-requests/:id",
  requirePermission(Permission.INVOICE_CREATE),
  paymentLinkResendRequestsController.updatePaymentLinkResendRequest,
);

router.get(
  "/pickup-code-resend-requests",
  requirePermission(Permission.PREPARATION_UPDATE),
  paymentLinkResendRequestsController.listPickupCodeResendRequests,
);

router.patch(
  "/pickup-code-resend-requests/:id",
  requirePermission(Permission.PREPARATION_UPDATE),
  paymentLinkResendRequestsController.updatePickupCodeResendRequest,
);

router.get(
  "/countries",
  requirePermission(Permission.COUNTRY_READ),
  adminListCountries,
);

router.patch(
  "/countries/:code",
  requirePermission(Permission.COUNTRY_WRITE),
  requireRole(AdminRole.SUPER_ADMIN),
  toggleCountry,
);

router.get(
  "/marketing-campaigns",
  requirePermission(Permission.COUNTRY_READ),
  marketingCampaignsController.getMarketingCampaigns,
);

router.put(
  "/marketing-campaigns",
  requirePermission(Permission.MARKETING_WRITE),
  marketingCampaignsController.updateMarketingCampaigns,
);

router.post(
  "/marketing-campaigns/publish",
  requirePermission(Permission.MARKETING_WRITE),
  marketingCampaignsController.publishMarketingCampaigns,
);

router.post(
  "/marketing-campaigns/sms/:campaignId/send-test",
  requirePermission(Permission.MARKETING_WRITE),
  marketingCampaignsController.sendSmsCampaignTest,
);

router.post(
  "/marketing-campaigns/sms/:campaignId/send",
  requirePermission(Permission.MARKETING_WRITE),
  marketingCampaignsController.sendSmsCampaign,
);

router.post(
  "/marketing-campaigns/assets",
  requirePermission(Permission.MARKETING_WRITE),
  marketingCampaignsController.uploadMarketingAssetMiddleware,
  marketingCampaignsController.uploadMarketingAsset,
);

module.exports = router;
