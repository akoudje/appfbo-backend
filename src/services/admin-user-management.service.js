const {
  AdminRole,
  Permission,
  getEffectivePermissions,
} = require("../auth/permissions");
const { createAdminAuditLog } = require("./admin-security.service");
const ROLE_ASSIGNMENT_MATRIX = {
  SUPER_ADMIN: new Set(Object.values(AdminRole)),
  TECH_ADMIN: new Set(
    Object.values(AdminRole).filter((role) => role !== "SUPER_ADMIN"),
  ),
  OPERATIONS_DIRECTOR: new Set([
    "FINANCE_MANAGER",
    "BILLING_MANAGER",
    "COUNTER_MANAGER",
    "STOCK_MANAGER",
    "MARKETING_MANAGER",
    "MARKETING_ASSISTANT",
    "INVOICER",
    "CAISSIERE",
    "ORDER_PREPARER",
  ]),
};
const AUDIT_FIELDS = [
  "email",
  "fullName",
  "role",
  "actif",
  "countryId",
  "permissionAllow",
  "permissionDeny",
];
function managementError(message, statusCode = 400, errors) {
  return Object.assign(new Error(message), { statusCode, errors });
}
function manageableRoles(role) {
  return [...(ROLE_ASSIGNMENT_MATRIX[role] || [])];
}
function canManageRole(actorRole, targetRole) {
  return ROLE_ASSIGNMENT_MATRIX[actorRole]?.has(targetRole) || false;
}
function assertTargetManageable(actor, target) {
  if (!canManageRole(actor.role, target.role))
    throw managementError("Vous n’êtes pas autorisé à gérer ce rôle.", 403);
  if (
    actor.role !== "SUPER_ADMIN" &&
    (!actor.countryId || target.countryId !== actor.countryId)
  )
    throw managementError(
      "Vous ne pouvez gérer que les comptes de votre pays.",
      403,
    );
}
function usableSuper(user) {
  return (
    user.role === "SUPER_ADMIN" &&
    user.actif &&
    getEffectivePermissions(
      user.role,
      user.permissionAllow,
      user.permissionDeny,
    ).includes(Permission.USER_ADMIN)
  );
}
function auditChanges(before, after) {
  return Object.fromEntries(
    AUDIT_FIELDS.filter(
      (key) =>
        JSON.stringify(before?.[key] ?? null) !==
        JSON.stringify(after?.[key] ?? null),
    ).map((key) => [
      key,
      { before: before?.[key] ?? null, after: after?.[key] ?? null },
    ]),
  );
}
async function assertSuperAdminSurvives(tx, existing, next) {
  if (existing && usableSuper(existing) && !usableSuper(next)) {
    const others = await tx.adminUser.findMany({
      where: { role: "SUPER_ADMIN", actif: true, id: { not: existing.id } },
      select: {
        role: true,
        actif: true,
        permissionAllow: true,
        permissionDeny: true,
      },
    });
    if (!others.some(usableSuper))
      throw managementError(
        "Conservez au moins un Super Admin actif disposant de la gestion des utilisateurs.",
        409,
      );
  }
}
async function saveManagedUser(
  prisma,
  req,
  {
    id,
    data,
    expectedUpdatedAt,
    initialUpdatedAt,
    action = "ADMIN_USER_UPDATED",
    note = "Modification du compte administrateur.",
    forceRevoke = false,
  },
) {
  if (!req.user?.id)
    throw managementError("Connexion administrateur requise.", 401);
  if (
    expectedUpdatedAt !== undefined &&
    (typeof expectedUpdatedAt !== "string" ||
      !Number.isFinite(new Date(expectedUpdatedAt).getTime()))
  )
    throw managementError("Version du compte invalide.", 400);
  let revokedUserId = null;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const actor = await tx.adminUser.findUnique({
          where: { id: req.user.id },
        });
        if (
          !actor?.actif ||
          (actor.sessionVersion ?? 0) !== (req.user.tokenSessionVersion ?? 0)
        )
          throw managementError(
            "Votre session a été révoquée. Reconnectez-vous.",
            401,
          );
        if (
          !getEffectivePermissions(
            actor.role,
            actor.permissionAllow,
            actor.permissionDeny,
          ).includes(Permission.USER_ADMIN)
        )
          throw managementError("Gestion des utilisateurs non autorisée.", 403);
        const existing = id
          ? await tx.adminUser.findUnique({
              where: { id },
              include: { country: { select: { code: true, name: true } } },
            })
          : null;
        if (id && !existing)
          throw managementError("Utilisateur introuvable.", 404);
        if (existing) assertTargetManageable(actor, existing);
        const next = { ...(existing || {}), ...data };
        assertTargetManageable(actor, next);
        const expected = expectedUpdatedAt ?? initialUpdatedAt;
        if (
          existing &&
          expected &&
          existing.updatedAt.getTime() !== new Date(expected).getTime()
        )
          throw managementError(
            "Ce compte a été modifié depuis son ouverture. Rechargez sa fiche avant d’enregistrer.",
            409,
          );
        if (existing?.id === actor.id) {
          if (next.role !== existing.role)
            throw managementError(
              "Vous ne pouvez pas modifier votre propre rôle.",
            );
          if (next.countryId !== existing.countryId)
            throw managementError(
              "Vous ne pouvez pas modifier votre propre pays.",
            );
          if (!next.actif)
            throw managementError(
              "Vous ne pouvez pas désactiver votre propre compte.",
            );
          const permissions = getEffectivePermissions(
            next.role,
            next.permissionAllow,
            next.permissionDeny,
          );
          if (!permissions.includes(Permission.USER_ADMIN))
            throw managementError(
              "Vous ne pouvez pas retirer votre propre accès à la gestion des utilisateurs.",
            );
        }
        await assertSuperAdminSurvives(tx, existing, next);
        const changes = auditChanges(existing, next);
        const passwordChanged = Boolean(data.password);
        const securityChanged =
          forceRevoke ||
          passwordChanged ||
          [
            "email",
            "role",
            "countryId",
            "actif",
            "permissionAllow",
            "permissionDeny",
          ].some((key) => key in changes);
        if (
          existing &&
          !Object.keys(changes).length &&
          !passwordChanged &&
          !forceRevoke
        )
          return existing;
        const write = { ...data };
        if (existing) {
          write.updatedAt = new Date(
            Math.max(Date.now(), existing.updatedAt.getTime() + 1),
          );
          if (securityChanged) write.sessionVersion = { increment: 1 };
        }
        const include = { country: { select: { code: true, name: true } } };
        let updated;
        if (existing) {
          const result = await tx.adminUser.updateMany({
            where: { id: existing.id, updatedAt: existing.updatedAt },
            data: write,
          });
          if (result.count !== 1)
            throw managementError(
              "Le compte a changé. Rechargez sa fiche.",
              409,
            );
          updated = await tx.adminUser.findUnique({
            where: { id: existing.id },
            include,
          });
        } else updated = await tx.adminUser.create({ data: write, include });
        await createAdminAuditLog(tx, {
          actorAdminId: actor.id,
          targetAdminId: updated.id,
          action: !existing
            ? "ADMIN_USER_CREATED"
            : passwordChanged
              ? "ADMIN_USER_UPDATED_PASSWORD"
              : action,
          note,
          meta: {
            changes,
            passwordChanged,
            sessionsRevoked: Boolean(existing && securityChanged),
          },
        });
        if (existing && securityChanged) revokedUserId = updated.id;
        return updated;
      },
      { isolationLevel: "Serializable" },
    );
    if (revokedUserId)
      require("./realtime-events.service").disconnectRealtimeUser(
        revokedUserId,
      );
    return result;
  } catch (error) {
    if (error.code === "P2034")
      throw managementError(
        "Une autre modification est en cours. Rechargez le compte avant de réessayer.",
        409,
      );
    if (error.code === "P2002")
      throw managementError("Cet email est déjà utilisé.", 409, {
        email: "Cet email est déjà utilisé.",
      });
    throw error;
  }
}
module.exports = {
  ROLE_ASSIGNMENT_MATRIX,
  AUDIT_FIELDS,
  managementError,
  manageableRoles,
  canManageRole,
  assertTargetManageable,
  assertSuperAdminSurvives,
  saveManagedUser,
};
