const {
  computeLoginLockInfo,
  createAdminAuditLog,
} = require("./admin-security.service");
async function completeAdminLogin(prisma, snapshot, passwordCorrect) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const admin = await tx.adminUser.findUnique({
            where: { id: snapshot.id },
          });
          const now = new Date();
          if (
            !admin?.actif ||
            admin.password !== snapshot.password ||
            (admin.sessionVersion ?? 0) !== (snapshot.sessionVersion ?? 0)
          )
            return { status: "INVALID" };
          if (admin.lockedUntil && admin.lockedUntil > now)
            return { status: "LOCKED" };
          if (!passwordCorrect) {
            const count =
              admin.lockedUntil && admin.lockedUntil <= now
                ? 0
                : admin.failedLoginCount;
            const info = computeLoginLockInfo(count);
            await tx.adminUser.update({
              where: { id: admin.id },
              data: {
                failedLoginCount: info.nextCount,
                lockedUntil: info.lockedUntil,
              },
            });
            await createAdminAuditLog(tx, {
              targetAdminId: admin.id,
              action: "LOGIN_FAILED",
              note: info.shouldLock
                ? "Échec de connexion — compte temporairement verrouillé."
                : "Échec de connexion.",
              meta: {
                failedLoginCount: info.nextCount,
                lockedUntil: info.lockedUntil?.toISOString() || null,
              },
            });
            return { status: "INVALID" };
          }
          const updated = await tx.adminUser.update({
            where: { id: admin.id },
            data: { lastLoginAt: now, failedLoginCount: 0, lockedUntil: null },
            include: { country: { select: { code: true, name: true } } },
          });
          await createAdminAuditLog(tx, {
            actorAdminId: admin.id,
            targetAdminId: admin.id,
            action: "LOGIN_SUCCESS",
            note: "Connexion administrateur réussie.",
          });
          return { status: "SUCCESS", user: updated };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}
module.exports = { completeAdminLogin };
