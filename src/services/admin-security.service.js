const MIN_PASSWORD_LENGTH = 12;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

function validateAdminPassword(password) {
  const value = String(password || "");
  const checks = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ];
  const passedChecks = checks.filter(Boolean).length;

  if (value.length < MIN_PASSWORD_LENGTH || passedChecks < 3) {
    const err = new Error("WEAK_PASSWORD");
    err.statusCode = 400;
    throw err;
  }
}

function buildWeakPasswordMessage() {
  return "Le mot de passe doit contenir au moins 12 caractères et au moins 3 types parmi majuscule, minuscule, chiffre et caractère spécial.";
}

function computeLoginLockInfo(failedLoginCount) {
  const nextCount = Number(failedLoginCount || 0) + 1;
  const shouldLock = nextCount >= MAX_FAILED_LOGIN_ATTEMPTS;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
    : null;

  return {
    nextCount,
    shouldLock,
    lockedUntil,
  };
}

async function createAdminAuditLog(prismaLike, {
  actorAdminId = null,
  targetAdminId = null,
  action,
  note = null,
  meta = null,
}) {
  if (!action) return null;

  return prismaLike.adminUserAuditLog.create({
    data: {
      actorAdminId,
      targetAdminId,
      action,
      note,
      meta,
    },
  });
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCK_DURATION_MINUTES,
  validateAdminPassword,
  buildWeakPasswordMessage,
  computeLoginLockInfo,
  createAdminAuditLog,
};
