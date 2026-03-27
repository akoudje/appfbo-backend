// src/controllers/users.controller.js

const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const { AdminRole } = require("../auth/permissions");
const {
  validateAdminPassword,
  buildWeakPasswordMessage,
  createAdminAuditLog,
} = require("../services/admin-security.service");

const SALT_ROUNDS = 10;
const GLOBAL_ROLES = new Set(["SUPER_ADMIN", "TECH_ADMIN"]);
const VALID_ROLES = new Set(Object.values(AdminRole));
const ROLE_ASSIGNMENT_MATRIX = {
  SUPER_ADMIN: new Set(Object.values(AdminRole)),
  TECH_ADMIN: new Set(
    Object.values(AdminRole).filter((role) => role !== AdminRole.SUPER_ADMIN),
  ),
  OPERATIONS_DIRECTOR: new Set([
    AdminRole.BILLING_MANAGER,
    AdminRole.COUNTER_MANAGER,
    AdminRole.STOCK_MANAGER,
    AdminRole.MARKETING_ASSISTANT,
    AdminRole.INVOICER,
    AdminRole.CAISSIERE,
    AdminRole.ORDER_PREPARER,
  ]),
};

function parseIntSafe(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

function isGlobalRole(role) {
  return GLOBAL_ROLES.has(String(role || "").trim().toUpperCase());
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function assertValidRole(role) {
  if (!VALID_ROLES.has(role)) {
    const err = new Error("INVALID_ROLE");
    err.statusCode = 400;
    throw err;
  }
}

function canManageRole(actorRole, targetRole) {
  const normalizedActorRole = normalizeRole(actorRole);
  const normalizedTargetRole = normalizeRole(targetRole);
  const allowedRoles = ROLE_ASSIGNMENT_MATRIX[normalizedActorRole];
  return Boolean(allowedRoles && allowedRoles.has(normalizedTargetRole));
}

function assertRoleManageable(actorRole, targetRole) {
  if (!canManageRole(actorRole, targetRole)) {
    const err = new Error("ROLE_ASSIGNMENT_FORBIDDEN");
    err.statusCode = 403;
    throw err;
  }
}

function resolveManagedCountryId({
  actorRole,
  actorCountryId,
  targetRole,
  requestedCountryId,
}) {
  const targetIsGlobal = isGlobalRole(targetRole);
  const actorIsGlobal = isGlobalRole(actorRole);

  if (targetIsGlobal) {
    return null;
  }

  if (!actorIsGlobal) {
    if (!actorCountryId) {
      const err = new Error("ACTOR_COUNTRY_REQUIRED");
      err.statusCode = 400;
      throw err;
    }

    if (requestedCountryId && requestedCountryId !== actorCountryId) {
      const err = new Error("COUNTRY_ASSIGNMENT_FORBIDDEN");
      err.statusCode = 403;
      throw err;
    }

    return actorCountryId;
  }

  if (!requestedCountryId) {
    const err = new Error("COUNTRY_REQUIRED_FOR_ROLE");
    err.statusCode = 400;
    throw err;
  }

  return requestedCountryId;
}

async function resolveCountryIdFromCode(countryCode) {
  if (!countryCode || !String(countryCode).trim()) return null;

  const code = String(countryCode).trim().toUpperCase();

  const country = await prisma.country.findUnique({
    where: { code },
    select: { id: true, code: true, name: true },
  });

  return country || null;
}

function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    actif: user.actif,
    countryId: user.countryId || null,
    countryCode: user.country?.code || null,
    countryName: user.country?.name || null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    passwordChangedAt: user.passwordChangedAt || null,
    lockedUntil: user.lockedUntil || null,
    updatedAt: user.updatedAt,
  };
}

function buildUsersErrorMessage(error, fallbackMessage) {
  if (error.message === "INVALID_ROLE") {
    return "Le rôle sélectionné est invalide.";
  }
  if (error.message === "ROLE_ASSIGNMENT_FORBIDDEN") {
    return "Vous n'êtes pas autorisé à attribuer ou gérer ce rôle.";
  }
  if (error.message === "COUNTRY_REQUIRED_FOR_ROLE") {
    return "Un pays est requis pour ce rôle.";
  }
  if (error.message === "COUNTRY_ASSIGNMENT_FORBIDDEN") {
    return "Vous ne pouvez pas attribuer cet utilisateur à un autre pays.";
  }
  if (error.message === "ACTOR_COUNTRY_REQUIRED") {
    return "Votre compte doit être rattaché à un pays pour gérer ce rôle.";
  }
  if (error.message === "SELF_ROLE_CHANGE_FORBIDDEN") {
    return "Vous ne pouvez pas modifier votre propre rôle.";
  }
  return fallbackMessage;
}

/**
 * GET /api/admin/users?q=&role=&actif=&countryCode=&page=&pageSize=
 */
async function listUsers(req, res) {
  try {
    const { q, role, actif, countryCode } = req.query;

    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const pageSize = Math.min(
      100,
      Math.max(10, parseIntSafe(req.query.pageSize, 20)),
    );
    const skip = (page - 1) * pageSize;

    const where = {};

    if (q && String(q).trim()) {
      const qs = String(q).trim();
      where.OR = [
        { fullName: { contains: qs, mode: "insensitive" } },
        { email: { contains: qs, mode: "insensitive" } },
      ];
    }

    if (role && String(role).trim()) {
      where.role = String(role).trim().toUpperCase();
    }

    const actifBool = normalizeBool(actif);
    if (actifBool !== null) {
      where.actif = actifBool;
    }

    if (countryCode && String(countryCode).trim()) {
      const country = await resolveCountryIdFromCode(countryCode);
      if (!country) {
        return res.status(404).json({ message: "Pays introuvable" });
      }
      where.countryId = country.id;
    } else if (!isGlobalRole(req.user?.role) && req.country?.id) {
      where.countryId = req.country.id;
    }

    const [totalCount, users] = await Promise.all([
      prisma.adminUser.count({ where }),
      prisma.adminUser.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }],
        include: {
          country: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      data: users.map(sanitizeUser),
    });
  } catch (e) {
    console.error("listUsers error:", e);
    return res.status(500).json({ message: "Erreur serveur (listUsers)" });
  }
}

/**
 * GET /api/admin/users/:id
 */
async function getUserById(req, res) {
  try {
    const { id } = req.params;

    const user = await prisma.adminUser.findUnique({
      where: { id },
      include: {
        country: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    if (
      !isGlobalRole(req.user?.role) &&
      req.country?.id &&
      user.countryId !== req.country.id
    ) {
      return res.status(403).json({ message: "Forbidden: country scope mismatch" });
    }

    return res.json(sanitizeUser(user));
  } catch (e) {
    console.error("getUserById error:", e);
    return res.status(500).json({ message: "Erreur serveur (getUserById)" });
  }
}

/**
 * POST /api/admin/users
 */
async function createUser(req, res) {
  try {
    const {
      email,
      password,
      fullName,
      role,
      actif = true,
      countryCode,
    } = req.body || {};

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(password || "");
    const normalizedFullName = fullName ? String(fullName).trim() : null;
    const normalizedRole = normalizeRole(role);

    if (!normalizedEmail) {
      return res.status(400).json({ message: "email requis" });
    }

    if (!normalizedPassword) {
      return res.status(400).json({ message: "password requis" });
    }

    validateAdminPassword(normalizedPassword);

    if (!normalizedRole) {
      return res.status(400).json({ message: "role requis" });
    }

    assertValidRole(normalizedRole);
    assertRoleManageable(req.user?.role, normalizedRole);

    let requestedCountryId = null;

    if (countryCode && String(countryCode).trim()) {
      const country = await resolveCountryIdFromCode(countryCode);
      if (!country) {
        return res.status(404).json({ message: "Pays introuvable" });
      }
      requestedCountryId = country.id;
    }

    const resolvedCountryId = resolveManagedCountryId({
      actorRole: req.user?.role,
      actorCountryId: req.country?.id || req.user?.countryId || null,
      targetRole: normalizedRole,
      requestedCountryId,
    });

    const hashedPassword = await bcrypt.hash(normalizedPassword, SALT_ROUNDS);

    const created = await prisma.adminUser.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        fullName: normalizedFullName,
        role: normalizedRole,
        actif: Boolean(actif),
        countryId: resolvedCountryId,
        passwordChangedAt: new Date(),
      },
      include: {
        country: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    await createAdminAuditLog(prisma, {
      actorAdminId: req.user?.id || null,
      targetAdminId: created.id,
      action: "ADMIN_USER_CREATED",
      note: "Création d'un compte administrateur.",
      meta: {
        role: created.role,
        countryId: created.countryId,
        actif: created.actif,
      },
    });

    return res.status(201).json(sanitizeUser(created));
  } catch (e) {
    console.error("createUser error:", e);

    if (String(e?.code) === "P2002") {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    if (e.message === "WEAK_PASSWORD") {
      return res.status(e.statusCode || 400).json({
        message: buildWeakPasswordMessage(),
      });
    }

    return res.status(e.statusCode || 500).json({
      message: buildUsersErrorMessage(e, "Erreur serveur (createUser)"),
    });
  }
}

/**
 * PUT /api/admin/users/:id
 */
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { email, password, fullName, role, actif, countryCode } = req.body || {};

    const existing = await prisma.adminUser.findUnique({
      where: { id },
      include: {
        country: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    if (
      !isGlobalRole(req.user?.role) &&
      req.country?.id &&
      existing.countryId !== req.country.id
    ) {
      return res.status(403).json({ message: "Forbidden: country scope mismatch" });
    }

    const data = {};
    const nextRole = role !== undefined ? normalizeRole(role) : existing.role;
    let passwordChanged = false;

    if (req.user?.id === id && role !== undefined && nextRole !== existing.role) {
      const err = new Error("SELF_ROLE_CHANGE_FORBIDDEN");
      err.statusCode = 400;
      throw err;
    }

    if (email !== undefined) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(400).json({ message: "email invalide" });
      }
      data.email = normalizedEmail;
    }

    if (fullName !== undefined) {
      data.fullName = fullName ? String(fullName).trim() : null;
    }

    if (role !== undefined) {
      if (!nextRole) {
        return res.status(400).json({ message: "role invalide" });
      }
      assertValidRole(nextRole);
      assertRoleManageable(req.user?.role, nextRole);
      data.role = nextRole;
    } else {
      assertRoleManageable(req.user?.role, existing.role);
    }

    if (actif !== undefined) {
      data.actif = Boolean(actif);
    }

    if (password !== undefined && String(password).trim()) {
      const normalizedPassword = String(password);
      validateAdminPassword(normalizedPassword);
      data.password = await bcrypt.hash(normalizedPassword, SALT_ROUNDS);
      data.passwordChangedAt = new Date();
      data.failedLoginCount = 0;
      data.lockedUntil = null;
      passwordChanged = true;
    }

    let requestedCountryId =
      existing.countryId !== undefined ? existing.countryId : null;

    if (countryCode !== undefined) {
      if (!countryCode) {
        requestedCountryId = null;
      } else {
        const country = await resolveCountryIdFromCode(countryCode);
        if (!country) {
          return res.status(404).json({ message: "Pays introuvable" });
        }
        requestedCountryId = country.id;
      }
    }

    data.countryId = resolveManagedCountryId({
      actorRole: req.user?.role,
      actorCountryId: req.country?.id || req.user?.countryId || null,
      targetRole: nextRole,
      requestedCountryId,
    });

    const updated = await prisma.adminUser.update({
      where: { id },
      data,
      include: {
        country: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    await createAdminAuditLog(prisma, {
      actorAdminId: req.user?.id || null,
      targetAdminId: updated.id,
      action: passwordChanged ? "ADMIN_USER_UPDATED_PASSWORD" : "ADMIN_USER_UPDATED",
      note: passwordChanged
        ? "Mise à jour du compte administrateur avec rotation du mot de passe."
        : "Mise à jour du compte administrateur.",
      meta: {
        role: updated.role,
        countryId: updated.countryId,
        actif: updated.actif,
        passwordChanged,
      },
    });

    return res.json(sanitizeUser(updated));
  } catch (e) {
    console.error("updateUser error:", e);

    if (String(e?.code) === "P2002") {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    if (e.message === "WEAK_PASSWORD") {
      return res.status(e.statusCode || 400).json({
        message: buildWeakPasswordMessage(),
      });
    }

    return res.status(e.statusCode || 500).json({
      message: buildUsersErrorMessage(e, "Erreur serveur (updateUser)"),
    });
  }
}

/**
 * PATCH /api/admin/users/:id/status
 */
async function updateUserStatus(req, res) {
  try {
    const { id } = req.params;
    const { actif } = req.body || {};

    if (typeof actif !== "boolean") {
      return res.status(400).json({ message: "actif requis (boolean)" });
    }

    const existing = await prisma.adminUser.findUnique({
      where: { id },
      include: {
        country: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    if (
      !isGlobalRole(req.user?.role) &&
      req.country?.id &&
      existing.countryId !== req.country.id
    ) {
      return res.status(403).json({ message: "Forbidden: country scope mismatch" });
    }

    if (req.user?.id === id && actif === false) {
      return res.status(400).json({
        message: "Vous ne pouvez pas désactiver votre propre compte.",
      });
    }

    assertRoleManageable(req.user?.role, existing.role);

    const updated = await prisma.adminUser.update({
      where: { id },
      data: { actif },
      include: {
        country: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    await createAdminAuditLog(prisma, {
      actorAdminId: req.user?.id || null,
      targetAdminId: updated.id,
      action: actif ? "ADMIN_USER_ACTIVATED" : "ADMIN_USER_DEACTIVATED",
      note: actif
        ? "Compte administrateur réactivé."
        : "Compte administrateur désactivé.",
      meta: {
        role: updated.role,
        countryId: updated.countryId,
        actif: updated.actif,
      },
    });

    return res.json(sanitizeUser(updated));
  } catch (e) {
    console.error("updateUserStatus error:", e);
    return res.status(e.statusCode || 500).json({
      message: buildUsersErrorMessage(e, "Erreur serveur (updateUserStatus)"),
    });
  }
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
};
