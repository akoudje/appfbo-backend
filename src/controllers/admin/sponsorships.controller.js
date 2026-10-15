// src/controllers/admin/sponsorships.controller.js
// File de vérification des parrainages (droit SPONSORSHIP_REVIEW).

const prisma = require("../../prisma");
const { scopeWhere, pickCountryId } = require("../../helpers/countryScope");
const sponsorship = require("../../services/sponsorship.service");
const purchase = require("../../services/sponsorship-purchase.service");

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

    // Doublons possibles : même pièce ou même mobile sur un autre parrainage.
    const duplicates = await prisma.sponsorship.findMany({
      where: scopeWhere(req, {
        id: { not: row.id },
        OR: [{ idDocumentNumber: row.idDocumentNumber }, { mobile: row.mobile }],
      }),
      select: { id: true, status: true, lastName: true, firstNames: true, idDocumentNumber: true, mobile: true, createdAt: true },
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
      countryCode: "CIV",
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
      countryCode: "CIV",
      message: `FOREVER: parrainage de ${row.firstNames} ${row.lastName} refuse. Motif : ${reason}`.slice(0, 300),
    });
    return res.json({ ok: true, status: "REJECTED" });
  } catch (error) {
    return sendError(res, error, "rejectSponsorship error:");
  }
}

// POST /api/admin/sponsorships/:id/approve { recruitFboNumero }
// L'agent saisit le n° FBO attribué dans AS400 ; le filleul est créé en Client
// privilégié et peut commander tout de suite. Le délai d'achat démarre.
async function approveSponsorship(req, res) {
  try {
    const row = await loadForReview(req, ["SUBMITTED"]);
    const settings = await sponsorship.getSponsorshipSettings(pickCountryId(req));
    const numero = sponsorship.canonicalFboNumber(req.body?.recruitFboNumero);
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

    const now = new Date();
    const deadline = new Date(now.getTime() + settings.purchaseWindowHours * 60 * 60 * 1000);
    const recruitName = `${row.lastName}, ${row.firstNames}`;
    const countryId = pickCountryId(req);

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
          purchaseDeadlineAt: deadline,
        },
      });
      await sponsorship.addSponsorshipLog(tx, {
        sponsorshipId: row.id,
        action: "APPROVED",
        note: `Approuvé : n° FBO ${numero} (Client privilégié). Achat d'au moins ${settings.minPurchaseFcfa} F attendu avant le ${deadline.toISOString()}.`,
        meta: { recruitFboId: recruit.id, recruitFboNumero: numero, minPurchaseFcfa: settings.minPurchaseFcfa, purchaseDeadlineAt: deadline.toISOString() },
        actorAdminId: req.user?.id || null,
      });
    });

    let purchaseDraft = null;
    try {
      const fresh = await prisma.sponsorship.findUnique({ where: { id: row.id }, include: { recruitFbo: true } });
      purchaseDraft = await purchase.createRecruitPurchaseDraft({
        sponsorship: fresh,
        recruitFbo: fresh.recruitFbo,
        countryId,
        countryCode: settings.countryCode,
      });
      if (purchaseDraft?.preorder) {
        await prisma.sponsorship.update({ where: { id: row.id }, data: { purchasePreorderId: purchaseDraft.preorder.id } });
      }
      if (purchaseDraft) {
        await sponsorship.addSponsorshipLog(null, {
          sponsorshipId: row.id,
          action: "PURCHASE_DRAFT_CREATED",
          note: purchaseDraft.preorder
            ? `Commande d'achat préparée : ${purchaseDraft.preorder.preorderNumber} (brouillon, paiement et livraison à choisir par le parrain).`
            : "Panier d'achat non transformé : plus aucun produit disponible.",
          meta: { preorderId: purchaseDraft.preorder?.id || null, adjustments: purchaseDraft.adjustments },
          actorAdminId: req.user?.id || null,
        });
      }
    } catch (error) {
      console.error("[sponsorship] commande d'achat non créée", { id: row.id, error: error?.message });
      await sponsorship.addSponsorshipLog(null, {
        sponsorshipId: row.id,
        action: "PURCHASE_DRAFT_FAILED",
        note: "La commande d'achat préparée n'a pas pu être créée : le parrain peut commander normalement.",
        actorAdminId: req.user?.id || null,
      }).catch(() => {});
    }

    const amount = new Intl.NumberFormat("fr-FR").format(settings.minPurchaseFcfa);
    await sponsorship.notifySms({
      to: row.mobile,
      countryCode: settings.countryCode,
      message: `FOREVER: bienvenue ${row.firstNames} ! Votre n° FBO est ${numero}. Premiere commande d'au moins ${amount} F a passer sous ${settings.purchaseWindowHours} h.`,
    });
    await sponsorship.notifySms({
      to: await sponsorship.findSponsorPhone(row),
      countryCode: settings.countryCode,
      message: `FOREVER: parrainage de ${row.firstNames} ${row.lastName} approuve, n° FBO ${numero}. Achat d'au moins ${amount} F sous ${settings.purchaseWindowHours} h pour le valider.`,
    });
    return res.json({
      ok: true,
      status: "APPROVED_PENDING_PURCHASE",
      recruitFboNumero: numero,
      purchaseDeadlineAt: deadline,
      purchasePreorderNumber: purchaseDraft?.preorder?.preorderNumber || null,
      purchaseAdjustments: purchaseDraft?.adjustments || [],
    });
  } catch (error) {
    return sendError(res, error, "approveSponsorship error:");
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

module.exports = {
  listSponsorships,
  getSponsorship,
  downloadSponsorshipDocument,
  requestChanges,
  rejectSponsorship,
  approveSponsorship,
  evaluateNow,
};
