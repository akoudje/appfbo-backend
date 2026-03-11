// src/controllers/users.controller.js

const bcrypt = require("bcryptjs");
const prisma = require("../prisma");

const SALT_ROUNDS = 10;

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
    updatedAt: user.updatedAt,
  };
}

/**
 * GET /api/admin/users?q=&role=&actif=&countryCode=&page=&pageSize=
 */
async function listUsers(req, res) {
  try {
    const {
      q,
      role,
      actif,
      countryCode,
    } = req.query;

    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const pageSize = Math.min(
      100,
      Math.max(10, parseIntSafe(req.query.pageSize, 20))
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
    } else if (req.countryId) {
      // comportement par défaut cohérent avec ton scope pays
      where.countryId = req.countryId;
    }

    const [totalCount, users] = await Promise.all([
      prisma.adminUser.count({ where }),
      prisma.adminUser.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
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
    const normalizedRole = String(role || "").trim().toUpperCase();

    if (!normalizedEmail) {
      return res.status(400).json({ message: "email requis" });
    }

    if (!normalizedPassword) {
      return res.status(400).json({ message: "password requis" });
    }

    if (normalizedPassword.length < 6) {
      return res.status(400).json({
        message: "Le mot de passe doit contenir au moins 6 caractères",
      });
    }

    if (!normalizedRole) {
      return res.status(400).json({ message: "role requis" });
    }

    let resolvedCountryId = req.countryId || null;

    if (countryCode && String(countryCode).trim()) {
      const country = await resolveCountryIdFromCode(countryCode);
      if (!country) {
        return res.status(404).json({ message: "Pays introuvable" });
      }
      resolvedCountryId = country.id;
    }

    const hashedPassword = await bcrypt.hash(normalizedPassword, SALT_ROUNDS);

    const created = await prisma.adminUser.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        fullName: normalizedFullName,
        role: normalizedRole,
        actif: Boolean(actif),
        countryId: resolvedCountryId,
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

    return res.status(201).json(sanitizeUser(created));
  } catch (e) {
    console.error("createUser error:", e);

    if (String(e?.code) === "P2002") {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    return res.status(500).json({ message: "Erreur serveur (createUser)" });
  }
}

/**
 * PUT /api/admin/users/:id
 */
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const {
      email,
      password,
      fullName,
      role,
      actif,
      countryCode,
    } = req.body || {};

    const existing = await prisma.adminUser.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    const data = {};

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
      const normalizedRole = String(role || "").trim().toUpperCase();
      if (!normalizedRole) {
        return res.status(400).json({ message: "role invalide" });
      }
      data.role = normalizedRole;
    }

    if (actif !== undefined) {
      data.actif = Boolean(actif);
    }

    if (password !== undefined && String(password).trim()) {
      const normalizedPassword = String(password);
      if (normalizedPassword.length < 6) {
        return res.status(400).json({
          message: "Le mot de passe doit contenir au moins 6 caractères",
        });
      }
      data.password = await bcrypt.hash(normalizedPassword, SALT_ROUNDS);
    }

    if (countryCode !== undefined) {
      if (!countryCode) {
        data.countryId = null;
      } else {
        const country = await resolveCountryIdFromCode(countryCode);
        if (!country) {
          return res.status(404).json({ message: "Pays introuvable" });
        }
        data.countryId = country.id;
      }
    }

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

    return res.json(sanitizeUser(updated));
  } catch (e) {
    console.error("updateUser error:", e);

    if (String(e?.code) === "P2002") {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    return res.status(500).json({ message: "Erreur serveur (updateUser)" });
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
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

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

    return res.json(sanitizeUser(updated));
  } catch (e) {
    console.error("updateUserStatus error:", e);
    return res.status(500).json({ message: "Erreur serveur (updateUserStatus)" });
  }
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
};