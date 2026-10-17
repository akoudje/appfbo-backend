// src/services/sponsorship-submission.service.js
// Soumission d'une fiche de parrainage, commune à l'espace client (parrain
// connecté) et au parcours public (parrain identifié par n° FBO + nom).

const prisma = require("../prisma");
const sponsorship = require("./sponsorship.service");
const purchase = require("./sponsorship-purchase.service");
const {
  canonicalFboNumber,
  digitsOnly,
  fetchFboDirectoryProfile,
  isFboDirectoryTemporarilyUnavailable,
  normalizeGrade,
} = require("./fboDirectory.service");
const { matchingFboNames } = require("../utils/fboIdentity");

// Profil du parrain dans l'annuaire FBO (nom, grade, grade autorisé) à partir de
// son seul numéro. Annuaire momentanément indisponible : repli sur la fiche
// locale déjà connue. Ne crée ni ne modifie rien.
async function lookupPublicSponsor({ numeroFbo }) {
  const canonical = canonicalFboNumber(numeroFbo);
  if (digitsOnly(canonical).length !== 12) {
    throw sponsorship.httpError(400, "Numéro FBO invalide : 12 chiffres attendus (ex. 225-000-123-456).", "SPONSOR_FBO_INVALID");
  }

  let profile = null;
  try {
    const payload = await fetchFboDirectoryProfile(canonical);
    if (payload && payload.exists !== false) {
      profile = {
        fullName: String(payload.full_name || payload.fullName || payload.nomComplet || "").trim(),
        grade: normalizeGrade(payload.grade),
      };
    }
  } catch (error) {
    if (!isFboDirectoryTemporarilyUnavailable(error)) throw error;
    const local = await prisma.fbo.findUnique({ where: { numeroFbo: canonical }, select: { nomComplet: true, grade: true } });
    if (!local) {
      throw sponsorship.httpError(503, "Votre numéro FBO ne peut pas être vérifié pour le moment. Réessayez dans quelques minutes.", "SPONSOR_VERIFICATION_UNAVAILABLE");
    }
    profile = { fullName: local.nomComplet, grade: local.grade };
  }

  if (!profile) throw sponsorship.httpError(404, "Numéro FBO du parrain introuvable. Vérifiez le numéro.", "SPONSOR_FBO_NOT_FOUND");
  if (!profile.fullName || !profile.grade) {
    throw sponsorship.httpError(502, "Profil FBO incomplet. Contactez Forever.", "SPONSOR_PROFILE_INCOMPLETE");
  }
  if (!sponsorship.isSponsorGradeAllowed(profile.grade)) {
    throw sponsorship.httpError(403, "Ce FBO ne peut pas parrainer : le parrainage est réservé aux grades Animateur adjoint et plus.", "SPONSOR_GRADE_NOT_ALLOWED");
  }
  return { numeroFbo: canonical, nomComplet: profile.fullName.toUpperCase(), grade: profile.grade };
}

// Contrôle à l'envoi : profil de l'annuaire + nom transmis par le formulaire
// (celui affiché après la recherche du numéro).
async function verifyPublicSponsor({ numeroFbo, nomComplet }) {
  const name = String(nomComplet || "").trim();
  if (!name) throw sponsorship.httpError(400, "Vérifiez le numéro FBO du parrain.", "SPONSOR_NAME_REQUIRED");
  const profile = await lookupPublicSponsor({ numeroFbo });
  if (!matchingFboNames(name, profile.nomComplet)) {
    throw sponsorship.httpError(400, "Le parrain indiqué ne correspond pas à ce numéro FBO. Vérifiez de nouveau le numéro.", "FBO_IDENTITY_MISMATCH");
  }
  return profile;
}

// Fiche FBO locale du parrain (créée au besoin) : c'est elle qui relie le
// parrainage à son espace client. L'email n'est jamais touché ici, car il
// sert à la connexion par code.
async function upsertSponsorFbo(profile) {
  return prisma.fbo.upsert({
    where: { numeroFbo: profile.numeroFbo },
    update: { nomComplet: profile.nomComplet, grade: profile.grade },
    create: { numeroFbo: profile.numeroFbo, nomComplet: profile.nomComplet, grade: profile.grade, pointDeVente: "" },
    select: { id: true, numeroFbo: true, nomComplet: true, grade: true },
  });
}

// Crée le parrainage au statut « Soumis » avec ses pièces. Le panier d'achat
// de validation est obligatoire.
async function createSubmittedSponsorship({ sponsorFbo, settings, countryId, body = {}, files = [], channel = "CUSTOMER_PORTAL" }) {
  if (!settings.enabled) throw sponsorship.httpError(403, "Le parrainage n'est pas encore ouvert dans ce pays.", "SPONSORSHIP_DISABLED");
  if (!sponsorship.isSponsorGradeAllowed(sponsorFbo.grade)) {
    throw sponsorship.httpError(403, "Le parrainage est réservé aux FBO de grade Animateur adjoint et plus.", "SPONSOR_GRADE_NOT_ALLOWED");
  }
  if (String(body.consentAccepted) !== "true") {
    throw sponsorship.httpError(400, "Vous devez attester disposer de l'accord et de la procuration du filleul.", "SPONSORSHIP_CONSENT_REQUIRED");
  }
  const data = sponsorship.normalizeRecruitPayload(body, { countryCode: settings.countryCode });
  const cart = await purchase.normalizePurchaseCart(body.purchaseItems, {
    countryId,
    countryCode: settings.countryCode,
    minPurchaseFcfa: settings.minPurchaseFcfa,
    required: true,
  });
  // Paiement et livraison de l'achat, choisis par le parrain.
  const purchaseOptions = await purchase.normalizePurchaseOptions({
    countryId,
    paymentMode: body.purchasePaymentMode,
    deliveryMode: body.purchaseDeliveryMode,
  });

  await sponsorship.assertRecruitEmailAvailable(data.email);

  // Passeport : page d'identité ; autres pièces (CNI, permis…) : recto.
  const requiredUpload = data.idDocumentType === "PASSPORT" ? "PASSPORT" : "ID_FRONT";
  if (!files.some(({ type }) => type === requiredUpload)) {
    const what = data.idDocumentType === "PASSPORT" ? "la page d'identité du passeport" : `le recto de la pièce (${sponsorship.ID_DOCUMENT_LABELS[data.idDocumentType]})`;
    throw sponsorship.httpError(400, `Joignez ${what} du filleul.`, "SPONSORSHIP_DOCUMENT_REQUIRED");
  }
  await sponsorship.assertDocumentsQuality(files);

  // Une même pièce ne peut pas être en cours de parrainage deux fois.
  const duplicate = await prisma.sponsorship.findFirst({
    where: {
      countryId,
      idDocumentNumber: data.idDocumentNumber,
      status: { in: sponsorship.ACTIVE_SPONSORSHIP_STATUSES },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw sponsorship.httpError(409, "Un parrainage existe déjà pour cette pièce d'identité.", "SPONSORSHIP_DUPLICATE_ID");
  }

  const recruitName = `${data.firstNames} ${data.lastName}`;
  const now = new Date();
  const created = await prisma.sponsorship.create({
    data: {
      ...data,
      countryId,
      status: "SUBMITTED",
      sponsorFboId: sponsorFbo.id,
      sponsorNumero: sponsorFbo.numeroFbo,
      sponsorNom: sponsorFbo.nomComplet,
      sponsorGrade: sponsorFbo.grade,
      // Parcours public : c'est le filleul qui remplit et atteste.
      consentText:
        channel === "PUBLIC"
          ? sponsorship.buildRecruitConsentText({ recruitName, sponsorName: sponsorFbo.nomComplet, countryName: settings.countryName })
          : sponsorship.buildConsentText({ recruitName, countryName: settings.countryName }),
      consentVersion: channel === "PUBLIC" ? sponsorship.RECRUIT_CONSENT_VERSION : sponsorship.CONSENT_VERSION,
      consentAcceptedAt: now,
      submittedAt: now,
      purchaseItems: cart.items,
      purchaseIndicativeTotalFcfa: cart.totalFcfa,
      purchasePaymentMode: purchaseOptions.payment,
      purchaseDeliveryMode: purchaseOptions.delivery,
    },
  });

  // Les pièces sont stockées après la création (identifiant du parrainage connu).
  const documents = [];
  for (const entry of files) {
    documents.push(await sponsorship.storeSponsorshipDocument({ ...entry, sponsorshipId: created.id }));
  }
  await prisma.sponsorshipDocument.createMany({ data: documents });
  await sponsorship.addSponsorshipLog(null, {
    sponsorshipId: created.id,
    action: "SUBMITTED",
    note:
      channel === "PUBLIC"
        ? `Fiche envoyée en ligne par le filleul ${recruitName}, parrain ${sponsorFbo.nomComplet} (${sponsorFbo.numeroFbo}).`
        : `Parrainage soumis par ${sponsorFbo.nomComplet} (${sponsorFbo.numeroFbo}).`,
    meta: { documents: documents.map((d) => d.type), consentVersion: channel === "PUBLIC" ? sponsorship.RECRUIT_CONSENT_VERSION : sponsorship.CONSENT_VERSION, channel },
    actorFboId: sponsorFbo.id,
  });
  return created;
}

module.exports = { createSubmittedSponsorship, lookupPublicSponsor, upsertSponsorFbo, verifyPublicSponsor };
