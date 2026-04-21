// src/routes/adminAuth.routes.js (CommonJS)

const express = require("express");
const { adminLogin, adminMe, seedSuperAdmin } = require("../controllers/adminAuth.controller");
const { requireAuth } = require("../middlewares/rbac");
const { createRateLimiter } = require("../middlewares/rateLimit");

const router = express.Router();

const authLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  keyPrefix: "admin-login",
  keyFn: (req) => ({
    ip: req.ip,
    email: String(req.body?.email || "").trim().toLowerCase(),
  }),
});

router.post("/login", authLoginLimiter, adminLogin);

// GET /me (protégé)
router.get("/me", requireAuth, adminMe);

// OPTIONNEL: bootstrap, désactivé par défaut en production
if (String(process.env.ENABLE_SEED_SUPER_ADMIN || "").toLowerCase() === "true") {
  router.post("/seed-super-admin", seedSuperAdmin);
}

module.exports = router;
