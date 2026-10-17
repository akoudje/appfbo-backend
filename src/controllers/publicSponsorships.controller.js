// src/controllers/publicSponsorships.controller.js
// Parrainage sans connexion, depuis l'accueil : le parrain se fait reconnaître
// par son n° FBO et son nom (annuaire), compose la fiche et l'achat de
// validation. Le suivi se fait ensuite dans l'espace client (connexion par code).

const sponsorship = require("../services/sponsorship.service");
const purchase = require("../services/sponsorship-purchase.service");
const {
  createSubmittedSponsorship,
  lookupPublicSponsor,
  upsertSponsorFbo,
  verifyPublicSponsor,
} = require("../services/sponsorship-submission.service");

function sendError(res, error, fallback) {
  if (!error.statusCode) console.error(fallback, error);
  return res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : "Erreur serveur (parrainage).",
    code: error.code || undefined,
  });
}

// GET /api/sponsorships/config : règles affichées dans le formulaire.
async function getPublicSponsorshipConfig(req, res) {
  try {
    const settings = await sponsorship.getSponsorshipSettings(req.countryId);
    return res.json({
      enabled: settings.enabled,
      minRecruitAge: sponsorship.MIN_RECRUIT_AGE,
      minPurchaseFcfa: settings.minPurchaseFcfa,
      purchaseWindowHours: settings.purchaseWindowHours,
      consentVersion: sponsorship.CONSENT_VERSION,
    });
  } catch (error) {
    return sendError(res, error, "getPublicSponsorshipConfig error:");
  }
}

// POST /api/sponsorships/sponsor { numeroFbo, nomComplet } : le parrain est-il
// reconnu et habilité ? Ne renvoie que ce qu'il a lui-même saisi, normalisé.
async function verifySponsor(req, res) {
  try {
    const profile = await verifyPublicSponsor(req.body || {});
    return res.json({ sponsor: profile });
  } catch (error) {
    return sendError(res, error, "verifySponsor error:");
  }
}

// POST /api/sponsorships/sponsor/lookup { numeroFbo } : le filleul saisit le
// numéro de son parrain ; nom et grade affichés pour confirmation.
async function lookupSponsor(req, res) {
  try {
    return res.json({ sponsor: await lookupPublicSponsor(req.body || {}) });
  } catch (error) {
    return sendError(res, error, "lookupSponsor error:");
  }
}

// GET /api/sponsorships/catalog : produits de l'achat de parrainage (prix Client privilégié).
async function getPublicSponsorshipCatalog(req, res) {
  try {
    const settings = await sponsorship.getSponsorshipSettings(req.countryId);
    const products = await purchase.getRecruitCatalog({ countryId: req.countryId, countryCode: settings.countryCode });
    return res.json({ minPurchaseFcfa: settings.minPurchaseFcfa, grade: purchase.RECRUIT_GRADE, products });
  } catch (error) {
    return sendError(res, error, "getPublicSponsorshipCatalog error:");
  }
}

// GET /api/sponsorships/check-email?email=… : l'email du filleul est-il libre ?
async function checkPublicRecruitEmail(req, res) {
  try {
    const email = String(req.query.email || "").trim();
    if (!email) return res.json({ available: true });
    return res.json({ available: await sponsorship.isRecruitEmailAvailable(email) });
  } catch (error) {
    return sendError(res, error, "checkPublicRecruitEmail error:");
  }
}

// POST /api/sponsorships (multipart : sponsorNumeroFbo, sponsorNomComplet, champs
// de la fiche, panier + idFront, idBack, passport). Le parrain est revérifié ici.
async function submitPublicSponsorship(req, res) {
  const files = sponsorship.collectUploadedFiles(req);
  try {
    const body = req.body || {};
    const settings = await sponsorship.getSponsorshipSettings(req.countryId);
    if (!settings.enabled) throw sponsorship.httpError(403, "Le parrainage n'est pas encore ouvert dans ce pays.", "SPONSORSHIP_DISABLED");
    const profile = await verifyPublicSponsor({ numeroFbo: body.sponsorNumeroFbo, nomComplet: body.sponsorNomComplet });
    const sponsorFbo = await upsertSponsorFbo(profile);
    const created = await createSubmittedSponsorship({
      sponsorFbo,
      settings,
      countryId: req.countryId,
      body,
      files,
      channel: "PUBLIC",
    });
    return res.status(201).json({ id: created.id, status: created.status, statusLabel: sponsorship.STATUS_LABELS[created.status] });
  } catch (error) {
    return sendError(res, error, "submitPublicSponsorship error:");
  } finally {
    sponsorship.cleanupTmpFiles(files);
  }
}

module.exports = {
  checkPublicRecruitEmail,
  getPublicSponsorshipCatalog,
  getPublicSponsorshipConfig,
  lookupSponsor,
  submitPublicSponsorship,
  verifySponsor,
};
