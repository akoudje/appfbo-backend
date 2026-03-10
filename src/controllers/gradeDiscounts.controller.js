// controllers/gradeDiscounts.controller.js
// Contrôleur pour gérer les remises par grade FBO, permettant de définir les pourcentages de remise pour chaque grade dans 
// chaque pays, et de les appliquer lors du calcul des totaux d'une précommande.


const prisma = require("../prisma");

const ALL_GRADES = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];

function parsePercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n.toFixed(2);
}

async function getGradeDiscounts(req, res) {
  try {
    const countryCode = String(
      req.query.countryCode || req.countryCode || ""
    ).trim().toUpperCase();

    if (!countryCode) {
      return res.status(400).json({ message: "countryCode requis" });
    }

    const country = await prisma.country.findUnique({
      where: { code: countryCode },
      select: { id: true, code: true, name: true },
    });

    if (!country) {
      return res.status(404).json({ message: "Pays introuvable" });
    }

    const rows = await prisma.gradeDiscount.findMany({
      where: { countryId: country.id },
      orderBy: { grade: "asc" },
      select: {
        id: true,
        grade: true,
        discountPercent: true,
        updatedAt: true,
      },
    });

    const byGrade = new Map(rows.map((r) => [r.grade, r]));

    const items = ALL_GRADES.map((grade) => ({
      grade,
      discountPercent: byGrade.get(grade)?.discountPercent?.toString?.() ?? "0.00",
      updatedAt: byGrade.get(grade)?.updatedAt ?? null,
    }));

    return res.json({
      country,
      items,
    });
  } catch (e) {
    console.error("getGradeDiscounts error:", e);
    return res.status(500).json({ message: "Erreur serveur (getGradeDiscounts)" });
  }
}

async function upsertGradeDiscounts(req, res) {
  try {
    const countryCode = String(
      req.query.countryCode || req.countryCode || ""
    ).trim().toUpperCase();

    const items = Array.isArray(req.body?.items) ? req.body.items : null;

    if (!countryCode) {
      return res.status(400).json({ message: "countryCode requis" });
    }

    if (!items) {
      return res.status(400).json({ message: "items requis" });
    }

    const country = await prisma.country.findUnique({
      where: { code: countryCode },
      select: { id: true, code: true, name: true },
    });

    if (!country) {
      return res.status(404).json({ message: "Pays introuvable" });
    }

    const normalized = items.map((it) => ({
      grade: String(it?.grade || "").trim().toUpperCase(),
      discountPercent: parsePercent(it?.discountPercent),
    }));

    for (const row of normalized) {
      if (!ALL_GRADES.includes(row.grade)) {
        return res.status(400).json({ message: `Grade invalide: ${row.grade}` });
      }
      if (row.discountPercent === null) {
        return res.status(400).json({
          message: `discountPercent invalide pour ${row.grade}`,
        });
      }
    }

    await prisma.$transaction(
      normalized.map((row) =>
        prisma.gradeDiscount.upsert({
          where: {
            countryId_grade: {
              countryId: country.id,
              grade: row.grade,
            },
          },
          update: {
            discountPercent: row.discountPercent,
          },
          create: {
            countryId: country.id,
            grade: row.grade,
            discountPercent: row.discountPercent,
          },
        })
      )
    );

    const rows = await prisma.gradeDiscount.findMany({
      where: { countryId: country.id },
      orderBy: { grade: "asc" },
      select: {
        grade: true,
        discountPercent: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      country,
      items: rows.map((r) => ({
        grade: r.grade,
        discountPercent: r.discountPercent?.toString?.() ?? "0.00",
        updatedAt: r.updatedAt,
      })),
    });
  } catch (e) {
    console.error("upsertGradeDiscounts error:", e);
    return res.status(500).json({ message: "Erreur serveur (upsertGradeDiscounts)" });
  }
}

module.exports = {
  getGradeDiscounts,
  upsertGradeDiscounts,
};