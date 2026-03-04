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

/*
|--------------------------------------------------------------------------
| CORS configuration
|--------------------------------------------------------------------------
| Autorise :
| - production frontend
| - production admin
| - previews Vercel (branches)
| - localhost en dev
*/

const allowlist = new Set([
  "https://appfbo-frontend.vercel.app",
  "https://appfbo-admin.vercel.app",
]);

const vercelPreviewRegex =
  /^https:\/\/appfbo-admin-git-.*-junior-akoudjes-projects\.vercel\.app$/;

const localhostRegex = /^http:\/\/localhost:\d+$/;

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    if (allowlist.has(origin)) return cb(null, true);
    if (vercelPreviewRegex.test(origin)) return cb(null, true);
    if (localhostRegex.test(origin)) return cb(null, true);

    console.warn("Blocked by CORS:", origin);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },

  credentials: true,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Country",
  ],
};

app.use(cors(corsOptions));

/*
|--------------------------------------------------------------------------
| Important : gestion du preflight OPTIONS
| ⚠️ ne PAS utiliser "*" sinon crash avec path-to-regexp
|--------------------------------------------------------------------------
*/

app.options("/*", cors(corsOptions));

/*
|--------------------------------------------------------------------------
| Body parser
|--------------------------------------------------------------------------
*/

app.use(express.json({ limit: "1mb" }));

/*
|--------------------------------------------------------------------------
| Health check (Render)
|--------------------------------------------------------------------------
*/

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| Public API routes
|--------------------------------------------------------------------------
*/

app.use("/api/products", productsRoutes);
app.use("/api/preorders", preordersRoutes);

/*
|--------------------------------------------------------------------------
| Admin authentication routes (PUBLIC)
|--------------------------------------------------------------------------
*/

app.use("/api/admin/auth", adminAuthRoutes);

/*
|--------------------------------------------------------------------------
| Admin protected routes
| resolveCountry + requireAuth + requireCountryScope dedans
|--------------------------------------------------------------------------
*/

app.use("/api/admin", adminRoutes);

/*
|--------------------------------------------------------------------------
| Static uploads
|--------------------------------------------------------------------------
*/

app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

/*
|--------------------------------------------------------------------------
| 404 handler
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

/*
|--------------------------------------------------------------------------
| Global error handler
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    error: err.message || "Server Error",
  });
});

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 4000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on port ${PORT}`);
});