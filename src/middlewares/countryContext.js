const prisma = require("../prisma");

const FALLBACK_COUNTRY_CODE = String(process.env.DEFAULT_COUNTRY_CODE || "CIV")
  .trim()
  .toUpperCase();

async function countryContext(req, res, next) {
  try {
    const headerCode = req.header("X-Country");
    const countryCode = String(headerCode || FALLBACK_COUNTRY_CODE)
      .trim()
      .toUpperCase();

    if (!countryCode) {
      return res.status(400).json({
        message: "Code pays manquant (header X-Country)",
      });
    }

    const country = await prisma.country.findUnique({
      where: { code: countryCode },
    });

    if (!country || !country.actif) {
      return res.status(400).json({
        message: `Pays invalide ou inactif: ${countryCode}`,
      });
    }

    req.country = country;
    req.countryId = country.id;

    return next();
  } catch (error) {
    console.error("countryContext error:", error);
    return res.status(500).json({ message: "Erreur serveur (countryContext)" });
  }
}

module.exports = countryContext;
