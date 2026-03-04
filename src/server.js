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

// CORS (mets ici le bloc corrigé donné plus haut)
const allowlist = new Set([
  "https://appfbo-frontend.vercel.app",
  "https://appfbo-admin.vercel.app",
]);
const vercelPreviewRegex = /^https:\/\/appfbo-admin-git-.*-junior-akoudjes-projects\.vercel\.app$/;
const localhostRegex = /^http:\/\/localhost:\d+$/;

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowlist.has(origin)) return cb(null, true);
      if (vercelPreviewRegex.test(origin)) return cb(null, true);
      if (localhostRegex.test(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Country"],
  })
);
app.options("*", cors());

app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

// Public routes
app.use("/api/products", productsRoutes);
app.use("/api/preorders", preordersRoutes);

// Admin auth (PUBLIC, sans resolveCountry)
app.use("/api/admin/auth", adminAuthRoutes);

// Admin protected (resolveCountry + requireAuth + requireCountryScope dedans)
app.use("/api/admin", adminRoutes);

app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use((req, res) => res.status(404).json({ error: "Not Found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server Error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));