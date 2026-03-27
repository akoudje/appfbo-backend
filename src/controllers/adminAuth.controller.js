// src/controllers/adminAuth.controller.js (CommonJS)
// Controller pour l'authentification des admins, avec les fonctions de login, récupération du profil courant, et seed d'un super admin. Utilise bcrypt pour le hash des mots de passe et JWT pour la génération de tokens d'authentification. Les fonctions sont exportées pour être utilisées dans les routes correspondantes.

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const { getRolePermissions } = require("../auth/permissions");
const {
  validateAdminPassword,
  buildWeakPasswordMessage,
  computeLoginLockInfo,
  createAdminAuditLog,
} = require("../services/admin-security.service");

function signAdminToken(admin) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing");

  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";

  return jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      countryId: admin.countryId || null,
    },
    secret,
    { expiresIn }
  );
}

function sanitizeAdmin(admin) {
  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName || null,
    role: admin.role,
    permissions: getRolePermissions(admin.role),
    actif: admin.actif,
    countryId: admin.countryId || null,
    lastLoginAt: admin.lastLoginAt || null,
    passwordChangedAt: admin.passwordChangedAt || null,
    lockedUntil: admin.lockedUntil || null,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

/**
 * POST /api/admin/auth/login
 * body: { email, password }
 * return: { token, user }
 */
async function adminLogin(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: "email et password requis" });
    }

    const admin = await prisma.adminUser.findUnique({
      where: { email: String(email).trim().toLowerCase() },
    });

    if (!admin || !admin.actif) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    if (admin.lockedUntil && new Date(admin.lockedUntil).getTime() > Date.now()) {
      return res.status(423).json({
        message: "Compte temporairement verrouillé. Réessayez plus tard.",
      });
    }

    const ok = await bcrypt.compare(String(password), admin.password);
    if (!ok) {
      const lockInfo = computeLoginLockInfo(admin.failedLoginCount);
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          failedLoginCount: lockInfo.nextCount,
          lockedUntil: lockInfo.lockedUntil,
        },
      });
      await createAdminAuditLog(prisma, {
        targetAdminId: admin.id,
        action: "LOGIN_FAILED",
        note: lockInfo.shouldLock
          ? "Échec de connexion - compte verrouillé temporairement."
          : "Échec de connexion.",
        meta: {
          failedLoginCount: lockInfo.nextCount,
          lockedUntil: lockInfo.lockedUntil,
        },
      });
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const updatedAdmin = await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await createAdminAuditLog(prisma, {
      actorAdminId: updatedAdmin.id,
      targetAdminId: updatedAdmin.id,
      action: "LOGIN_SUCCESS",
      note: "Connexion administrateur réussie.",
    });

    const token = signAdminToken(updatedAdmin);
    return res.json({ token, user: sanitizeAdmin(updatedAdmin) });
  } catch (e) {
    console.error("adminLogin error:", e);
    return res.status(500).json({ message: "Erreur serveur (adminLogin)" });
  }
}

/**
 * GET /api/admin/auth/me
 * header: Authorization: Bearer <token>
 */
async function adminMe(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });

    const admin = await prisma.adminUser.findUnique({
      where: { id: req.user.id },
    });

    if (!admin || !admin.actif) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    return res.json({ user: sanitizeAdmin(admin) });
  } catch (e) {
    console.error("adminMe error:", e);
    return res.status(500).json({ message: "Erreur serveur (adminMe)" });
  }
}

/**
 * POST /api/admin/auth/seed-super-admin
 * ⚠️ à utiliser UNIQUEMENT 1 fois puis désactiver la route
 * body: { email, password, fullName }
 * - crée SUPER_ADMIN si aucun admin n’existe encore
 */
async function seedSuperAdmin(req, res) {
  try {
    const count = await prisma.adminUser.count();
    if (count > 0) {
      return res.status(403).json({ message: "Seed interdit: un admin existe déjà" });
    }

    const { email, password, fullName } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: "email et password requis" });
    }

    try {
      validateAdminPassword(password);
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        message: buildWeakPasswordMessage(),
      });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const admin = await prisma.adminUser.create({
      data: {
        email: String(email).trim().toLowerCase(),
        password: hash,
        fullName: fullName ? String(fullName).trim() : "Super Admin",
        role: "SUPER_ADMIN",
        actif: true,
        countryId: null,
        passwordChangedAt: new Date(),
      },
    });

    const token = signAdminToken(admin);

    return res.status(201).json({
      message: "SUPER_ADMIN créé",
      token,
      user: sanitizeAdmin(admin),
    });
  } catch (e) {
    console.error("seedSuperAdmin error:", e);
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }
    return res.status(500).json({ message: "Erreur serveur (seedSuperAdmin)" });
  }
}

module.exports = { adminLogin, adminMe, seedSuperAdmin };
