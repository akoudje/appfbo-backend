const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const {
  AdminRole,
  Permission,
  getEffectivePermissions,
  normalizePermissionList,
} = require("../auth/permissions");
const {
  validateAdminPassword,
  buildWeakPasswordMessage,
} = require("../services/admin-security.service");
const {
  AUDIT_FIELDS,
  managementError,
  manageableRoles,
  canManageRole,
  saveManagedUser,
} = require("../services/admin-user-management.service");
const includeCountry = {
  country: { select: { id: true, code: true, name: true } },
};
function assertReadScope(req, user) {
  if (
    req.user.role !== "SUPER_ADMIN" &&
    (!req.country?.id ||
      req.user.countryId !== req.country.id ||
      user.countryId !== req.country.id)
  )
    throw managementError("Accès limité aux comptes de votre pays.", 403);
}
function sanitizeUser(user, actor) {
  const allow = normalizePermissionList(user.permissionAllow),
    deny = normalizePermissionList(user.permissionDeny);
  const manageable =
    canManageRole(actor.role, user.role) &&
    (actor.role === "SUPER_ADMIN" || actor.countryId === user.countryId);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    permissions: getEffectivePermissions(user.role, allow, deny),
    permissionAllow: allow,
    permissionDeny: deny,
    actif: user.actif,
    countryId: user.countryId || null,
    countryCode: user.country?.code || null,
    countryName: user.country?.name || null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    passwordChangedAt: user.passwordChangedAt || null,
    lockedUntil: user.lockedUntil || null,
    updatedAt: user.updatedAt,
    actions: {
      canEdit: manageable,
      canChangeStatus: manageable && user.id !== actor.id,
      canResetPassword: manageable,
      canRevokeSessions: manageable,
    },
  };
}
function respondError(res, error, fallback) {
  if (error.message === "WEAK_PASSWORD")
    return res
      .status(400)
      .json({
        message: buildWeakPasswordMessage(),
        errors: { password: buildWeakPasswordMessage() },
      });
  if (!error.statusCode) console.error(fallback, error);
  return res
    .status(error.statusCode || 500)
    .json({
      message: error.statusCode ? error.message : fallback,
      ...(error.errors ? { errors: error.errors } : {}),
    });
}
function validateFields(body, create = false) {
  const errors = {};
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw managementError("Formulaire invalide.");
  if (create || "email" in body) {
    if (
      typeof body.email !== "string" ||
      body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
    )
      errors.email = "Renseignez une adresse email valide.";
  }
  if (create || "fullName" in body) {
    if (
      typeof body.fullName !== "string" ||
      !body.fullName.trim() ||
      body.fullName.length > 150
    )
      errors.fullName = "Renseignez un nom complet (150 caractères maximum).";
  }
  if (create || "role" in body) {
    if (
      typeof body.role !== "string" ||
      !Object.values(AdminRole).includes(body.role.trim().toUpperCase())
    )
      errors.role = "Sélectionnez un rôle valide.";
  }
  if ("actif" in body && typeof body.actif !== "boolean")
    errors.actif = "Le statut doit être activé ou désactivé.";
  if (create || "password" in body) {
    if (typeof body.password !== "string" || (create && !body.password))
      errors.password = "Le mot de passe est requis.";
    else if (body.password && bcrypt.truncates(body.password))
      errors.password = "Le mot de passe dépasse la limite de 72 octets.";
  }
  for (const key of ["permissionAllow", "permissionDeny"])
    if (
      key in body &&
      (!Array.isArray(body[key]) ||
        body[key].some((value) => !Object.values(Permission).includes(value)))
    )
      errors[key] = "Liste de droits invalide.";
  if (Object.keys(errors).length)
    throw managementError("Corrigez les champs indiqués.", 400, errors);
}
async function countryFor(req, nextRole, requestedCode, previousId) {
  if (nextRole === "SUPER_ADMIN") return null;
  if (req.user.role !== "SUPER_ADMIN") {
    if (!req.user.countryId)
      throw managementError("Votre compte doit être rattaché à un pays.", 403);
    if (requestedCode) {
      const country = await prisma.country.findUnique({
        where: { code: String(requestedCode).trim().toUpperCase() },
      });
      if (!country || country.id !== req.user.countryId)
        throw managementError(
          "Vous ne pouvez pas attribuer un autre pays.",
          403,
        );
    }
    return req.user.countryId;
  }
  if (requestedCode === undefined && previousId) return previousId;
  if (typeof requestedCode !== "string" || !requestedCode.trim())
    throw managementError("Un pays est requis pour ce rôle.", 400, {
      countryCode: "Sélectionnez un pays.",
    });
  const country = await prisma.country.findUnique({
    where: { code: requestedCode.trim().toUpperCase() },
  });
  if (!country)
    throw managementError("Pays introuvable.", 400, {
      countryCode: "Sélectionnez un pays valide.",
    });
  return country.id;
}
function pageNumber(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  if (
    !/^\d+$/.test(String(raw)) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) < 1
  )
    throw managementError("Pagination invalide.");
  return Number(raw);
}
async function listUsers(req, res) {
  try {
    const page = pageNumber(req.query.page, 1),
      pageSize = Math.min(
        100,
        Math.max(10, pageNumber(req.query.pageSize, 20)),
      ),
      where = {};
    const q = String(req.query.q || "")
      .trim()
      .slice(0, 150);
    if (q)
      where.OR = [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    if (req.query.role) {
      const role = String(req.query.role).toUpperCase();
      if (!Object.values(AdminRole).includes(role))
        throw managementError("Filtre de rôle invalide.");
      where.role = role;
    }
    if (req.query.actif !== undefined) {
      if (![true, false, "true", "false"].includes(req.query.actif))
        throw managementError("Filtre de statut invalide.");
      where.actif = req.query.actif === true || req.query.actif === "true";
    }
    if (req.user.role !== "SUPER_ADMIN") {
      if (!req.country?.id || req.country.id !== req.user.countryId)
        throw managementError("Pays non autorisé.", 403);
      where.countryId = req.user.countryId;
    }
    if (req.query.countryCode) {
      const country = await prisma.country.findUnique({
        where: { code: String(req.query.countryCode).toUpperCase() },
        select: { id: true },
      });
      if (!country) throw managementError("Pays introuvable.", 400);
      if (where.countryId && where.countryId !== country.id)
        throw managementError("Pays non autorisé.", 403);
      where.countryId = country.id;
    }
    const [totalCount, rows] = await Promise.all([
      prisma.adminUser.count({ where }),
      prisma.adminUser.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: includeCountry,
      }),
    ]);
    return res.json({
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      manageableRoles: manageableRoles(req.user.role),
      data: rows.map((user) => sanitizeUser(user, req.user)),
    });
  } catch (error) {
    return respondError(res, error, "Impossible de charger les utilisateurs.");
  }
}
async function getUserById(req, res) {
  try {
    const user = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
      include: includeCountry,
    });
    if (!user) throw managementError("Utilisateur introuvable.", 404);
    assertReadScope(req, user);
    return res.json(sanitizeUser(user, req.user));
  } catch (error) {
    return respondError(res, error, "Impossible de charger ce compte.");
  }
}
async function createUser(req, res) {
  try {
    const body = req.body || {};
    validateFields(body, true);
    validateAdminPassword(body.password);
    if (!canManageRole(req.user.role, body.role.trim().toUpperCase()))
      throw managementError("Vous ne pouvez pas attribuer ce rôle.", 403);
    if (
      req.user.role !== "SUPER_ADMIN" &&
      ("permissionAllow" in body || "permissionDeny" in body)
    )
      throw managementError(
        "Seul le Super Admin peut modifier les droits spécifiques.",
        403,
      );
    const data = {
      email: body.email.trim().toLowerCase(),
      fullName: body.fullName.trim(),
      role: body.role.trim().toUpperCase(),
      actif: body.actif ?? true,
      countryId: await countryFor(
        req,
        body.role.trim().toUpperCase(),
        body.countryCode,
      ),
      password: await bcrypt.hash(body.password, 10),
      passwordChangedAt: new Date(),
      permissionAllow: normalizePermissionList(body.permissionAllow),
      permissionDeny: normalizePermissionList(body.permissionDeny),
    };
    const created = await saveManagedUser(prisma, req, {
      data,
      note: "Création du compte administrateur.",
    });
    return res.status(201).json(sanitizeUser(created, req.user));
  } catch (error) {
    return respondError(res, error, "Impossible de créer le compte.");
  }
}
async function updateUser(req, res) {
  try {
    const body = req.body || {};
    validateFields(body);
    const existing = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw managementError("Utilisateur introuvable.", 404);
    assertReadScope(req, existing);
    if (!canManageRole(req.user.role, existing.role))
      throw managementError("Vous n’êtes pas autorisé à gérer ce rôle.", 403);
    if (
      req.user.role !== "SUPER_ADMIN" &&
      ("permissionAllow" in body || "permissionDeny" in body)
    )
      throw managementError(
        "Seul le Super Admin peut modifier les droits spécifiques.",
        403,
      );
    const data = {};
    for (const key of ["email", "fullName", "role"])
      if (key in body)
        data[key] =
          key === "email"
            ? body[key].trim().toLowerCase()
            : key === "role"
              ? body[key].trim().toUpperCase()
              : body[key].trim();
    if ("actif" in body) data.actif = body.actif;
    for (const key of ["permissionAllow", "permissionDeny"])
      if (key in body) data[key] = normalizePermissionList(body[key]);
    if ("countryCode" in body || "role" in body)
      data.countryId = await countryFor(
        req,
        data.role || existing.role,
        body.countryCode,
        existing.countryId,
      );
    if (body.password) {
      validateAdminPassword(body.password);
      data.password = await bcrypt.hash(body.password, 10);
      data.passwordChangedAt = new Date();
      data.failedLoginCount = 0;
      data.lockedUntil = null;
    }
    const updated = await saveManagedUser(prisma, req, {
      id: existing.id,
      data,
      expectedUpdatedAt: body.expectedUpdatedAt,
      initialUpdatedAt: existing.updatedAt,
      note: body.password
        ? "Réinitialisation du mot de passe."
        : "Modification du compte administrateur.",
    });
    return res.json(sanitizeUser(updated, req.user));
  } catch (error) {
    return respondError(res, error, "Impossible de modifier le compte.");
  }
}
async function updateUserStatus(req, res) {
  try {
    const body = req.body || {};
    if (typeof body.actif !== "boolean")
      throw managementError("Statut invalide.", 400, {
        actif: "Utilisez activé ou désactivé.",
      });
    const existing = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw managementError("Utilisateur introuvable.", 404);
    assertReadScope(req, existing);
    const updated = await saveManagedUser(prisma, req, {
      id: existing.id,
      data: { actif: body.actif },
      expectedUpdatedAt: body.expectedUpdatedAt,
      initialUpdatedAt: existing.updatedAt,
      action: body.actif ? "ADMIN_USER_ACTIVATED" : "ADMIN_USER_DEACTIVATED",
      note: body.actif
        ? "Réactivation du compte."
        : "Désactivation du compte et révocation des sessions.",
    });
    return res.json(sanitizeUser(updated, req.user));
  } catch (error) {
    return respondError(res, error, "Impossible de modifier le statut.");
  }
}
async function revokeUserSessions(req, res) {
  try {
    const existing = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw managementError("Utilisateur introuvable.", 404);
    assertReadScope(req, existing);
    const updated = await saveManagedUser(prisma, req, {
      id: existing.id,
      data: {},
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
      initialUpdatedAt: existing.updatedAt,
      forceRevoke: true,
      action: "ADMIN_USER_SESSIONS_REVOKED",
      note: "Déconnexion des sessions du compte.",
    });
    return res.json(sanitizeUser(updated, req.user));
  } catch (error) {
    return respondError(res, error, "Impossible de révoquer les sessions.");
  }
}
async function getUserHistory(req, res) {
  try {
    const user = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
    });
    if (!user) throw managementError("Utilisateur introuvable.", 404);
    assertReadScope(req, user);
    const rows = await prisma.adminUserAuditLog.findMany({
      where: { targetAdminId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
      select: {
        id: true,
        action: true,
        note: true,
        createdAt: true,
        meta: true,
        actorAdmin: { select: { fullName: true, email: true } },
      },
    });
    return res.json({
      data: rows.map((row) => ({
        id: row.id,
        action: row.action,
        note: row.note,
        createdAt: row.createdAt,
        actorLabel:
          row.actorAdmin?.fullName || row.actorAdmin?.email || "Système",
        changes: Object.fromEntries(
          Object.entries(row.meta?.changes || {}).filter(([key]) =>
            AUDIT_FIELDS.includes(key),
          ),
        ),
        passwordChanged: Boolean(row.meta?.passwordChanged),
        sessionsRevoked: Boolean(row.meta?.sessionsRevoked),
      })),
    });
  } catch (error) {
    return respondError(res, error, "Impossible de charger l’historique.");
  }
}
module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  getUserHistory,
  revokeUserSessions,
};
