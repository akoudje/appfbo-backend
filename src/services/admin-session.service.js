const { getEffectivePermissions } = require("../auth/permissions");
function sessionError() {
  const error = new Error(
    "Votre session a expiré ou a été révoquée. Reconnectez-vous.",
  );
  error.statusCode = 401;
  return error;
}
async function resolveAdminSession(prisma, user) {
  if (!user?.id) throw sessionError();
  const admin = await prisma.adminUser.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      role: true,
      countryId: true,
      actif: true,
      sessionVersion: true,
      passwordChangedAt: true,
      permissionAllow: true,
      permissionDeny: true,
    },
  });
  const tokenVersion = user.tokenSessionVersion ?? 0;
  if (
    !admin ||
    !admin.actif ||
    !Number.isInteger(tokenVersion) ||
    tokenVersion < 0 ||
    tokenVersion !== (admin.sessionVersion ?? 0)
  )
    throw sessionError();
  if (
    user.tokenSessionVersion === undefined &&
    admin.passwordChangedAt &&
    Number.isFinite(user.tokenIssuedAt) &&
    Math.floor(admin.passwordChangedAt.getTime() / 1000) > user.tokenIssuedAt
  )
    throw sessionError();
  return {
    ...user,
    id: admin.id,
    email: admin.email,
    role: admin.role,
    countryId: admin.countryId || null,
    permissions: getEffectivePermissions(
      admin.role,
      admin.permissionAllow,
      admin.permissionDeny,
    ),
    sessionChecked: true,
  };
}
module.exports = { resolveAdminSession, sessionError };
