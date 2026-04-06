const windows = new Map();

function cleanup(now) {
  for (const [key, bucket] of windows.entries()) {
    if (bucket.resetAt <= now) windows.delete(key);
  }
}

function resolveClientIp(req) {
  const xfwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xfwd || req.ip || req.socket?.remoteAddress || "unknown";
}

function createRateLimiter({
  windowMs = 60_000,
  max = 60,
  keyPrefix = "global",
  keyFn,
} = {}) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    cleanup(now);

    const clientKey = keyFn ? keyFn(req) : resolveClientIp(req);
    const key = `${keyPrefix}:${clientKey}`;
    const current = windows.get(key);

    if (!current || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        message: "Too many requests",
      });
    }

    current.count += 1;
    return next();
  };
}

module.exports = {
  createRateLimiter,
};

