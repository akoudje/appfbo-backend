// src/controllers/customerSponsorships.controller.js
// Espace client : le parrain (Animateur adjoint et plus) inscrit un filleul.

const prisma = require("../prisma");
const sponsorship = require("../services/sponsorship.service");
const purchase = require("../services/sponsorship-purchase.service");
const { writeSponsorshipAgreementPdf } = require("../services/sponsorship-agreement-pdf.service");
const { applySponsorshipCorrection, createSubmittedSponsorship } = require("../services/sponsorship-submission.service");

// Statuts pour lesquels la fiche porte un n° FBO et le cachet d'approbation.
const AGREEMENT_STATUSES = new Set(["APPROVED_PENDING_PURCHASE", "VALIDATED", "EXPIRED"]);

async function sendAgreementPdf(res, row) {
  if (!row || !AGREEMENT_STATUSES.has(row.status) || !row.recruitFboNumero) {
    return res.status(409).json({ message: "La fiche cachetée est disponible une fois le parrainage approuvé." });
  }
  const [approver, country] = await Promise.all([
    row.approvedById ? prisma.adminUser.findUnique({ where: { id: row.approvedById }, select: { fullName: true, email: true } }) : null,
    prisma.country.findUnique({ where: { id: row.countryId }, select: { name: true, code: true } }),
  ]);
  const fileName = `agrement-${row.recruitFboNumero}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  writeSponsorshipAgreementPdf(res, {
    sponsorship: row,
    approverName: approver?.fullName || approver?.email || "",
    countryName: country?.name || "Côte d'Ivoire",
    countryCode: country?.code,
  });
  return undefined;
}


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
        purchasePaymentMode: true, purchaseDeliveryMode: true, cancelledAt: true, cancellationReason: true,
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
    const created = await createSubmittedSponsorship({
      sponsorFbo: fbo,
      settings,
      countryId: req.countryId,
      body: req.body || {},
      files,
      channel: "CUSTOMER_PORTAL",
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
    return res.json(await applySponsorshipCorrection({ existing, body: req.body || {}, files, settings, by: "SPONSOR", actorFboId: fbo.id }));
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

// GET /api/customer/me/sponsorships/:id/agreement.pdf : fiche cachetée (parrain).
async function downloadMySponsorshipAgreement(req, res) {
  try {
    const fbo = await loadSponsor(req);
    const row = await prisma.sponsorship.findFirst({ where: { id: req.params.id, sponsorFboId: fbo.id, countryId: req.countryId } });
    if (!row) return res.status(404).json({ message: "Parrainage introuvable." });
    return await sendAgreementPdf(res, row);
  } catch (error) {
    return sendError(res, error, "downloadMySponsorshipAgreement error:");
  }
}

// GET /api/customer/me/sponsorships/check-email?email=…&excludeId=… : l'email est-il
// libre ? (vérification dès la saisie dans le formulaire ; renvoie un booléen seul).
async function checkRecruitEmail(req, res) {
  try {
    await loadSponsor(req);
    const email = String(req.query.email || "").trim();
    if (!email) return res.json({ available: true });
    let excludeSponsorshipId = null;
    if (req.query.excludeId) {
      const own = await prisma.sponsorship.findFirst({
        where: { id: String(req.query.excludeId), sponsorFboId: req.customer.fboId },
        select: { id: true },
      });
      excludeSponsorshipId = own?.id || null;
    }
    return res.json({ available: await sponsorship.isRecruitEmailAvailable(email, { excludeSponsorshipId }) });
  } catch (error) {
    return sendError(res, error, "checkRecruitEmail error:");
  }
}

module.exports = {
  checkRecruitEmail,
  downloadMySponsorshipAgreement,
  getSponsorshipCatalog,
  startSponsorshipPurchase,
  listMySponsorships,
  getMySponsorship,
  submitSponsorship,
  resubmitSponsorship,
  downloadMySponsorshipDocument,
};
