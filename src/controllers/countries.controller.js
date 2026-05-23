const prisma = require("../prisma");
const { AdminRole } = require("../auth/permissions");

// GET /api/countries — liste publique des pays actifs
async function listActiveCountries(req, res) {
  try {
    const countries = await prisma.country.findMany({
      where: { actif: true },
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json(countries);
  } catch (e) {
    console.error("listActiveCountries error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}

// GET /api/admin/countries — liste complète pour l'admin (actif + inactif)
async function adminListCountries(req, res) {
  try {
    const where =
      req.user?.role === AdminRole.SUPER_ADMIN
        ? {}
        : { id: req.country?.id };

    const countries = await prisma.country.findMany({
      where,
      select: { code: true, name: true, actif: true },
      orderBy: { name: "asc" },
    });
    return res.json(countries);
  } catch (e) {
    console.error("adminListCountries error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}

// PATCH /api/admin/countries/:code — activer / désactiver un pays
async function toggleCountry(req, res) {
  const { code } = req.params;
  const { actif } = req.body;

  if (req.user?.role !== AdminRole.SUPER_ADMIN) {
    return res.status(403).json({
      error: "Seul le super admin peut activer ou désactiver un pays.",
    });
  }

  if (typeof actif !== "boolean") {
    return res.status(400).json({ error: "Le champ 'actif' (boolean) est requis" });
  }

  try {
    const country = await prisma.country.findUnique({ where: { code } });
    if (!country) {
      return res.status(404).json({ error: `Pays inconnu : ${code}` });
    }

    const updated = await prisma.country.update({
      where: { code },
      data: { actif },
      select: { code: true, name: true, actif: true },
    });

    return res.json(updated);
  } catch (e) {
    console.error("toggleCountry error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}

module.exports = { listActiveCountries, adminListCountries, toggleCountry };
