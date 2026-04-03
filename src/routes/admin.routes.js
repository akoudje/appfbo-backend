// src/routes/admin.routes.js
// Routes d'administration (protegees par auth + RBAC)

const express = require("express");
const { Permission } = require("../auth/permissions.js");
const { resolveCountry } = require("../middlewares/resolveCountry");
const {
  requireAuth,
  requirePermission,
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
const stockRoutes = require("./admin/stock.routes");
const marketingCampaignsController = require("../controllers/admin/marketingCampaigns.controller");
const eventsController = require("../controllers/admin/events.controller");

const router = express.Router();

router.use(resolveCountry, requireAuth, requireCountryScope);

router.use("/orders", ordersRoutes);
router.use("/orders", paymentsRoutes);
router.get(
  "/events/stream",
  requirePermission(Permission.PREORDER_READ),
  eventsController.stream,
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
router.use("/products", productsRoutes);
router.use("/cashier", cashierRoutes);
router.use("/stock", stockRoutes);

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
  "/marketing-campaigns",
  requirePermission(Permission.COUNTRY_READ),
  marketingCampaignsController.getMarketingCampaigns,
);

router.put(
  "/marketing-campaigns",
  requirePermission(Permission.COUNTRY_WRITE),
  marketingCampaignsController.updateMarketingCampaigns,
);

module.exports = router;
