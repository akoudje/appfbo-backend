// src/middlewares/rbac.js
// RBAC (Role-Based Access Control) middleware for Express.js
// This middleware provides functions to enforce authentication, role-based access, permission checks, and country scope restrictions.
// It allows parsing user information from custom headers for testing or integration purposes, and can be used in routes to protect resources based on user roles and permissions.


const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const { AdminRole, hasPermission } = require("../auth/permissions");

function getBearerToken(req) {
  const auth = req.header("Authorization") || "";
  const parts = auth.split(" ");
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1].trim();
  return null;
}

/**
 * DEV ONLY: allow parsing user from headers for local testing
 * (never trust these in production).
 */
function parseJsonHeader(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function parseUserFromHeadersDev(req) {
  const headerUser = parseJsonHeader(req.header("X-Admin-User"));
  if (headerUser && headerUser.role) return headerUser;

  const role = req.header("X-Admin-Role");
  if (!role) return null;

  // IMPORTANT: we DO NOT accept X-Admin-Permissions in prod.
  // Even in dev, it's optional and should not be used for real security.
  const permissionsRaw = req.header("X-Admin-Permissions");
  const permissions = permissionsRaw
    ? String(permissionsRaw)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;

  return {
    id: req.header("X-Admin-Id") || null,
    role: String(role).trim().toUpperCase(),
    countryId: req.header("X-Admin-Country-Id") || null,
    permissions,
  };
}

/**
 * requireAuth
 * - Production: JWT required
 * - Development: JWT OR header-based dev fallback (optional)
 */
async function requireAuth(req, res, next) {
  try {
    if (req.user && req.user.role) return next();

    const token = getBearerToken(req);

    // DEV fallback if no token
    if (!token) {
      if (process.env.NODE_ENV === "development") {
        const devUser = parseUserFromHeadersDev(req);
        if (!devUser) return res.status(401).json({ message: "Unauthorized" });
        req.user = devUser;
        return next();
      }
      return res.status(401).json({ message: "Unauthorized" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("JWT_SECRET is missing");
      return res.status(500).json({ message: "Server misconfiguration (JWT)" });
    }

    // payload expected: { sub: adminUserId, role?: "...", ... }
    const payload = jwt.verify(token, secret);

    const adminId = payload.sub || payload.id;
    if (!adminId) return res.status(401).json({ message: "Unauthorized" });

    // Load user from DB (source of truth)
    const admin = await prisma.adminUser.findUnique({
      where: { id: String(adminId) },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        actif: true,
        countryId: true,
      },
    });

    if (!admin || !admin.actif) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Attach normalized user object
    req.user = {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      countryId: admin.countryId || null,
      // NOTE: do NOT carry arbitrary permissions from client
    };

    return next();
  } catch (err) {
    // token expired / invalid signature, etc.
    return res.status(401).json({ message: "Unauthorized" });
  }
}

function requireRole(...roles) {
  const allowed = new Set(roles.flat().filter(Boolean));
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    if (!allowed.has(role)) {
      return res.status(403).json({ message: "Forbidden: role not allowed" });
    }
    return next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.user;
    if (!user?.role) return res.status(401).json({ message: "Unauthorized" });

    // Source of truth = rolePermissions mapping
    const allowedByRole = hasPermission(user.role, permission);

    // DEV override only (optional)
    const allowedByDevUserList =
      process.env.NODE_ENV === "development" && Array.isArray(user.permissions)
        ? user.permissions.includes(permission)
        : false;

    if (!allowedByRole && !allowedByDevUserList) {
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
  if (!req.country?.id) return res.status(400).json({ message: "Country required" });

  // Reco: garde SUPER_ADMIN scoppé par défaut.
  // Si tu veux du cross-country, fais des routes /admin/global séparées.
  if (user.role === AdminRole.SUPER_ADMIN) return next();

  if (!user.countryId || user.countryId !== req.country.id) {
    return res.status(403).json({ message: "Forbidden: country scope mismatch" });
  }
  return next();
}

module.exports = {
  requireAuth,
  requireRole,
  requirePermission,
  requireCountryScope,
};