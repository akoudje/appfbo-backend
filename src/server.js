// backend/src/server.js
// Point d'entrée de l'API Express, configuration des middlewares globaux, CORS, et montage des routes

require("dotenv").config();

// Validation des secrets au démarrage — crash immédiat si une variable est faible ou manquante
const { validateEnv } = require("./config/validate-env");
validateEnv();

const express = require("express");
const cors = require("cors");
const path = require("path");

const adminRoutes = require("./routes/admin.routes.js");
const adminAuthRoutes = require("./routes/adminAuth.routes");

const productsRoutes = require("./routes/products.routes.js");
const preordersRoutes = require("./routes/preorders.routes.js");
const publicConfigRoutes = require("./routes/public-config.routes.js");
const countriesRoutes = require("./routes/countries.routes.js");
const paymentsRoutes = require("./routes/payments.routes");
const webhooksRoutes = require("./routes/webhooks.routes");
const smsRoutes = require("./routes/sms.routes");
const customerRoutes = require("./routes/customer.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const marketingEventsRoutes = require("./routes/marketing-events.routes");
const ticketingRoutes = require("./routes/ticketing.routes");
const fboDocumentsRoutes = require("./routes/fboDocuments.routes");
const externalPaymentLinksRoutes = require("./routes/external-payment-links.routes");
const memorialsRoutes = require("./routes/memorials.routes");
const {
  startExpiredInvoiceAutoCancelScheduler,
} = require("./services/preorder-expiration.service");
const {
  startNotificationDispatchScheduler,
} = require("./services/notification-dispatch.service");


const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://appfbo-frontend.vercel.app",
  "https://appfbo-admin.vercel.app",
  "https://forevercivstore.com",
  "https://www.forevercivstore.com",
  "https://admin.forevercivstore.com",
]);

const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.forevercivstore\.com$/i,
];

function parseAllowedOrigins() {
  const raw = String(process.env.ALLOWED_ORIGINS || "").trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set(values);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegex(pattern) {
  const normalized = String(pattern || "").trim();
  if (!normalized) return null;
  const escaped = escapeRegex(normalized).replace(/\\\*/g, "[^.]+");
  return new RegExp(`^${escaped}$`, "i");
}

function parseAllowedOriginPatterns() {
  const raw = String(process.env.ALLOWED_ORIGIN_PATTERNS || "").trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGIN_PATTERNS;

  return raw
    .split(",")
    .map((v) => wildcardToRegex(v))
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();
const allowedOriginPatterns = parseAllowedOriginPatterns();

app.use((req, res, next) => {
  const rid =
    req.get("x-request-id") ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  req.requestId = rid;
  res.setHeader("X-Request-Id", rid);
  next();
});

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // HSTS activé si l'app est exposée en HTTPS via reverse-proxy.
  if (String(req.protocol || "").toLowerCase() === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

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

      if (allowedOrigins.has(origin)) {
        return cb(null, true);
      }

      if (allowedOriginPatterns.some((rx) => rx.test(origin))) {
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
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Country",
    "X-Request-Id",
    "X-Idempotency-Key",
  ],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

console.log("CORS allowlist (exact):", Array.from(allowedOrigins).join(", "));
console.log(
  "CORS allowlist (patterns):",
  allowedOriginPatterns.map((rx) => rx.toString()).join(", ")
);



/* =========================================================
   Middlewares
   ========================================================= */

//app.use(express.json({ limit: "1mb" }));

app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString("utf8") || "";
    },
  })
);


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
app.use("/api/public-config", publicConfigRoutes);
app.use("/api/countries", countriesRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/marketing-events", marketingEventsRoutes);
app.use("/api/ticketing", ticketingRoutes);
app.use("/api/fbo-documents", fboDocumentsRoutes);
app.use("/api/external-payment-links", externalPaymentLinksRoutes);
app.use("/api/memorials", memorialsRoutes);

/* =========================================================
   Routes de paiement (webhooks, etc.)
   ========================================================= */
app.use("/api/payments", paymentsRoutes);
app.use("/webhooks", webhooksRoutes);
app.use("/api/sms", smsRoutes);

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
app.use("/uploads/bank-proofs", (req, res) =>
  res.status(403).json({ error: "Forbidden" })
);
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

/* =========================================================
   404 + error handler
   ========================================================= */
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

app.use((err, req, res, next) => {
  console.error("Server error:", {
    requestId: req.requestId || null,
    method: req.method,
    path: req.originalUrl,
    message: err?.message || "Unknown error",
  });

  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProd) {
    return res.status(500).json({
      error: "Internal Server Error",
      requestId: req.requestId || null,
    });
  }

  return res.status(500).json({
    error: err.message || "Server Error",
    requestId: req.requestId || null,
  });
});

/* =========================================================
   Start
   ========================================================= */
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on port ${PORT}`);
});

startExpiredInvoiceAutoCancelScheduler();
startNotificationDispatchScheduler();
