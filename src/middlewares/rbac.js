// src/middlewares/rbac.js
// Middleware RBAC (contrôle d'accès basé sur les rôles) pour Express.js
// Ce middleware fournit des fonctions permettant d'appliquer l'authentification, l'accès basé sur les rôles, les vérifications d'autorisation et les restrictions géographiques.
// Il permet d'analyser les informations utilisateur à partir d'en-têtes personnalisés à des fins de test ou d'intégration, et peut être utilisé dans les routes pour protéger les ressources en fonction des rôles et des autorisations des utilisateurs.

const jwt = require("jsonwebtoken");
const { AdminRole, hasPermission } = require("../../auth/permissions");

function parseJsonHeader(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function getBearerToken(req) {
  const raw = req.header("Authorization") || "";
  const [type, token] = raw.split(" ");
  if (type?.toLowerCase() !== "bearer") return null;
  return token || null;
}

function parseUserFromJwt(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.sub || !payload?.role) return null;

    return {
      id: payload.sub,
      email: payload.email || null,
      role: String(payload.role).trim().toUpperCase(),
      countryId: payload.countryId || null,
      permissions: undefined,
    };
  } catch (_) {
    return null;
  }
}

function parseUserFromHeaders(req) {
  const headerUser = parseJsonHeader(req.header("X-Admin-User"));
  if (headerUser && headerUser.role) return headerUser;

  const role = req.header("X-Admin-Role");
  if (!role) return null;

  const permissionsRaw = req.header("X-Admin-Permissions");
  const permissions = permissionsRaw
    ? String(permissionsRaw)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;

  return {
    id: req.header("X-Admin-Id") || null,
    email: req.header("X-Admin-Email") || null,
    role: String(role).trim().toUpperCase(),
    countryId: req.header("X-Admin-Country-Id") || null,
    permissions,
  };
}

function requireAuth(req, res, next) {
  if (req.user && req.user.role) return next();

  // 1) JWT first
  const jwtUser = parseUserFromJwt(req);
  if (jwtUser) {
    req.user = jwtUser;
    return next();
  }

  // 2) fallback headers (transition)
  const headerUser = parseUserFromHeaders(req);
  if (!headerUser) return res.status(401).json({ message: "Unauthorized" });

  req.user = headerUser;
  return next();
}

function requireRole(...roles) {
  const allowed = new Set(roles.flat().filter(Boolean));
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    if (!allowed.has(role))
      return res.status(403).json({ message: "Forbidden: role not allowed" });
    return next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.user;
    if (!user?.role) return res.status(401).json({ message: "Unauthorized" });

    const allowedByRole = hasPermission(user.role, permission);
    const allowedByUserList = Array.isArray(user.permissions)
      ? user.permissions.includes(permission)
      : false;

    if (!allowedByRole && !allowedByUserList) {
      return res
        .status(403)
        .json({ message: `Forbidden: missing permission ${permission}` });
    }
    return next();
  };
}

function requireCountryScope(req, res, next) {
  const user = req.user;
  if (!user?.role) return res.status(401).json({ message: "Unauthorized" });
  if (!req.country?.id)
    return res.status(400).json({ message: "Country required" });

  const globalRoles = new Set([AdminRole.SUPER_ADMIN, AdminRole.TECH_ADMIN]);

  if (globalRoles.has(user.role)) {
    return next();
  }

  if (!user.countryId || user.countryId !== req.country.id) {
    return res
      .status(403)
      .json({ message: "Forbidden: country scope mismatch" });
  }

  return next();
}

module.exports = {
  requireAuth,
  requireRole,
  requirePermission,
  requireCountryScope,
};
