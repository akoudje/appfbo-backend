// src/routes/admin.routes.js
const express = require("express");

const {
  // orders
  listOrders,
  getOrderById,
  updateOrderStatus,
  invoiceOrder,
  payOrder,

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
router.patch("/orders/:id/status", updateOrderStatus);
router.post("/orders/:id/invoice", invoiceOrder);
router.post("/orders/:id/pay", payOrder);

/**
 * STATS
 */
router.get("/stats", getStats);

/**
 * PRODUCTS
 */
router.get("/products", listProducts);
router.get("/products/:id", getProductById); // <= pour productsService.getById
router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.delete("/products/:id", deleteProduct);
router.post("/products/import", importProductsCsv);
router.post("/products/:id/image", uploadProductImage);

module.exports = router;
