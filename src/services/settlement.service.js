// src/services/settlement.service.js
// Précommandes réglées par une autre filiale FLP (ex. FLP Burkina) : le client
// commande dans l'app comme les autres, la commande est facturée au prix du
// pays, préparée et retirée ici par son représentant, mais payée au siège de
// la filiale (paiement confirmé d'avance par la comptabilité).
//
// - le facturier colle la liste de n° de précommande transmise par le client :
//   les commandes sont marquées (settlementEntity) ;
// - à la facturation, une commande marquée passe directement en PAID, sans
//   lien de paiement ni SMS (invoiceAndSendPreorder) ; marquée après coup,
//   une commande déjà facturée est réglée tout de suite ;
// - hors caisse : aucune CashierTransaction, exclue de la clôture de caisse.
//   C'est une créance sur la filiale, suivie par le rapport ci-dessous.

const prisma = require("../prisma");
const { parseReportPeriod } = require("./billing-report.service");

const SETTLEMENT_ENTITIES = {
  FLP_BURKINA: { code: "FLP_BURKINA", label: "FLP Burkina Faso" },
};

const PREORDER_NUMBER_PATTERN = /PO-[A-Z]{3}-\d{8}-\d{4}/gi;
const MAX_BATCH = 200;
const REPORT_LIMIT = 2000;

function getSettlementEntity(code) {
  return SETTLEMENT_ENTITIES[String(code || "").trim().toUpperCase()] || null;
}

function settlementLabel(code) {
  return getSettlementEntity(code)?.label || String(code || "");
}

function requireEntity(code) {
  const entity = getSettlementEntity(code);
  if (!entity) {
    const error = new Error("Filiale de règlement inconnue.");
    error.statusCode = 400;
    throw error;
  }
  return entity;
}

// Extrait les n° de précommande d'un texte libre (liste collée depuis un
// message, un mail, un tableur) : séparateurs indifférents, doublons retirés.
function parsePreorderNumbers(text) {
  const raw = String(text || "");
  const numbers = [...new Set((raw.match(PREORDER_NUMBER_PATTERN) || []).map((n) => n.toUpperCase()))];
  const leftover = raw
    .replace(PREORDER_NUMBER_PATTERN, " ")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return { numbers, unrecognized: [...new Set(leftover)] };
}

// Données d'une commande réglée par la filiale : payée, dossier de
// facturation clos, aucune échéance de paiement (pas d'annulation auto).
function settledPreorderData(order, now) {
  return {
    status: "PAID",
    paymentStatus: "PAID",
    paymentProvider: "MANUAL",
    paidAt: order.paidAt || now,
    paymentExpiresAt: null,
    manualPaymentReference: order.settlementReference || order.manualPaymentReference || null,
    activePaymentId: null,
    billingWorkStatus: "COMPLETED",
    billingCompletedAt: order.billingCompletedAt || now,
    billingLastActivityAt: now,
  };
}

async function logSettlementPaymentTx(tx, order, actorAdminId) {
  await tx.preorderLog.create({
    data: {
      preorderId: order.id,
      action: "PAYMENT_CONFIRMED",
      note: `Réglée par ${settlementLabel(order.settlementEntity)} (hors caisse).`,
      meta: {
        settlementEntity: order.settlementEntity,
        settlementReference: order.settlementReference || null,
        paymentProvider: "MANUAL",
        paymentStatus: "PAID",
      },
      actorAdminId: actorAdminId || null,
    },
  });
}

// Règle une commande déjà facturée (INVOICED / PAYMENT_PENDING) marquée après
// coup : les paiements en cours (lien Wave…) sont annulés.
async function settleInvoicedPreorderTx(tx, order, { now, actorAdminId }) {
  await tx.payment.updateMany({
    where: {
      preorderId: order.id,
      status: { notIn: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"] },
    },
    data: { status: "CANCELLED", cancelledAt: now },
  });
  const saved = await tx.preorder.update({
    where: { id: order.id },
    data: settledPreorderData(order, now),
  });
  await logSettlementPaymentTx(tx, order, actorAdminId);
  return saved;
}

const MARKABLE_STATUSES = ["SUBMITTED", "INVOICED", "PAYMENT_PENDING"];

async function markPreordersForSettlement({ countryId, entityCode, text, reference, actorAdminId }) {
  const entity = requireEntity(entityCode);
  const { numbers, unrecognized } = parsePreorderNumbers(text);
  if (!numbers.length) {
    const error = new Error("Aucun numéro de précommande reconnu (format PO-CIV-AAAAMMJJ-NNNN).");
    error.statusCode = 400;
    throw error;
  }
  if (numbers.length > MAX_BATCH) {
    const error = new Error(`Lot limité à ${MAX_BATCH} précommandes.`);
    error.statusCode = 400;
    throw error;
  }
  const settlementReference = String(reference || "").trim() || null;

  const orders = await prisma.preorder.findMany({
    where: { countryId, preorderNumber: { in: numbers } },
    select: {
      id: true,
      preorderNumber: true,
      status: true,
      paymentStatus: true,
      fboNomComplet: true,
      fboNumero: true,
      totalFcfa: true,
      as400InvoiceTotalFcfa: true,
      settlementEntity: true,
      settlementReference: true,
      paidAt: true,
      manualPaymentReference: true,
      billingCompletedAt: true,
    },
  });
  const byNumber = new Map(orders.map((order) => [order.preorderNumber, order]));
  const results = [];

  for (const number of numbers) {
    const order = byNumber.get(number);
    const base = {
      preorderNumber: number,
      id: order?.id || null,
      fboNomComplet: order?.fboNomComplet || null,
      fboNumero: order?.fboNumero || null,
      amountFcfa: order ? Number(order.as400InvoiceTotalFcfa ?? order.totalFcfa ?? 0) : null,
      status: order?.status || null,
    };
    if (!order) {
      results.push({ ...base, outcome: "NOT_FOUND" });
      continue;
    }
    if (order.settlementEntity === entity.code) {
      results.push({ ...base, outcome: "ALREADY_MARKED" });
      continue;
    }
    if (order.settlementEntity) {
      results.push({ ...base, outcome: "OTHER_ENTITY", detail: settlementLabel(order.settlementEntity) });
      continue;
    }
    if (order.status === "CANCELLED") {
      results.push({ ...base, outcome: "CANCELLED" });
      continue;
    }
    if (order.paymentStatus === "PAID" || !MARKABLE_STATUSES.includes(order.status)) {
      results.push({ ...base, outcome: order.paymentStatus === "PAID" ? "ALREADY_PAID" : "NOT_MARKABLE" });
      continue;
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      // Garde : le statut peut avoir changé depuis la lecture (paiement Wave
      // arrivé, annulation…).
      const marked = await tx.preorder.updateMany({
        where: { id: order.id, settlementEntity: null, status: order.status, paymentStatus: { not: "PAID" } },
        data: {
          settlementEntity: entity.code,
          settlementReference,
          settlementMarkedAt: now,
          settlementMarkedById: actorAdminId || null,
        },
      });
      if (marked.count !== 1) return null;

      await tx.preorderLog.create({
        data: {
          preorderId: order.id,
          action: "SETTLEMENT_MARKED",
          note: `Réglée par ${entity.label}${settlementReference ? ` (réf. ${settlementReference})` : ""}.`,
          meta: { settlementEntity: entity.code, settlementReference, fromStatus: order.status },
          actorAdminId: actorAdminId || null,
        },
      });

      if (order.status === "SUBMITTED") return { status: "SUBMITTED" };
      return settleInvoicedPreorderTx(
        tx,
        { ...order, settlementEntity: entity.code, settlementReference },
        { now, actorAdminId },
      );
    });

    if (!updated) {
      results.push({ ...base, outcome: "CHANGED" });
    } else {
      results.push({
        ...base,
        status: updated.status,
        outcome: order.status === "SUBMITTED" ? "MARKED" : "MARKED_AND_SETTLED",
      });
    }
  }

  return { entity, results, unrecognized };
}

// Retrait du marquage (erreur de saisie) : seulement tant que la commande
// n'est pas facturée.
async function unmarkPreorderSettlement({ countryId, preorderId, actorAdminId }) {
  const order = await prisma.preorder.findFirst({
    where: { id: preorderId, countryId },
    select: { id: true, status: true, settlementEntity: true, settlementReference: true },
  });
  if (!order || !order.settlementEntity) {
    const error = new Error("Commande introuvable ou non marquée.");
    error.statusCode = 404;
    throw error;
  }
  if (order.status !== "SUBMITTED") {
    const error = new Error("La commande est déjà facturée : le règlement par la filiale ne peut plus être retiré.");
    error.statusCode = 400;
    throw error;
  }
  return prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: order.id },
      data: { settlementEntity: null, settlementReference: null, settlementMarkedAt: null, settlementMarkedById: null },
    });
    await tx.preorderLog.create({
      data: {
        preorderId: order.id,
        action: "SETTLEMENT_UNMARKED",
        note: `Règlement par ${settlementLabel(order.settlementEntity)} retiré.`,
        meta: { settlementEntity: order.settlementEntity, settlementReference: order.settlementReference },
        actorAdminId: actorAdminId || null,
      },
    });
    return saved;
  });
}

function settlementStage(order) {
  if (order.status === "CANCELLED") return "ANNULEE";
  if (order.status === "FULFILLED") return "REMISE";
  if (order.status === "READY") return "PRETE";
  if (order.preparationLaunchedAt) return "EN_PREPARATION";
  if (order.paymentStatus === "PAID") return "FACTUREE";
  return "A_FACTURER";
}

// Rapport pour la filiale : commandes réglées (facturées) dans la période,
// plus celles reçues dans la période et pas encore facturées. Montant dû =
// commandes facturées non annulées.
async function buildSettlementReport({ countryId, entityCode, from, to }) {
  const entity = requireEntity(entityCode);
  const period = parseReportPeriod({ from, to });
  const inPeriod = { gte: period.start, lte: period.end };

  const where = {
    countryId,
    isTest: false,
    settlementEntity: entity.code,
    OR: [{ paidAt: inPeriod }, { paidAt: null, settlementMarkedAt: inPeriod }],
  };
  const [orders, toInvoiceNow] = await Promise.all([
    prisma.preorder.findMany({
      where,
      orderBy: [{ paidAt: "asc" }, { settlementMarkedAt: "asc" }],
      take: REPORT_LIMIT,
      select: {
        id: true,
        preorderNumber: true,
        fboNomComplet: true,
        fboNumero: true,
        factureReference: true,
        status: true,
        paymentStatus: true,
        totalFcfa: true,
        as400InvoiceTotalFcfa: true,
        settlementReference: true,
        settlementMarkedAt: true,
        paidAt: true,
        preparationLaunchedAt: true,
        preparedAt: true,
        fulfilledAt: true,
        cancelledAt: true,
        cancelReason: true,
        pickupRecipientName: true,
        parcelNumber: true,
        invoicedByAdmin: { select: { fullName: true, email: true } },
      },
    }),
    prisma.preorder.count({
      where: { countryId, isTest: false, settlementEntity: entity.code, status: "SUBMITTED" },
    }),
  ]);

  const rows = orders.map((order) => ({
    ...order,
    amountFcfa: Number(order.as400InvoiceTotalFcfa ?? order.totalFcfa ?? 0),
    stage: settlementStage(order),
    invoicedBy: order.invoicedByAdmin?.fullName || order.invoicedByAdmin?.email || null,
    invoicedByAdmin: undefined,
  }));
  const sum = (list) => list.reduce((total, row) => total + row.amountFcfa, 0);
  const due = rows.filter((row) => row.paymentStatus === "PAID" && row.status !== "CANCELLED");
  const pending = rows.filter((row) => row.stage === "A_FACTURER");
  const count = (stage) => rows.filter((row) => row.stage === stage).length;

  return {
    entity,
    period: { from: period.from, to: period.to },
    totals: {
      orders: rows.length,
      due: { count: due.length, amountFcfa: sum(due) },
      toInvoice: { count: pending.length, amountFcfa: sum(pending) },
      byStage: {
        A_FACTURER: count("A_FACTURER"),
        FACTUREE: count("FACTUREE"),
        EN_PREPARATION: count("EN_PREPARATION"),
        PRETE: count("PRETE"),
        REMISE: count("REMISE"),
        ANNULEE: count("ANNULEE"),
      },
    },
    toInvoiceNow,
    rows,
    rowsTruncated: rows.length >= REPORT_LIMIT,
  };
}

module.exports = {
  SETTLEMENT_ENTITIES,
  getSettlementEntity,
  settlementLabel,
  parsePreorderNumbers,
  settledPreorderData,
  logSettlementPaymentTx,
  markPreordersForSettlement,
  unmarkPreorderSettlement,
  buildSettlementReport,
};
