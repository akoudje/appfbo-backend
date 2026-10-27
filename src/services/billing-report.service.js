// src/services/billing-report.service.js
// Bilan d'activité d'un facturier (caissier) sur une période : dossiers reçus,
// facturés, payés, encaissés au comptoir, lancés en préparation, annulés.
// Calculé à partir des traces existantes (invoicedById, assignedInvoicerId,
// CashierTransaction.cashierId, preparationLaunchedById, PreorderLog) : aucune
// donnée propre au bilan n'est stockée.

const prisma = require("../prisma");

const MAX_DAYS = 92;
const DETAIL_LIMIT = 500;

// Période en jours calendaires (UTC = heure d'Abidjan), bornes incluses.
function parseReportPeriod({ from, to }) {
  const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  const today = new Date().toISOString().slice(0, 10);
  const fromDay = isDay(from) ? from : today;
  const toDay = isDay(to) ? to : fromDay;
  const start = new Date(`${fromDay}T00:00:00.000Z`);
  const end = new Date(`${toDay}T23:59:59.999Z`);
  if (end < start) {
    const error = new Error("La date de fin précède la date de début.");
    error.statusCode = 400;
    throw error;
  }
  if ((end - start) / 86400000 > MAX_DAYS) {
    const error = new Error(`Période limitée à ${MAX_DAYS} jours.`);
    error.statusCode = 400;
    throw error;
  }
  return { start, end, from: fromDay, to: toDay };
}

// Montant de référence d'une commande : montant certifié AS400, sinon total.
function orderAmount(order) {
  return Number(order.as400InvoiceTotalFcfa ?? order.totalFcfa ?? 0);
}

function sumBy(rows, pick) {
  return rows.reduce((sum, row) => sum + Number(pick(row) || 0), 0);
}

function groupAmounts(rows, keyOf, amountOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) || "AUTRE";
    const current = groups.get(key) || { mode: key, count: 0, amountFcfa: 0 };
    current.count += 1;
    current.amountFcfa += Number(amountOf(row) || 0);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.amountFcfa - a.amountFcfa);
}

const ORDER_SELECT = {
  id: true,
  preorderNumber: true,
  fboNomComplet: true,
  fboNumero: true,
  status: true,
  paymentStatus: true,
  preorderPaymentMode: true,
  paymentProvider: true,
  factureReference: true,
  totalFcfa: true,
  as400InvoiceTotalFcfa: true,
  submittedAt: true,
  invoicedAt: true,
  paidAt: true,
  preparationLaunchedAt: true,
  cancelledAt: true,
  cancelledById: true,
  cancelReason: true,
  isTest: true,
};

async function buildInvoicerReport({ countryId, userId, from, to }) {
  const period = parseReportPeriod({ from, to });
  const inPeriod = { gte: period.start, lte: period.end };
  // Les commandes de test (isTest) restent comptées, et repérées dans le détail.
  const mine = { countryId };

  const [
    assignLogs,
    invoiced,
    paid,
    counterTransactions,
    launched,
    cancelled,
    releasedCount,
    escalatedCount,
    toInvoiceNow,
    waitingPaymentNow,
  ] = await Promise.all([
    prisma.preorderLog.findMany({
      where: {
        action: "ASSIGN_INVOICER",
        createdAt: inPeriod,
        meta: { path: ["assignedInvoicerId"], equals: userId },
        preorder: mine,
      },
      select: { preorderId: true },
    }),
    prisma.preorder.findMany({
      where: { ...mine, invoicedById: userId, invoicedAt: inPeriod },
      select: ORDER_SELECT,
    }),
    // Payées dans la période parmi ses dossiers (lien Wave, caisse, virement).
    prisma.preorder.findMany({
      where: {
        ...mine,
        paymentStatus: "PAID",
        paidAt: inPeriod,
        OR: [{ invoicedById: userId }, { assignedInvoicerId: userId }],
      },
      select: ORDER_SELECT,
    }),
    // Encaissements faits par lui au comptoir.
    prisma.cashierTransaction.findMany({
      where: { cashierId: userId, createdAt: inPeriod, preorder: mine },
      select: { paymentMode: true, amountExpectedFcfa: true, amountReceivedFcfa: true, preorderId: true },
    }),
    prisma.preorder.findMany({
      where: { ...mine, preparationLaunchedById: userId, preparationLaunchedAt: inPeriod },
      select: ORDER_SELECT,
    }),
    // Annulées dans la période parmi les commandes qu'il a facturées.
    prisma.preorder.findMany({
      where: { ...mine, invoicedById: userId, status: "CANCELLED", cancelledAt: inPeriod },
      select: ORDER_SELECT,
    }),
    prisma.preorderLog.count({
      where: { action: "RELEASE_INVOICER", actorAdminId: userId, createdAt: inPeriod, preorder: mine },
    }),
    prisma.preorderLog.count({
      where: { action: "ESCALATE_BILLING", actorAdminId: userId, createdAt: inPeriod, preorder: mine },
    }),
    prisma.preorder.count({
      where: {
        ...mine,
        assignedInvoicerId: userId,
        status: "SUBMITTED",
        billingWorkStatus: { in: ["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA"] },
      },
    }),
    prisma.preorder.findMany({
      where: {
        ...mine,
        status: { in: ["INVOICED", "PAYMENT_PENDING"] },
        OR: [{ invoicedById: userId }, { assignedInvoicerId: userId }],
      },
      select: ORDER_SELECT,
    }),
  ]);

  const counterAmount = (tx) => tx.amountReceivedFcfa ?? tx.amountExpectedFcfa;
  // Annulation sans auteur : expiration automatique faute de paiement.
  const expired = cancelled.filter((order) => !order.cancelledById);

  // Détail : chaque commande touchée dans la période, avec ce qui s'y est passé.
  const detail = new Map();
  const touch = (order, event) => {
    const row = detail.get(order.id) || { ...order, amountFcfa: orderAmount(order), events: [] };
    if (!row.events.includes(event)) row.events.push(event);
    detail.set(order.id, row);
  };
  invoiced.forEach((order) => touch(order, "FACTUREE"));
  paid.forEach((order) => touch(order, "PAYEE"));
  launched.forEach((order) => touch(order, "PREPARATION"));
  cancelled.forEach((order) => touch(order, order.cancelledById ? "ANNULEE" : "EXPIREE"));
  const detailRows = [...detail.values()]
    .sort((a, b) => String(b.invoicedAt || b.paidAt || "").localeCompare(String(a.invoicedAt || a.paidAt || "")))
    .slice(0, DETAIL_LIMIT);

  return {
    period: { from: period.from, to: period.to },
    received: { count: new Set(assignLogs.map((log) => log.preorderId)).size },
    invoiced: { count: invoiced.length, amountFcfa: sumBy(invoiced, orderAmount) },
    paid: {
      count: paid.length,
      amountFcfa: sumBy(paid, orderAmount),
      byMode: groupAmounts(paid, (order) => order.paymentProvider || order.preorderPaymentMode, orderAmount),
    },
    counter: {
      count: counterTransactions.length,
      amountFcfa: sumBy(counterTransactions, counterAmount),
      byMode: groupAmounts(counterTransactions, (tx) => tx.paymentMode, counterAmount),
    },
    preparationLaunched: { count: launched.length, amountFcfa: sumBy(launched, orderAmount) },
    cancelled: {
      count: cancelled.length,
      amountFcfa: sumBy(cancelled, orderAmount),
      expiredCount: expired.length,
    },
    released: { count: releasedCount },
    escalated: { count: escalatedCount },
    now: {
      toInvoice: toInvoiceNow,
      waitingPayment: { count: waitingPaymentNow.length, amountFcfa: sumBy(waitingPaymentNow, orderAmount) },
    },
    orders: detailRows,
    ordersTruncated: detail.size > DETAIL_LIMIT,
  };
}

module.exports = { buildInvoicerReport, parseReportPeriod };
