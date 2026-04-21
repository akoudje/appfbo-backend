const crypto = require("crypto");
const prisma = require("../prisma");

const windows = new Map();
let lastLocalCleanupAt = 0;
let dbRateLimitTableReady = false;
let dbRateLimitTableInitPromise = null;
let lastDbCleanupAt = 0;

function cleanupLocal(now) {
  if (now - lastLocalCleanupAt < 15_000) return;
  lastLocalCleanupAt = now;

  for (const [key, bucket] of windows.entries()) {
    if (bucket.resetAt <= now) windows.delete(key);
  }
}

function resolveClientIp(req) {
  const xfwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xfwd || req.ip || req.socket?.remoteAddress || "unknown";
}

function normalizeKeyPart(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeKeyPart(entry)).join("|");
  }
  if (typeof value === "object") {
    return Object.keys(value)
      .sort()
      .map((key) => `${key}:${normalizeKeyPart(value[key])}`)
      .join("|");
  }
  return String(value).trim().toLowerCase();
}

function hashKey(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function getRateLimitStoreMode() {
  return String(process.env.RATE_LIMIT_STORE || "memory")
    .trim()
    .toLowerCase();
}

async function ensureDbRateLimitTable() {
  if (dbRateLimitTableReady) return;
  if (!dbRateLimitTableInitPromise) {
    dbRateLimitTableInitPromise = prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_rate_limit_windows (
        bucket_key TEXT PRIMARY KEY,
        request_count INTEGER NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
      .then(() => {
        dbRateLimitTableReady = true;
      })
      .finally(() => {
        dbRateLimitTableInitPromise = null;
      });
  }

  await dbRateLimitTableInitPromise;
}

async function cleanupDb(now) {
  if (now - lastDbCleanupAt < 60_000) return;
  lastDbCleanupAt = now;

  await ensureDbRateLimitTable();
  await prisma.$executeRawUnsafe(
    "DELETE FROM app_rate_limit_windows WHERE reset_at <= NOW() - INTERVAL '5 minutes'",
  );
}

function buildHeaders(res, { max, count, resetAt }) {
  const remaining = Math.max(0, max - count);
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  return remaining;
}

function consumeLocalBucket({ key, now, windowMs }) {
  cleanupLocal(now);

  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    const created = { count: 1, resetAt: now + windowMs };
    windows.set(key, created);
    return created;
  }

  current.count += 1;
  return current;
}

async function consumeDbBucket({ key, now, windowMs }) {
  await ensureDbRateLimitTable();
  await cleanupDb(now);

  const nowIso = new Date(now).toISOString();
  const resetIso = new Date(now + windowMs).toISOString();

  const rows = await prisma.$queryRawUnsafe(
    `
      INSERT INTO app_rate_limit_windows (bucket_key, request_count, reset_at, updated_at)
      VALUES ($1, 1, $2::timestamptz, NOW())
      ON CONFLICT (bucket_key)
      DO UPDATE SET
        request_count = CASE
          WHEN app_rate_limit_windows.reset_at <= $3::timestamptz THEN 1
          ELSE app_rate_limit_windows.request_count + 1
        END,
        reset_at = CASE
          WHEN app_rate_limit_windows.reset_at <= $3::timestamptz THEN $2::timestamptz
          ELSE app_rate_limit_windows.reset_at
        END,
        updated_at = NOW()
      RETURNING request_count, EXTRACT(EPOCH FROM reset_at) * 1000 AS reset_at_ms
    `,
    key,
    resetIso,
    nowIso,
  );

  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    count: Number(row?.request_count || 0),
    resetAt: Number(row?.reset_at_ms || now + windowMs),
  };
}

function createRateLimiter({
  windowMs = 60_000,
  max = 60,
  keyPrefix = "global",
  keyFn,
  skipSuccessfulRequests = false,
} = {}) {
  return async function rateLimiter(req, res, next) {
    try {
      const now = Date.now();
      const clientKeyRaw = keyFn ? keyFn(req) : resolveClientIp(req);
      const normalizedKey = normalizeKeyPart(clientKeyRaw) || resolveClientIp(req);
      const key = `${keyPrefix}:${hashKey(normalizedKey)}`;
      const storeMode = getRateLimitStoreMode();

      const bucket =
        storeMode === "database"
          ? await consumeDbBucket({ key, now, windowMs })
          : consumeLocalBucket({ key, now, windowMs });

      const remaining = buildHeaders(res, {
        max,
        count: bucket.count,
        resetAt: bucket.resetAt,
      });

      if (skipSuccessfulRequests && storeMode !== "memory") {
        console.warn("[rate-limit] skipSuccessfulRequests ignored for non-memory store", {
          keyPrefix,
          storeMode,
        });
      }

      if (skipSuccessfulRequests && storeMode === "memory") {
        const originalEnd = res.end.bind(res);
        res.end = (...args) => {
          if (res.statusCode < 400) {
            const current = windows.get(key);
            if (current) {
              current.count = Math.max(0, current.count - 1);
              buildHeaders(res, {
                max,
                count: current.count,
                resetAt: current.resetAt,
              });
            }
          }
          return originalEnd(...args);
        };
      }

      if (bucket.count > max) {
        const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({
          message: "Too many requests",
          retryAfterSec,
          remaining,
        });
      }

      return next();
    } catch (error) {
      console.error("[rate-limit] fallback-on-error", {
        keyPrefix,
        message: error?.message || String(error),
      });

      const now = Date.now();
      const clientKeyRaw = keyFn ? keyFn(req) : resolveClientIp(req);
      const normalizedKey = normalizeKeyPart(clientKeyRaw) || resolveClientIp(req);
      const key = `${keyPrefix}:${hashKey(normalizedKey)}`;
      const bucket = consumeLocalBucket({ key, now, windowMs });
      buildHeaders(res, {
        max,
        count: bucket.count,
        resetAt: bucket.resetAt,
      });

      if (bucket.count > max) {
        const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({
          message: "Too many requests",
          retryAfterSec,
        });
      }

      return next();
    }
  };
}

module.exports = {
  createRateLimiter,
};
