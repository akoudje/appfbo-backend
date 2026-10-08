const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const { resolveAdminSession } = require("../services/admin-session.service");
async function requireJwt(req, res, next) {
  const [type, token] = String(req.header("Authorization") || "").split(" ");
  if (type?.toLowerCase() !== "bearer" || !token)
    return res.status(401).json({ message: "Unauthorized" });
  if (!process.env.JWT_SECRET)
    return res.status(500).json({ message: "Server misconfigured" });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (!payload?.sub || !payload?.role)
    return res.status(401).json({ message: "Unauthorized" });
  try {
    req.user = await resolveAdminSession(prisma, {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
      tokenSessionVersion: payload.sessionVersion,
      tokenIssuedAt: payload.iat,
      tokenExpiresAt: payload.exp,
    });
    return next();
  } catch (error) {
    if (error.statusCode === 401)
      return res.status(401).json({ message: error.message });
    return next(error);
  }
}
module.exports = { requireJwt };
