// products.routes.js : définit les routes liées aux produits, actuellement une route GET pour lister les produits disponibles

const router = require("express").Router();
const { listProducts } = require("../controllers/products.controller");

router.get("/", listProducts);

module.exports = router;
