// src/routes/adminAuth.routes.js (CommonJS)

const express = require("express");
const { adminLogin, adminMe, seedSuperAdmin } = require("../controllers/adminAuth.controller");
const { requireAuth } = require("../middlewares/rbac");

const router = express.Router();

router.post("/login", adminLogin);

// GET /me (protégé)
router.get("/me", requireAuth, adminMe);

// OPTIONNEL: bootstrap, à désactiver après usage
router.post("/seed-super-admin", seedSuperAdmin);

module.exports = router;