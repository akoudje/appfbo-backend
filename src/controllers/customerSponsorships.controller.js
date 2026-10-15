// src/controllers/customerSponsorships.controller.js
// Espace client : le parrain (Animateur adjoint et plus) inscrit un filleul.

const prisma = require("../prisma");
const sponsorship = require("../services/sponsorship.service");
const purchase = require("../services/sponsorship-purchase.service");

// Champs renvoyés au parrain : jamais l'emplacement de stockage des pièces.
const DOCUMENT_SELECT = { id: true, type: true, mimeType: true, sizeBytes: true, originalFileName: true, createdAt: true };

function serializeForSponsor(row) {
  if (!row) return row;
  return {
    ...row,
    statusLabel: sponsorship.STATUS_LABELS[row.status] || row.status,
    reviewedById: undefined,
    approvedById: undefined,
  };
}

async function loadSponsor(req) {
  const fbo = await prisma.fbo.findUnique({
    where: { id: req.customer.fboId },
    select: { id: true, numeroFbo: true, nomComplet: true, grade: true },
  });
  if (!fbo) throw sponsorship.httpError(401, "Session invalide.");
  return fbo;
}

function sendError(res, error, fallback) {
  if (!error.statusCode) console.error(fallback, error);
  return res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : "Erreur serveur (parrainage).",
    code: error.code || undefined,
  });
}

// GET /api/customer/me/sponsorships : éligibilité + mes parrainages.
async function listMySponsorships(req, res) {
  try {
    const [fbo, settings] = await Promise.all([loadSponsor(req), sponsorship.getSponsorshipSettings(req.countryId)]);
    // Préremplissage du champ « Votre téléphone » : dernier numéro connu du parrain.
    const lastSponsorship = await prisma.sponsorship.findFirst({
      where: { sponsorFboId: fbo.id, sponsorPhone: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { sponsorPhone: true },
    });
    const sponsorPhoneSuggestion =
      lastSponsorship?.sponsorPhone || (await sponsorship.findSponsorPhone({ sponsorFboId: fbo.id }));
    const rows = await prisma.sponsorship.findMany({
      where: { sponsorFboId: fbo.id, countryId: req.countryId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, status: true, lastName: true, firstNames: true, mobile: true, createdAt: true, submittedAt: true,
        rejectionReason: true, reviewNote: true, recruitFboNumero: true, approvedAt: true, purchaseDeadlineAt: true,
        minPurchaseFcfa: true, validatedAt: true, expiredAt: true,
        purchaseItems: true, purchaseIndicativeTotalFcfa: true, purchasePreorderId: true,
      },
    });
    return res.json({
      eligibility: {
        enabled: settings.enabled,
        gradeAllowed: sponsorship.isSponsorGradeAllowed(fbo.grade),
        grade: fbo.grade,
        minRecruitAge: sponsorship.MIN_RECRUIT_AGE,
        minPurchaseFcfa: settings.minPurchaseFcfa,
        purchaseWindowHours: settings.purchaseWindowHours,
        consentVersion: sponsorship.CONSENT_VERSION,
      },
      sponsor: { numeroFbo: fbo.numeroFbo, nomComplet: fbo.nomComplet, grade: fbo.grade, phoneSuggestion: sponsorPhoneSuggestion },
      data: rows.map(serializeForSponsor),
    });
  } catch (error) {
    return sendError(res, error, "listMySponsorships error:");
  }
}

// GET /api/customer/me/sponsorships/:id
async function getMySponsorship(req, res) {
  try {
    const fbo = await loadSponsor(req);
    const row = await prisma.sponsorship.findFirst({
      where: { id: req.params.id, sponsorFboId: fbo.id, countryId: req.countryId },
      include: {
        documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } },
        logs: { orderBy: { createdAt: "asc" }, select: { action: true, note: true, createdAt: true } },
      },
    });
    if (!row) return res.status(404).json({ message: "Parrainage introuvable." });
    return res.json(serializeForSponsor(row));
  } catch (error) {
    return sendError(res, error, "getMySponsorship error:");
  }
}

// POST /api/customer/me/sponsorships (multipart : champs de la fiche + idFront, idBack, passport, other)
// Soumet directement : la fiche est complète, le parrain atteste l'accord du filleul.
async function submitSponsorship(req, res) {
  const files = sponsorship.collectUploadedFiles(req);
  try {
    const [fbo, settings] = await Promise.all([loadSponsor(req), sponsorship.getSponsorshipSettings(req.countryId)]);
    if (!settings.enabled) throw sponsorship.httpError(403, "Le parrainage n'est pas encore ouvert dans ce pays.", "SPONSORSHIP_DISABLED");
    if (!sponsorship.isSponsorGradeAllowed(fbo.grade)) {
      throw sponsorship.httpError(403, "Le parrainage est réservé aux FBO de grade Animateur adjoint et plus.", "SPONSOR_GRADE_NOT_ALLOWED");
    }

    const body = req.body || {};
    if (String(body.consentAccepted) !== "true") {
      throw sponsorship.httpError(400, "Vous devez attester disposer de l'accord et de la procuration du filleul.", "SPONSORSHIP_CONSENT_REQUIRED");
    }
    const data = sponsorship.normalizeRecruitPayload(body, { countryCode: settings.countryCode });
    const cart = await purchase.normalizePurchaseCart(body.purchaseItems, {
      countryId: req.countryId,
      countryCode: settings.countryCode,
      minPurchaseFcfa: settings.minPurchaseFcfa,
    });

    const hasIdentity = files.some(({ type }) => ["ID_FRONT", "PASSPORT"].includes(type));
    if (!hasIdentity) {
      throw sponsorship.httpError(400, "Joignez la pièce d'identité du filleul (CNI recto ou passeport).", "SPONSORSHIP_DOCUMENT_REQUIRED");
    }

    // Une même pièce ne peut pas être en cours de parrainage deux fois.
    const duplicate = await prisma.sponsorship.findFirst({
      where: {
        countryId: req.countryId,
        idDocumentNumber: data.idDocumentNumber,
        status: { in: ["SUBMITTED", "CHANGES_REQUESTED", "APPROVED_PENDING_PURCHASE", "VALIDATED"] },
      },
      select: { id: true, status: true },
    });
    if (duplicate) {
      throw sponsorship.httpError(409, "Un parrainage existe déjà pour cette pièce d'identité.", "SPONSORSHIP_DUPLICATE_ID");
    }

    const recruitName = `${data.firstNames} ${data.lastName}`;
    const now = new Date();
    const created = await prisma.sponsorship.create({
      data: {
        ...data,
        countryId: req.countryId,
        status: "SUBMITTED",
        sponsorFboId: fbo.id,
        sponsorNumero: fbo.numeroFbo,
        sponsorNom: fbo.nomComplet,
        sponsorGrade: fbo.grade,
        consentText: sponsorship.buildConsentText({ recruitName, countryName: settings.countryName }),
        consentVersion: sponsorship.CONSENT_VERSION,
        consentAcceptedAt: now,
        submittedAt: now,
        purchaseItems: cart ? cart.items : undefined,
        purchaseIndicativeTotalFcfa: cart ? cart.totalFcfa : null,
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
      note: `Parrainage soumis par ${fbo.nomComplet} (${fbo.numeroFbo}).`,
      meta: { documents: documents.map((d) => d.type), consentVersion: sponsorship.CONSENT_VERSION },
      actorFboId: fbo.id,
    });

    return res.status(201).json({ id: created.id, status: created.status, statusLabel: sponsorship.STATUS_LABELS[created.status] });
  } catch (error) {
    return sendError(res, error, "submitSponsorship error:");
  } finally {
    sponsorship.cleanupTmpFiles(files);
  }
}

// PUT /api/customer/me/sponsorships/:id : correction après « Complément demandé », puis resoumission.
async function resubmitSponsorship(req, res) {
  const files = sponsorship.collectUploadedFiles(req);
  try {
    const [fbo, settings] = await Promise.all([loadSponsor(req), sponsorship.getSponsorshipSettings(req.countryId)]);
    const existing = await prisma.sponsorship.findFirst({
      where: { id: req.params.id, sponsorFboId: fbo.id, countryId: req.countryId },
    });
    if (!existing) return res.status(404).json({ message: "Parrainage introuvable." });
    if (existing.status !== "CHANGES_REQUESTED") {
      throw sponsorship.httpError(409, "Ce parrainage ne peut plus être modifié.", "SPONSORSHIP_LOCKED");
    }
    const data = sponsorship.normalizeRecruitPayload(req.body || {}, { countryCode: settings.countryCode });
    const cart = await purchase.normalizePurchaseCart(req.body?.purchaseItems, {
      countryId: req.countryId,
      countryCode: settings.countryCode,
      minPurchaseFcfa: settings.minPurchaseFcfa,
    });

    const documents = [];
    for (const entry of files) {
      documents.push(await sponsorship.storeSponsorshipDocument({ ...entry, sponsorshipId: existing.id }));
    }
    await prisma.$transaction(async (tx) => {
      await tx.sponsorship.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: "SUBMITTED",
          submittedAt: new Date(),
          purchaseItems: cart ? cart.items : prismaDbNull(),
          purchaseIndicativeTotalFcfa: cart ? cart.totalFcfa : null,
        },
      });
      if (documents.length) await tx.sponsorshipDocument.createMany({ data: documents });
      await sponsorship.addSponsorshipLog(tx, {
        sponsorshipId: existing.id,
        action: "RESUBMITTED",
        note: "Parrainage corrigé et resoumis par le parrain.",
        meta: { newDocuments: documents.map((d) => d.type) },
        actorFboId: fbo.id,
      });
    });
    return res.json({ id: existing.id, status: "SUBMITTED", statusLabel: sponsorship.STATUS_LABELS.SUBMITTED });
  } catch (error) {
    return sendError(res, error, "resubmitSponsorship error:");
  } finally {
    sponsorship.cleanupTmpFiles(files);
  }
}

// GET /api/customer/me/sponsorships/:id/documents/:documentId/file (le parrain relit ses propres envois)
async function downloadMySponsorshipDocument(req, res) {
  try {
    const fbo = await loadSponsor(req);
    const document = await prisma.sponsorshipDocument.findFirst({
      where: {
        id: req.params.documentId,
        sponsorship: { id: req.params.id, sponsorFboId: fbo.id, countryId: req.countryId },
      },
    });
    if (!document) return res.status(404).json({ message: "Pièce introuvable." });
    return await sponsorship.streamSponsorshipDocument(document, res);
  } catch (error) {
    return sendError(res, error, "downloadMySponsorshipDocument error:");
  }
}

// GET /api/customer/me/sponsorships/catalog : produits proposables pour l'achat de
// parrainage (prix Client privilégié, en stock).
async function getSponsorshipCatalog(req, res) {
  try {
    const settings = await sponsorship.getSponsorshipSettings(req.countryId);
    const products = await purchase.getRecruitCatalog({ countryId: req.countryId, countryCode: settings.countryCode });
    return res.json({ minPurchaseFcfa: settings.minPurchaseFcfa, grade: purchase.RECRUIT_GRADE, products });
  } catch (error) {
    return sendError(res, error, "getSponsorshipCatalog error:");
  }
}

// POST /api/customer/me/sponsorships/:id/purchase : « Faire l'achat ». Renvoie la
// commande brouillon préparée à l'approbation (à reprendre au récapitulatif), la
// commande déjà soumise, ou le profil du filleul pour démarrer une commande.
async function startSponsorshipPurchase(req, res) {
  try {
    const fbo = await loadSponsor(req);
    const row = await prisma.sponsorship.findFirst({
      where: { id: req.params.id, sponsorFboId: fbo.id, countryId: req.countryId },
      include: { recruitFbo: { select: { numeroFbo: true, nomComplet: true, email: true, grade: true } } },
    });
    if (!row) return res.status(404).json({ message: "Parrainage introuvable." });
    if (row.status !== "APPROVED_PENDING_PURCHASE" || !row.recruitFbo) {
      throw sponsorship.httpError(409, "L'achat de parrainage n'est possible qu'une fois le parrainage approuvé.", "SPONSORSHIP_NOT_APPROVED");
    }
    const recruit = {
      numeroFbo: row.recruitFbo.numeroFbo,
      nomComplet: row.recruitFbo.nomComplet,
      grade: row.recruitFbo.grade,
      email: row.recruitFbo.email || "",
      phone: row.sponsorPhone || "",
    };
    const base = { countryCode: req.country?.code || "CIV", identityVerified: true, fbo: recruit, purchaseDeadlineAt: row.purchaseDeadlineAt };
    if (row.purchasePreorderId) {
      const order = await prisma.preorder.findFirst({
        where: { id: row.purchasePreorderId, countryId: req.countryId },
        select: { id: true, preorderNumber: true, status: true },
      });
      if (order?.status === "DRAFT") {
        return res.json({ ...base, mode: "DRAFT", preorderId: order.id, preorderNumber: order.preorderNumber });
      }
      if (order && order.status !== "CANCELLED") {
        return res.json({ ...base, mode: "SUBMITTED", preorderId: order.id, preorderNumber: order.preorderNumber });
      }
    }
    return res.json({ ...base, mode: "NEW" });
  } catch (error) {
    return sendError(res, error, "startSponsorshipPurchase error:");
  }
}

function prismaDbNull() {
  return require("@prisma/client").Prisma.DbNull;
}

module.exports = {
  getSponsorshipCatalog,
  startSponsorshipPurchase,
  listMySponsorships,
  getMySponsorship,
  submitSponsorship,
  resubmitSponsorship,
  downloadMySponsorshipDocument,
};
