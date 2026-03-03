// src/controllers/adminAuth.controller.js (CommonJS)

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");

/**
 * POST /api/admin/auth/login
 * body: { email, password }
 */
async function adminLogin(req, res) {
  try {
    const { email, password } = req.body || {};
    const em = (email || "").toString().trim().toLowerCase();
    const pw = (password || "").toString();

    if (!em || !pw) {
      return res.status(400).json({ message: "email et password requis" });
    }

    const user = await prisma.adminUser.findUnique({
      where: { email: em },
      select: {
        id: true,
        email: true,
        password: true,
        fullName: true,
        role: true,
        actif: true,
        countryId: true,
      },
    });

    if (!user || !user.actif) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const ok = await bcrypt.compare(pw, user.password);
    if (!ok) return res.status(401).json({ message: "Identifiants invalides" });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("JWT_SECRET missing");
      return res.status(500).json({ message: "Server misconfiguration (JWT)" });
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || "8h";

    // IMPORTANT: sub = adminUser.id (source de vérité)
    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        countryId: user.countryId || null,
      },
      secret,
      { expiresIn }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        countryId: user.countryId || null,
      },
    });
  } catch (e) {
    console.error("adminLogin error:", e);
    return res.status(500).json({ message: "Erreur serveur (adminLogin)" });
  }
}

/**
 * POST /api/admin/auth/seed-super-admin
 * ⚠️ OPTIONNEL (à utiliser 1 fois) : crée un SUPER_ADMIN s'il n'en existe aucun.
 * body: { email, password, fullName? }
 * Recommandation: protéger via une variable env SEED_ADMIN_TOKEN
 */
async function seedSuperAdmin(req, res) {
  try {
    const guard = process.env.SEED_ADMIN_TOKEN;
    if (guard) {
      const provided = String(req.header("X-Seed-Token") || "").trim();
      if (!provided || provided !== guard) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const existing = await prisma.adminUser.findFirst({
      where: { role: "SUPER_ADMIN" },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ message: "SUPER_ADMIN déjà existant" });
    }

    const { email, password, fullName } = req.body || {};
    const em = (email || "").toString().trim().toLowerCase();
    const pw = (password || "").toString();

    if (!em || !pw) {
      return res.status(400).json({ message: "email et password requis" });
    }

    const hash = await bcrypt.hash(pw, 12);

    const created = await prisma.adminUser.create({
      data: {
        email: em,
        password: hash,
        fullName: fullName ? String(fullName).trim() : null,
        role: "SUPER_ADMIN",
        countryId: null,
        actif: true,
      },
      select: { id: true, email: true, fullName: true, role: true, countryId: true },
    });

    return res.status(201).json({ ok: true, user: created });
  } catch (e) {
    console.error("seedSuperAdmin error:", e);
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }
    return res.status(500).json({ message: "Erreur serveur (seedSuperAdmin)" });
  }
}

module.exports = {
  adminLogin,
  seedSuperAdmin,
};