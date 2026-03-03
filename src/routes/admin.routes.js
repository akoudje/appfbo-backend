// src/routes/admin.routes.js
const express = require("express");

const {
  // orders
  listOrders,
  getOrderById,
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
} = require("../controllers/admin.controller.js");

const router = express.Router();

/**
 * ORDERS
 */
router.get("/orders", listOrders);
router.get("/orders/:id", getOrderById);

// optionnel (si tu veux un endpoint générique)
router.patch("/orders/:id/status", updateOrderStatus);

// facturier
router.post("/orders/:id/invoice", invoiceOrder);
router.post("/orders/:id/proof", markPaymentProof);
router.post("/orders/:id/verify-payment", verifyPayment);

// cash
router.post("/orders/:id/pay", payOrder);

// préparateur / clôture
router.post("/orders/:id/prepare", prepareOrder);
router.post("/orders/:id/fulfill", fulfillOrder);

// annulation
router.post("/orders/:id/cancel", cancelOrder);

/**
 * STATS
 */
router.get("/stats", getStats);

/**
 * PRODUCTS
 */
router.get("/products", listProducts);
router.get("/products/:id", getProductById);
router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.delete("/products/:id", deleteProduct);
router.post("/products/import", importProductsCsv);
router.post("/products/:id/image", uploadProductImage);

module.exports = router;