// orderSimulation.controller.js
// Simulation de commande publique (visiteur avec un numéro FBO). Rien n'est
// enregistré : ni commande, ni brouillon, ni réservation de stock.

const { digitsOnly, isFboDirectoryTemporarilyUnavailable } = require("../services/fboDirectory.service");
const { lookupFboGradeForCountry, enforceFboCheckRateLimit } = require("./preorders.controller");
const simulation = require("../services/order-simulation.service");
const { getSponsorshipSettings } = require("../services/sponsorship.service");

function sendError(res, error, fallback) {
  const status = Number(error?.statusCode || 0) || 500;
  if (status >= 500) console.error(`[simulation] ${fallback}`, { message: error?.message || String(error) });
  return res.status(status).json({
    error: status >= 500 && !error?.code ? fallback : error.message,
    code: error?.code || null,
  });
}

// Futur filleul sans numéro : prix Client privilégié (déjà publics sur la
// page Parrainage), seulement si le parrainage est ouvert dans le pays.
async function startFutureRecruitSimulation(req, res) {
  const settings = await getSponsorshipSettings(req.country.id);
  if (!settings.enabled) {
    return res.status(403).json({ error: "Le parrainage n'est pas ouvert dans ce pays.", code: "SPONSORSHIP_DISABLED" });
  }
  const grade = simulation.RECRUIT_GRADE;
  const context = await simulation.loadGradeCatalog({ countryId: req.country.id, countryCode: req.country.code, grade });
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    grade,
    futureRecruit: true,
    sponsorship: { minPurchaseFcfa: settings.minPurchaseFcfa },
    token: simulation.createSimulationToken({ countryId: req.country.id, grade, futureRecruit: true }),
    countryCode: req.country.code,
    items: simulation.toSimulationCatalog(context.catalog),
  });
}

// POST /api/simulation/session { numeroFbo } | { futureRecruit: true }
// → grade, jeton de simulation et catalogue aux prix du grade.
async function startSimulation(req, res) {
  try {
    if (req.body?.futureRecruit === true) return await startFutureRecruitSimulation(req, res);
    const numero = String(req.body?.numeroFbo || "").trim();
    if (digitsOnly(numero).length !== 12) {
      return res.status(400).json({ error: "Numéro FBO invalide (12 chiffres).", code: "FBO_INVALID" });
    }
    // Même quota que la vérification FBO du parcours de commande.
    if (!enforceFboCheckRateLimit(req)) {
      return res.status(429).json({ error: "Trop de vérifications FBO. Réessayez plus tard.", code: "FBO_RATE_LIMITED" });
    }

    let grade;
    try {
      grade = await lookupFboGradeForCountry(numero, req.country.id);
    } catch (error) {
      if (isFboDirectoryTemporarilyUnavailable(error)) {
        return res.status(503).json({ error: "Vérification FBO momentanément indisponible. Réessayez dans quelques minutes.", code: "FBO_DIRECTORY_UNAVAILABLE" });
      }
      throw error;
    }
    if (!grade) {
      return res.status(404).json({ error: "Numéro FBO introuvable.", code: "FBO_NOT_FOUND" });
    }

    const context = await simulation.loadGradeCatalog({ countryId: req.country.id, countryCode: req.country.code, grade });
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      grade,
      token: simulation.createSimulationToken({ countryId: req.country.id, grade }),
      countryCode: req.country.code,
      items: simulation.toSimulationCatalog(context.catalog),
    });
  } catch (error) {
    return sendError(res, error, "Simulation indisponible.");
  }
}

// POST /api/simulation/quote { token, items: [{ productId, qty }] }
// → lignes et total à prévoir (même calcul que la commande).
async function quoteSimulation(req, res) {
  try {
    const result = await simulation.quoteSimulation({
      token: req.body?.token,
      items: req.body?.items,
      country: req.country,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) {
    return sendError(res, error, "Calcul de la simulation impossible.");
  }
}

module.exports = { startSimulation, quoteSimulation };
