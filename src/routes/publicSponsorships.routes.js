// src/routes/publicSponsorships.routes.js
// Parrainage sans connexion (accueil > « Parrainer un distributeur »).

const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const controller = require("../controllers/publicSponsorships.controller");
const { uploadSponsorshipDocumentsMiddleware } = require("../services/sponsorship.service");

const router = express.Router();
router.use(resolveCountry);

const byIp = (req) => ({ ip: req.ip, country: req.countryId });

router.get("/config", controller.getPublicSponsorshipConfig);
router.get(
  "/catalog",
  createRateLimiter({ keyPrefix: "public_sponsorship_catalog", windowMs: 10 * 60 * 1000, max: 60, keyFn: byIp }),
  controller.getPublicSponsorshipCatalog,
);
router.post(
  "/sponsor",
  createRateLimiter({ keyPrefix: "public_sponsorship_sponsor", windowMs: 10 * 60 * 1000, max: 15, keyFn: byIp }),
  controller.verifySponsor,
);
router.post(
  "/sponsor/lookup",
  createRateLimiter({ keyPrefix: "public_sponsorship_lookup", windowMs: 10 * 60 * 1000, max: 20, keyFn: byIp }),
  controller.lookupSponsor,
);
router.get(
  "/check-email",
  createRateLimiter({ keyPrefix: "public_sponsorship_email", windowMs: 10 * 60 * 1000, max: 40, keyFn: byIp }),
  controller.checkPublicRecruitEmail,
);
router.post(
  "/",
  createRateLimiter({ keyPrefix: "public_sponsorship_submit", windowMs: 60 * 60 * 1000, max: 10, keyFn: byIp }),
  uploadSponsorshipDocumentsMiddleware,
  controller.submitPublicSponsorship,
);

module.exports = router;
