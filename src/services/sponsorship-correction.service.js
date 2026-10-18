// src/services/sponsorship-correction.service.js
// Lien sécurisé de correction envoyé au filleul quand Forever demande un
// complément : le filleul corrige lui-même sa fiche, sans connexion.
// Lien court et signé (HMAC, sans stockage) pour tenir dans un SMS : valable
// 30 jours et seulement tant que la fiche est « Complément demandé ».

const crypto = require("crypto");
const prisma = require("../prisma");
const { httpError } = require("./sponsorship.service");

const CORRECTION_LINK_DAYS = 30;

function secret() {
  const base = process.env.JWT_SECRET || process.env.CUSTOMER_JWT_SECRET;
  if (!base) throw new Error("JWT_SECRET manquant : lien de correction impossible.");
  return `sponsorship-correction|${base}`;
}

const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 16);

// Jeton « <id>.<expiration base 36>.<signature> » (~52 caractères).
function createCorrectionToken(sponsorship, now = new Date()) {
  const expiresAt = (now.getTime() + CORRECTION_LINK_DAYS * 24 * 60 * 60 * 1000).toString(36);
  const payload = `${sponsorship.id}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function publicBaseUrl() {
  const configured = process.env.APP_PUBLIC_BASE_URL || process.env.FRONTEND_PUBLIC_URL || "";
  return (configured || "https://forevercivstore.com").replace(/\/+$/, "");
}

function correctionUrl(token) {
  return `${publicBaseUrl()}/parrainage/c/${token}`;
}

// Parrainage visé par le jeton, s'il est encore « Complément demandé ».
async function loadByCorrectionToken(token) {
  const [id, expiresAt, signature] = String(token || "").split(".");
  const expected = id && expiresAt ? sign(`${id}.${expiresAt}`) : "";
  const valid =
    signature &&
    expected &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) throw httpError(404, "Lien de correction invalide.", "CORRECTION_LINK_INVALID");
  if (Number.parseInt(expiresAt, 36) < Date.now()) {
    throw httpError(410, "Ce lien de correction a expiré. Contactez votre parrain ou Forever.", "CORRECTION_LINK_EXPIRED");
  }
  const row = await prisma.sponsorship.findUnique({ where: { id } });
  if (!row || row.status !== "CHANGES_REQUESTED") {
    throw httpError(410, "Ce lien n'est plus valable : la fiche a déjà été corrigée ou traitée.", "CORRECTION_LINK_USED");
  }
  return row;
}

module.exports = { CORRECTION_LINK_DAYS, correctionUrl, createCorrectionToken, loadByCorrectionToken };
