// src/routes/adminAuth.routes.js (CommonJS)

const express = require("express");
const { adminLogin, seedSuperAdmin } = require("../controllers/adminAuth.controller");

const router = express.Router();

router.post("/login", adminLogin);

// OPTIONNEL: à activer uniquement si tu veux un endpoint de bootstrap
router.post("/seed-super-admin", seedSuperAdmin);

module.exports = router;