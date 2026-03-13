// src/server.js
// Point d'entrée de l'API Express, configuration des middlewares globaux, CORS, et montage des routes

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const adminRoutes = require("./routes/admin.routes.js");
const adminAuthRoutes = require("./routes/adminAuth.routes");
const productsRoutes = require("./routes/products.routes.js");
const preordersRoutes = require("./routes/preorders.routes.js");
const paymentsRoutes = require("./routes/payments.routes");

const app = express();

/* =========================================================
   CORS
   ========================================================= */

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    try {
      const { hostname, protocol } = new URL(origin);
      if (protocol !== "https:" && protocol !== "http:") {
        return cb(new Error("Bad origin"));
      }

      if (
        origin === "https://appfbo-frontend.vercel.app" ||
        origin === "https://appfbo-admin.vercel.app"
      ) {
        return cb(null, true);
      }

      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return cb(null, true);
      }

      if (
        hostname.endsWith(".vercel.app") &&
        (hostname.startsWith("appfbo-admin") ||
          hostname.startsWith("appfbo-frontend"))
      ) {
        return cb(null, true);
      }

      console.warn("CORS blocked:", origin);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    } catch (e) {
      console.warn("CORS origin parse failed:", origin);
      return cb(new Error("CORS origin invalid"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Country"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* =========================================================
   Middlewares
   ========================================================= */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   Health check
   ========================================================= */
app.get("/health", (req, res) => res.json({ ok: true }));

/* =========================================================
   Routes publiques
   ========================================================= */
app.use("/api/products", productsRoutes);
app.use("/api/preorders", preordersRoutes);

/* =========================================================
   Routes de paiement (webhooks, etc.)
   ========================================================= */
app.use("/api/payments", paymentsRoutes);

/* =========================================================
   Admin AUTH (publique)
   ========================================================= */
app.use("/api/admin/auth", adminAuthRoutes);

/* =========================================================
   Admin protégée
   ========================================================= */
app.use("/api/admin", adminRoutes);

/* =========================================================
   Static
   ========================================================= */
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

/* =========================================================
   404 + error handler
   ========================================================= */
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: err.message || "Server Error" });
});

/* =========================================================
   Start
   ========================================================= */
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on port ${PORT}`);
});