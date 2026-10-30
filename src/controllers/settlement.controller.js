// Précommandes réglées par une autre filiale FLP (cf. settlement.service.js).
const prisma = require("../prisma");
const settlementService = require("../services/settlement.service");
const { publishRealtimeEvent } = require("../services/realtime-events.service");

// Rapport pour la filiale : responsables facturation, admins, finance,
// directeur commercial.
const SETTLEMENT_REPORT_ROLES = ["BILLING_MANAGER", "SUPER_ADMIN", "TECH_ADMIN", "FINANCE_MANAGER", "SALES_DIRECTOR"];

function countryIdOf(req) {
  return req.country?.id || req.countryId;
}

function sendError(res, e, label) {
  if (e.statusCode && e.statusCode < 500) return res.status(e.statusCode).json({ message: e.message });
  console.error(`${label} error:`, e);
  return res.status(500).json({ message: "Erreur serveur." });
}

// GET /api/admin/billing/settlements/entities
function listEntities(req, res) {
  return res.json({ ok: true, entities: Object.values(settlementService.SETTLEMENT_ENTITIES) });
}

// POST /api/admin/billing/settlements/mark { entity, text, reference }
async function markBatch(req, res) {
  try {
    const countryId = countryIdOf(req);
    const result = await settlementService.markPreordersForSettlement({
      countryId,
      entityCode: req.body?.entity,
      text: req.body?.text,
      reference: req.body?.reference,
      actorAdminId: req.user?.id || null,
    });
    for (const row of result.results) {
      if (row.outcome === "MARKED_AND_SETTLED") {
        publishRealtimeEvent({ countryId, eventKey: "cashier_launch_new", orderId: row.id, meta: { status: "PAID" } });
      }
    }
    return res.json({ ok: true, ...result });
  } catch (e) {
    return sendError(res, e, "settlement markBatch");
  }
}

// GET /api/admin/billing/settlements/pending?entity : commandes marquées, pas
// encore facturées.
async function listPending(req, res) {
  try {
    const entity = settlementService.getSettlementEntity(req.query.entity);
    const orders = await prisma.preorder.findMany({
      where: {
        countryId: countryIdOf(req),
        status: "SUBMITTED",
        settlementEntity: entity ? entity.code : { not: null },
      },
      orderBy: { settlementMarkedAt: "asc" },
      take: 500,
      select: {
        id: true,
        preorderNumber: true,
        fboNomComplet: true,
        fboNumero: true,
        totalFcfa: true,
        settlementEntity: true,
        settlementReference: true,
        settlementMarkedAt: true,
        assignedInvoicer: { select: { fullName: true, email: true } },
      },
    });
    return res.json({ ok: true, orders });
  } catch (e) {
    return sendError(res, e, "settlement listPending");
  }
}

// DELETE /api/admin/billing/settlements/:id : retrait du marquage (erreur).
async function unmark(req, res) {
  try {
    const saved = await settlementService.unmarkPreorderSettlement({
      countryId: countryIdOf(req),
      preorderId: req.params.id,
      actorAdminId: req.user?.id || null,
    });
    return res.json({ ok: true, id: saved.id });
  } catch (e) {
    return sendError(res, e, "settlement unmark");
  }
}

// GET /api/admin/billing/settlements/report?entity&from&to
async function getReport(req, res) {
  try {
    const report = await settlementService.buildSettlementReport({
      countryId: countryIdOf(req),
      entityCode: req.query.entity,
      from: req.query.from,
      to: req.query.to,
    });
    return res.json({ ok: true, ...report });
  } catch (e) {
    return sendError(res, e, "settlement getReport");
  }
}

module.exports = { SETTLEMENT_REPORT_ROLES, listEntities, markBatch, listPending, unmark, getReport };
