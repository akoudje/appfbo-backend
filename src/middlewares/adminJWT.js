// src/middlewares/adminJwt.js (CommonJS)

const jwt = require("jsonwebtoken");

function getBearerToken(req) {
  const raw = req.header("Authorization") || "";
  const [type, token] = raw.split(" ");
  if (type?.toLowerCase() !== "bearer") return null;
  return token || null;
}

function requireJwt(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("JWT_SECRET missing in env");
      return res.status(500).json({ message: "Server misconfigured (JWT_SECRET)" });
    }

    const payload = jwt.verify(token, secret);

    // payload attendu: { sub, role, countryId, email }
    req.user = {
      id: payload.sub,
      role: payload.role,
      countryId: payload.countryId || null,
      email: payload.email || null,
    };

    return next();
  } catch (e) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

module.exports = { requireJwt };