// src/routes/admin.routes.js
// Routes d'administration (protegées par auth + RBAC)

const express = require("express");
const { Permission } = require("../auth/permissions");
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
  // orders
  listOrders,
  getOrderById,
  listOrderMessages,
  updateOrderStatus,
  invoiceOrder,
  payOrder,

  // workflow
  markPaymentProof,
  verifyPayment,
  prepareOrder,
  fulfillOrder,
  cancelOrder,

  // stats
  getStats,

  // products
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  importProductsCsv,
  uploadProductImage,

  // country settings
  getCountrySettings,
  updateCountrySettings,
} = require("../controllers/admin.controller.js");

const router = express.Router();
router.use(resolveCountry, requireAuth, requireCountryScope);

/**
 * ORDERS
 */
router.get("/orders", requirePermission(Permission.PREORDER_READ), listOrders);
router.get("/orders/:id", requirePermission(Permission.PREORDER_READ), getOrderById);
router.get("/orders/:id/messages", requirePermission(Permission.PREORDER_READ), listOrderMessages);

router.get("/preorders", requirePermission(Permission.PREORDER_READ), listOrders);
router.get("/preorders/:id", requirePermission(Permission.PREORDER_READ), getOrderById);
router.get("/preorders/:id/messages", requirePermission(Permission.PREORDER_READ), listOrderMessages);

// optionnel (si tu veux un endpoint générique)
router.patch(
  "/orders/:id/status",
  requirePermission(Permission.PREORDER_UPDATE_STATUS),
  updateOrderStatus
);
router.patch(
  "/preorders/:id/status",
  requirePermission(Permission.PREORDER_UPDATE_STATUS),
  updateOrderStatus
);

// facturier
router.post("/orders/:id/invoice", requirePermission(Permission.INVOICE_CREATE), invoiceOrder);
router.post(
  "/orders/:id/proof",
  requirePermission(Permission.PAYMENT_VALIDATE),
  markPaymentProof
);
router.post(
  "/orders/:id/verify-payment",
  requirePermission(Permission.PAYMENT_VALIDATE),
  verifyPayment
);

// cash
router.post("/orders/:id/pay", requirePermission(Permission.PAYMENT_VALIDATE), payOrder);

// préparateur / clôture
router.post("/orders/:id/prepare", requirePermission(Permission.PREPARATION_UPDATE), prepareOrder);
router.post("/orders/:id/fulfill", requirePermission(Permission.PREPARATION_UPDATE), fulfillOrder);

// annulation
router.post(
  "/orders/:id/cancel",
  requirePermission(Permission.PREORDER_UPDATE_STATUS),
  cancelOrder
);

/**
 * STATS
 */
router.get("/stats", requirePermission(Permission.EXPORT_READ), getStats);

/**
 * PRODUCTS
 */
router.get("/products", requirePermission(Permission.PRODUCT_READ), listProducts);
router.get("/products/:id", requirePermission(Permission.PRODUCT_READ), getProductById);
router.post("/products", requirePermission(Permission.PRODUCT_WRITE), createProduct);
router.put("/products/:id", requirePermission(Permission.PRODUCT_WRITE), updateProduct);
router.delete("/products/:id", requirePermission(Permission.PRODUCT_WRITE), deleteProduct);
router.post(
  "/products/import",
  requirePermission(Permission.PRODUCT_WRITE),
  importProductsCsv
);
router.post(
  "/products/:id/image",
  requirePermission(Permission.PRODUCT_WRITE),
  uploadProductImage
);

// grade discounts

router.get(
  "/grade-discounts",
  requirePermission(Permission.DISCOUNT_READ),
  getGradeDiscounts
);

router.put(
  "/grade-discounts",
  requirePermission(Permission.DISCOUNT_WRITE),
  upsertGradeDiscounts
);


/**
 * USERS
 */
router.get(
  "/users",
  requirePermission(Permission.COUNTRY_READ),
  listUsers
);

router.get(
  "/users/:id",
  requirePermission(Permission.COUNTRY_READ),
  getUserById
);

router.post(
  "/users",
  requirePermission(Permission.COUNTRY_WRITE),
  createUser
);

router.put(
  "/users/:id",
  requirePermission(Permission.COUNTRY_WRITE),
  updateUser
);

router.patch(
  "/users/:id/status",
  requirePermission(Permission.COUNTRY_WRITE),
  updateUserStatus
);


/**
 * COUNTRY SETTINGS
 */
router.get(
  "/country-settings",
  requirePermission(Permission.COUNTRY_READ),
  getCountrySettings
);
router.patch(
  "/country-settings",
  requirePermission(Permission.COUNTRY_WRITE),
  updateCountrySettings
);

module.exports = router;
