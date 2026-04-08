const jwt = require("jsonwebtoken");

function getBearerToken(req) {
  const raw = req.header("Authorization") || "";
  const [type, token] = raw.split(" ");
  if (String(type || "").toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function requireCustomerAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized customer" });
  }

  const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ message: "CUSTOMER_JWT_SECRET missing" });
  }

  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.sub || payload?.type !== "customer") {
      return res.status(401).json({ message: "Invalid customer token" });
    }

    req.customer = {
      fboId: payload.sub,
      countryId: payload.countryId || null,
      numeroFbo: payload.numeroFbo || null,
      email: payload.email || null,
    };
    return next();
  } catch (_err) {
    return res.status(401).json({ message: "Unauthorized customer" });
  }
}

module.exports = {
  requireCustomerAuth,
};

