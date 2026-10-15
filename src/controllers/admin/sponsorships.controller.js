// src/controllers/admin/sponsorships.controller.js
// File de vérification des parrainages (droit SPONSORSHIP_REVIEW).

const prisma = require("../../prisma");
const { scopeWhere, pickCountryId } = require("../../helpers/countryScope");
const sponsorship = require("../../services/sponsorship.service");
const purchase = require("../../services/sponsorship-purchase.service");
const { notifySponsorshipApproved } = require("../../services/sponsorship-notifications.service");
const { writeSponsorshipAgreementPdf, buildSponsorshipDossierPdf } = require("../../services/sponsorship-agreement-pdf.service");

// Statuts pour lesquels la fiche porte un n° FBO et le cachet d'approbation.
const AGREEMENT_STATUSES = new Set(["APPROVED_PENDING_PURCHASE", "VALIDATED", "EXPIRED"]);

async function sendAgreementPdf(res, row) {
  if (!row || !AGREEMENT_STATUSES.has(row.status) || !row.recruitFboNumero) {
    return res.status(409).json({ message: "La fiche cachetée est disponible une fois le parrainage approuvé." });
  }
  const [approver, country] = await Promise.all([
    row.approvedById ? prisma.adminUser.findUnique({ where: { id: row.approvedById }, select: { fullName: true, email: true } }) : null,
    prisma.country.findUnique({ where: { id: row.countryId }, select: { name: true } }),
  ]);
  const fileName = `agrement-${row.recruitFboNumero}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  writeSponsorshipAgreementPdf(res, {
    sponsorship: row,
    approverName: approver?.fullName || approver?.email || "",
    countryName: country?.name || "Côte d'Ivoire",
  });
  return undefined;
}


const STATUSES = new Set(Object.keys(sponsorship.STATUS_LABELS));
const DOCUMENT_SELECT = { id: true, type: true, mimeType: true, sizeBytes: true, originalFileName: true, createdAt: true };

function sendError(res, error, fallback) {
  if (!error.statusCode) console.error(fallback, error);
  return res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : "Erreur serveur (parrainages).",
    code: error.code || undefined,
  });
}

function withComputedFields(row) {
  if (!row) return row;
  return {
    ...row,
    statusLabel: sponsorship.STATUS_LABELS[row.status] || row.status,
    recruitAge: row.birthDate ? sponsorship.ageOn(row.birthDate) : null,
  };
}

async function loadForReview(req, statuses) {
  const row = await prisma.sponsorship.findFirst({ where: scopeWhere(req, { id: req.params.id }) });
  if (!row) throw sponsorship.httpError(404, "Parrainage introuvable.");
  if (statuses && !statuses.includes(row.status)) {
    throw sponsorship.httpError(409, `Action impossible : le parrainage est « ${sponsorship.STATUS_LABELS[row.status]} ».`, "SPONSORSHIP_BAD_STATUS");
  }
  return row;
}

// GET /api/admin/sponsorships?status=SUBMITTED&q=...
async function listSponsorships(req, res) {
  try {
    const status = String(req.query.status || "").toUpperCase();
    const q = String(req.query.q || "").trim();
    const where = scopeWhere(req, {
      ...(STATUSES.has(status) ? { status } : {}),
      ...(q
        ? {
            OR: [
              { lastName: { contains: q, mode: "insensitive" } },
              { firstNames: { contains: q, mode: "insensitive" } },
              { idDocumentNumber: { contains: q, mode: "insensitive" } },
              { sponsorNumero: { contains: q } },
              { sponsorNom: { contains: q, mode: "insensitive" } },
              { recruitFboNumero: { contains: q } },
              { mobile: { contains: q } },
            ],
          }
        : {}),
    });
    const [rows, counts] = await Promise.all([
      prisma.sponsorship.findMany({
        where,
        // FIFO : les plus anciennes soumissions d'abord.
        orderBy: [{ submittedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 300,
        select: {
          id: true, status: true, lastName: true, firstNames: true, birthDate: true, mobile: true, city: true,
          sponsorNumero: true, sponsorNom: true, sponsorGrade: true, submittedAt: true, recruitFboNumero: true,
          approvedAt: true, purchaseDeadlineAt: true, minPurchaseFcfa: true, validatedAt: true, createdAt: true,
          _count: { select: { documents: true } },
        },
      }),
      prisma.sponsorship.groupBy({ by: ["status"], where: scopeWhere(req, {}), _count: { _all: true } }),
    ]);
    return res.json({
      data: rows.map(withComputedFields),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    });
  } catch (error) {
    return sendError(res, error, "listSponsorships error:");
  }
}

// GET /api/admin/sponsorships/:id
async function getSponsorship(req, res) {
  try {
    const row = await prisma.sponsorship.findFirst({
      where: scopeWhere(req, { id: req.params.id }),
      include: {
        documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } },
        logs: { orderBy: { createdAt: "asc" } },
        sponsorFbo: { select: { numeroFbo: true, nomComplet: true, grade: true } },
        recruitFbo: { select: { id: true, numeroFbo: true, nomComplet: true, grade: true, sponsorFboId: true } },
      },
    });
    if (!row) return res.status(404).json({ message: "Parrainage introuvable." });

    const purchasePreorder = row.purchasePreorderId
      ? await prisma.preorder.findFirst({
          where: { id: row.purchasePreorderId },
          select: { id: true, preorderNumber: true, status: true, totalFcfa: true },
        })
      : null;

    // Doublons possibles : même pièce, même mobile ou même email sur un autre parrainage.
    const duplicates = await prisma.sponsorship.findMany({
      where: scopeWhere(req, {
        id: { not: row.id },
        OR: [
          { idDocumentNumber: row.idDocumentNumber },
          { mobile: row.mobile },
          ...(row.email ? [{ email: { equals: row.email, mode: "insensitive" } }] : []),
        ],
      }),
      select: { id: true, status: true, lastName: true, firstNames: true, idDocumentNumber: true, mobile: true, email: true, createdAt: true },
      take: 10,
    });
    return res.json({ ...withComputedFields(row), duplicates, purchasePreorder });
  } catch (error) {
    return sendError(res, error, "getSponsorship error:");
  }
}

// GET /api/admin/sponsorships/:id/documents/:documentId/file
async function downloadSponsorshipDocument(req, res) {
  try {
    const document = await prisma.sponsorshipDocument.findFirst({
      where: { id: req.params.documentId, sponsorship: scopeWhere(req, { id: req.params.id }) },
    });
    if (!document) return res.status(404).json({ message: "Pièce introuvable." });
    return await sponsorship.streamSponsorshipDocument(document, res);
  } catch (error) {
    return sendError(res, error, "downloadSponsorshipDocument error:");
  }
}

// POST /api/admin/sponsorships/:id/request-changes { note }
async function requestChanges(req, res) {
  try {
    const note = String(req.body?.note || "").trim();
    if (!note) throw sponsorship.httpError(400, "Précisez le complément attendu.");
    const row = await loadForReview(req, ["SUBMITTED"]);
    await prisma.$transaction(async (tx) => {
      await tx.sponsorship.update({
        where: { id: row.id },
        data: { status: "CHANGES_REQUESTED", reviewNote: note, reviewedAt: new Date(), reviewedById: req.user?.id || null },
      });
      await sponsorship.addSponsorshipLog(tx, { sponsorshipId: row.id, action: "CHANGES_REQUESTED", note, actorAdminId: req.user?.id || null });
    });
    await sponsorship.notifySms({
      to: await sponsorship.findSponsorPhone(row),
      countryCode: req.country?.code || "CIV",
      message: `FOREVER: parrainage de ${row.firstNames} ${row.lastName} : complement demande. Consultez votre espace client.`,
    });
    return res.json({ ok: true, status: "CHANGES_REQUESTED" });
  } catch (error) {
    return sendError(res, error, "requestChanges error:");
  }
}

// POST /api/admin/sponsorships/:id/reject { reason }
async function rejectSponsorship(req, res) {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) throw sponsorship.httpError(400, "Le motif du refus est obligatoire.");
    const row = await loadForReview(req, ["SUBMITTED", "CHANGES_REQUESTED"]);
    await prisma.$transaction(async (tx) => {
      await tx.sponsorship.update({
        where: { id: row.id },
        data: { status: "REJECTED", rejectionReason: reason, reviewedAt: new Date(), reviewedById: req.user?.id || null },
      });
      await sponsorship.addSponsorshipLog(tx, { sponsorshipId: row.id, action: "REJECTED", note: reason, actorAdminId: req.user?.id || null });
    });
    await sponsorship.notifySms({
      to: await sponsorship.findSponsorPhone(row),
      countryCode: req.country?.code || "CIV",
      message: `FOREVER: parrainage de ${row.firstNames} ${row.lastName} refuse. Motif : ${reason}`.slice(0, 300),
    });
    return res.json({ ok: true, status: "REJECTED" });
  } catch (error) {
    return sendError(res, error, "rejectSponsorship error:");
  }
}

// POST /api/admin/sponsorships/:id/approve
// { recruitFboNumero, factureReference, invoiceAmountFcfa, paymentMode?, deliveryMode?, items?, note? }
// Approbation et achat en une action : n° FBO attribué, commande du filleul créée
// à partir du panier et PRÉFACTURÉE (réf. et montant AS400). Puis UNE notification
// (SMS + email, parrain et filleul) : n° FBO, commande, montant, lien de paiement,
// fiche cachetée en pièce jointe. Plus de délai : le parrainage attend le paiement.
async function approveSponsorship(req, res) {
  try {
    const row = await loadForReview(req, ["SUBMITTED"]);
    const countryId = pickCountryId(req);
    const settings = await sponsorship.getSponsorshipSettings(countryId);
    const body = req.body || {};
    const numero = sponsorship.canonicalFboNumber(body.recruitFboNumero);
    if (!numero) throw sponsorship.httpError(400, "Le n° FBO doit contenir 12 chiffres (ex. 225-000-123-456).");
    if (settings.fboNumberPrefix && !numero.replace(/\D/g, "").startsWith(settings.fboNumberPrefix)) {
      throw sponsorship.httpError(400, `Le n° FBO doit commencer par ${settings.fboNumberPrefix} pour ce pays.`);
    }
    const age = sponsorship.ageOn(row.birthDate);
    if (age === null || age < sponsorship.MIN_RECRUIT_AGE) {
      throw sponsorship.httpError(409, `Le filleul doit être majeur (âge calculé : ${age ?? "inconnu"}).`);
    }
    const existing = await prisma.fbo.findUnique({ where: { numeroFbo: numero }, select: { id: true, nomComplet: true } });
    if (existing) {
      throw sponsorship.httpError(409, `Ce n° FBO est déjà attribué à ${existing.nomComplet}.`, "FBO_NUMBER_TAKEN");
    }

    // Contrôles de l'achat AVANT toute écriture (pas d'approbation à moitié faite).
    const paymentMode = body.paymentMode || row.purchasePaymentMode;
    const deliveryMode = body.deliveryMode || row.purchaseDeliveryMode;
    const options = await purchase.normalizePurchaseOptions({ countryId, paymentMode, deliveryMode });
    const reference = String(body.factureReference || "").replace(/\s+/g, " ").trim();
    if (!reference) throw sponsorship.httpError(400, "La référence AS400 est obligatoire.");
    if (!(Number(body.invoiceAmountFcfa) > 0)) throw sponsorship.httpError(400, "Le montant AS400 est obligatoire.");
    const duplicate = await prisma.preorder.findFirst({
      where: { countryId, factureReference: { equals: reference, mode: "insensitive" } },
      select: { preorderNumber: true },
    });
    if (duplicate) throw sponsorship.httpError(409, `Cette référence AS400 est déjà utilisée sur la commande ${duplicate.preorderNumber}.`);

    const now = new Date();
    const recruitName = `${row.lastName}, ${row.firstNames}`;
    await prisma.$transaction(async (tx) => {
      const recruit = await tx.fbo.create({
        data: {
          numeroFbo: numero,
          nomComplet: recruitName,
          email: row.email,
          grade: "CLIENT_PRIVILEGIE",
          pointDeVente: row.city,
          fboCountries: { create: { countryId, isPrimary: true, pointDeVente: row.city } },
        },
      });
      await tx.sponsorship.update({
        where: { id: row.id },
        data: {
          status: "APPROVED_PENDING_PURCHASE",
          recruitFboNumero: numero,
          recruitFboId: recruit.id,
          approvedAt: now,
          approvedById: req.user?.id || null,
          reviewedAt: now,
          reviewedById: req.user?.id || null,
          minPurchaseFcfa: settings.minPurchaseFcfa,
          purchaseDeadlineAt: null,
          purchasePaymentMode: options.payment,
          purchaseDeliveryMode: options.delivery,
        },
      });
      await sponsorship.addSponsorshipLog(tx, {
        sponsorshipId: row.id,
        action: "APPROVED",
        note: `Approuvé : n° FBO ${numero} (Client privilégié). Achat d'au moins ${settings.minPurchaseFcfa} F attendu (sans délai).`,
        meta: { recruitFboId: recruit.id, recruitFboNumero: numero, minPurchaseFcfa: settings.minPurchaseFcfa },
        actorAdminId: req.user?.id || null,
      });
    });

    const outcome = await invoiceAndNotify(req, row.id, { ...body, paymentMode: options.payment, deliveryMode: options.delivery, factureReference: reference });
    return res.status(outcome.ok ? 200 : 207).json({
      ok: true,
      status: "APPROVED_PENDING_PURCHASE",
      recruitFboNumero: numero,
      ...outcome,
    });
  } catch (error) {
    return sendError(res, error, "approveSponsorship error:");
  }
}

// Préfacture l'achat de parrainage puis envoie la notification fusionnée.
// Échec de préfacturation : journalisé, le facturier relance l'achat.
async function invoiceAndNotify(req, sponsorshipId, body) {
  const countryId = pickCountryId(req);
  const settings = await sponsorship.getSponsorshipSettings(countryId);
  const fresh = await prisma.sponsorship.findUnique({ where: { id: sponsorshipId }, include: { recruitFbo: true } });
  try {
    const result = await purchase.preinvoiceSponsorshipPurchase({
      req,
      sponsorship: fresh,
      recruitFbo: fresh.recruitFbo,
      items: body.items,
      paymentMode: body.paymentMode,
      deliveryMode: body.deliveryMode,
      factureReference: body.factureReference,
      invoiceAmountFcfa: Number(body.invoiceAmountFcfa),
      note: body.note,
      countryId,
      countryCode: settings.countryCode,
    });
    await sponsorship.addSponsorshipLog(null, {
      sponsorshipId,
      action: "PURCHASE_INVOICED",
      note: `Achat de parrainage préfacturé : ${result.order.preorderNumber}, réf. AS400 ${body.factureReference}, ${Number(body.invoiceAmountFcfa)} F.`,
      meta: { preorderId: result.order.id, paymentMode: body.paymentMode, deliveryMode: body.deliveryMode, paymentLink: result.paymentLink },
      actorAdminId: req.user?.id || null,
    });
    await notifySponsorshipApproved({
      sponsorshipId,
      order: { preorderNumber: result.order.preorderNumber, amountToPayFcfa: result.amountToPayFcfa, paymentMode: result.paymentMode },
      paymentLink: result.paymentLink,
    }).catch((error) => console.error("[sponsorship] notification d'approbation non envoyée", { sponsorshipId, error: error?.message }));
    return { ok: true, preorderId: result.order.id, purchasePreorderNumber: result.order.preorderNumber, paymentLink: result.paymentLink };
  } catch (error) {
    if (!error.statusCode) console.error("[sponsorship] préfacturation de l'achat échouée", { sponsorshipId, error: error?.message });
    await sponsorship.addSponsorshipLog(null, {
      sponsorshipId,
      action: "PURCHASE_INVOICE_FAILED",
      note: `Préfacturation de l'achat échouée : ${error.statusCode ? error.message : "erreur serveur"}. À relancer.`,
      actorAdminId: req.user?.id || null,
    }).catch(() => {});
    return {
      ok: false,
      purchaseError: `Parrainage approuvé, mais la préfacturation de l'achat a échoué : ${error.statusCode ? error.message : "erreur serveur"}. Relancez l'achat ; aucune notification n'est partie.`,
    };
  }
}

// POST /api/admin/sponsorships/:id/evaluate : relance immédiate du contrôle d'achat
// (sinon fait automatiquement toutes les 5 minutes).
async function evaluateNow(req, res) {
  try {
    const row = await loadForReview(req, ["APPROVED_PENDING_PURCHASE"]);
    const result = await sponsorship.evaluateSponsorship(row);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, "evaluateNow error:");
  }
}

// GET /api/admin/sponsorships/:id/agreement.pdf : fiche cachetée (archive / impression).
async function downloadSponsorshipAgreement(req, res) {
  try {
    const row = await prisma.sponsorship.findFirst({ where: scopeWhere(req, { id: req.params.id }) });
    if (!row) return res.status(404).json({ message: "Parrainage introuvable." });
    return await sendAgreementPdf(res, row);
  } catch (error) {
    return sendError(res, error, "downloadSponsorshipAgreement error:");
  }
}

// GET /api/admin/sponsorships/:id/dossier.pdf : dossier de traitement à tout
// statut (fiche + pièce d'identité), pour impression ou export. Chaque export
// est tracé dans l'historique (la pièce d'identité sort de l'application).
async function downloadSponsorshipDossier(req, res) {
  try {
    const row = await prisma.sponsorship.findFirst({
      where: scopeWhere(req, { id: req.params.id }),
      include: { documents: { orderBy: { createdAt: "asc" } } },
    });
    if (!row) return res.status(404).json({ message: "Parrainage introuvable." });

    const [approver, country] = await Promise.all([
      row.approvedById ? prisma.adminUser.findUnique({ where: { id: row.approvedById }, select: { fullName: true, email: true } }) : null,
      prisma.country.findUnique({ where: { id: row.countryId }, select: { name: true } }),
    ]);
    const documents = [];
    for (const document of row.documents) {
      try {
        const content = await sponsorship.fetchSponsorshipDocumentBuffer(document);
        documents.push({ type: document.type, originalFileName: document.originalFileName, ...content });
      } catch (error) {
        console.error("[sponsorship] pièce non récupérée pour le dossier", { id: document.id, error: error?.message });
      }
    }
    const pdf = await buildSponsorshipDossierPdf({
      sponsorship: row,
      approverName: approver?.fullName || approver?.email || "",
      countryName: country?.name || "Côte d'Ivoire",
      documents,
    });

    await sponsorship.addSponsorshipLog(null, {
      sponsorshipId: row.id,
      action: "DOSSIER_EXPORTED",
      note: `Dossier exporté (fiche + ${documents.length} pièce(s) d'identité).`,
      meta: { documents: documents.length, missing: row.documents.length - documents.length },
      actorAdminId: req.user?.id || null,
    });

    const safeName = `${row.lastName}-${row.firstNames}`.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="dossier-parrainage-${safeName}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(pdf);
  } catch (error) {
    return sendError(res, error, "downloadSponsorshipDossier error:");
  }
}

// GET /api/admin/sponsorships/:id/catalog : produits pour composer l'achat au comptoir.
async function getCounterCatalog(req, res) {
  try {
    const settings = await sponsorship.getSponsorshipSettings(pickCountryId(req));
    const products = await purchase.getRecruitCatalog({ countryId: pickCountryId(req), countryCode: settings.countryCode });
    return res.json({ products });
  } catch (error) {
    return sendError(res, error, "getCounterCatalog error:");
  }
}

// POST /api/admin/sponsorships/:id/counter-purchase
// { factureReference, invoiceAmountFcfa, paymentMode?, deliveryMode?, items?, note? }
// Relance de l'achat d'un parrainage approuvé (préfacturation échouée, ou commande
// annulée faute de paiement) : nouvelle commande préfacturée et nouvelle
// notification fusionnée (parrain et filleul).
async function counterPurchase(req, res) {
  try {
    const row = await loadForReview(req, ["APPROVED_PENDING_PURCHASE"]);
    const body = req.body || {};
    const outcome = await invoiceAndNotify(req, row.id, {
      ...body,
      paymentMode: body.paymentMode || row.purchasePaymentMode,
      deliveryMode: body.deliveryMode || row.purchaseDeliveryMode,
      factureReference: String(body.factureReference || "").replace(/\s+/g, " ").trim(),
    });
    if (!outcome.ok) return res.status(400).json({ message: outcome.purchaseError });
    return res.json({ ok: true, preorderId: outcome.preorderId, preorderNumber: outcome.purchasePreorderNumber, paymentLink: outcome.paymentLink });
  } catch (error) {
    return sendError(res, error, "counterPurchase error:");
  }
}

// POST /api/admin/sponsorships/:id/cancel { reason }
// Annulation d'un parrainage approuvé dont l'achat n'est pas payé.
async function cancelSponsorship(req, res) {
  try {
    const row = await loadForReview(req, ["APPROVED_PENDING_PURCHASE"]);
    const reason = String(req.body?.reason || "").trim();
    if (!reason) throw sponsorship.httpError(400, "Indiquez le motif de l'annulation.");
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.sponsorship.update({
        where: { id: row.id },
        data: { status: "CANCELLED", cancelledAt: now, cancellationReason: reason, reviewedById: req.user?.id || null },
      });
      await sponsorship.addSponsorshipLog(tx, {
        sponsorshipId: row.id,
        action: "CANCELLED",
        note: `Parrainage annulé : ${reason}`,
        actorAdminId: req.user?.id || null,
      });
    });
    return res.json({ ok: true, status: "CANCELLED", statusLabel: sponsorship.STATUS_LABELS.CANCELLED });
  } catch (error) {
    return sendError(res, error, "cancelSponsorship error:");
  }
}

module.exports = {
  downloadSponsorshipDossier,
  downloadSponsorshipAgreement,
  getCounterCatalog,
  counterPurchase,
  listSponsorships,
  getSponsorship,
  downloadSponsorshipDocument,
  requestChanges,
  rejectSponsorship,
  approveSponsorship,
  cancelSponsorship,
  evaluateNow,
};
