// products.routes.js : définit les routes liées aux produits, actuellement une route GET pour lister les produits disponibles

// src/routes/products.routes.js
const router = require("express").Router();
const { listProducts, getProductById } = require("../controllers/products.controller");

// Liste catalogue
router.get("/", listProducts);

// Détail produit (pour ProductDetail.jsx)
router.get("/:id", getProductById);

module.exports = router;
