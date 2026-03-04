// server.js : point d'entrée de l'API, configure Express, les routes, les middlewares et démarre le serveur
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const adminRoutes = require("./routes/admin.routes.js");
const adminAuthRoutes = require("./routes/adminAuth.routes");

const productsRoutes = require("./routes/products.routes.js");
const preordersRoutes = require("./routes/preorders.routes.js");

const app = express();

const allowlist = [
  "https://appfbo-frontend.vercel.app",
  "https://appfbo-admin.vercel.app",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowlist.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// Public routes
app.use("/api/products", productsRoutes);
app.use("/api/preorders", preordersRoutes);

// Admin auth (public) — PAS de resolveCountry ici
app.use("/api/admin/auth", adminAuthRoutes);

// Admin protected routes (resolveCountry + requireAuth + requireCountryScope dans admin.routes.js)
app.use("/api/admin", adminRoutes);

// Static
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server Error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
