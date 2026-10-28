// src/services/billing-report.service.js
// Bilan d'activité d'un facturier (caissier) sur une période : dossiers reçus,
// facturés, payés, encaissés au comptoir, lancés en préparation, annulés.
// Calculé à partir des traces existantes (invoicedById, assignedInvoicerId,
// CashierTransaction.cashierId, preparationLaunchedById, PreorderLog) : aucune
// donnée propre au bilan n'est stockée.

const { Prisma } = require("@prisma/client");
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

// Commandes du pays avec leur facturier « propriétaire » : l'auteur de la
// PREMIÈRE facturation (log INVOICE), à défaut invoicedById. Une relance après
// annulation refacture la commande au nom de l'admin qui relance : sans cela,
// la commande sortirait du bilan du facturier d'origine.
function ownedOrdersCte(countryId) {
  return Prisma.sql`
    first_invoice AS (
      SELECT DISTINCT ON (l."preorderId") l."preorderId" AS id, l."actorAdminId" AS "invoicerId", l."createdAt" AS "invoicedOn"
      FROM "PreorderLog" l JOIN "Preorder" p0 ON p0.id = l."preorderId"
      WHERE p0."countryId" = ${countryId} AND l.action = 'INVOICE' AND l."actorAdminId" IS NOT NULL
      ORDER BY l."preorderId", l."createdAt"
    ),
    owned AS (
      SELECT p.id, p.status, p."paymentStatus", p."paidAt", p."cancelledAt", p."cancelledById", p."assignedInvoicerId",
        COALESCE(p."as400InvoiceTotalFcfa", p."totalFcfa", 0) AS amount,
        COALESCE(fi."invoicerId", p."invoicedById") AS owner,
        COALESCE(fi."invoicedOn", p."invoicedAt") AS "firstInvoicedAt"
      FROM "Preorder" p LEFT JOIN first_invoice fi ON fi.id = p.id
      WHERE p."countryId" = ${countryId}
    )`;
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

  const { start, end } = period;

  const [
    assignLogs,
    ownedFlags,
    counterTransactions,
    launched,
    releasedCount,
    escalatedCount,
    toInvoiceNow,
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
    // Ses commandes (cf. ownedOrdersCte) : facturées dans la période (première
    // facturation), payées dans la période (lien Wave, caisse, virement),
    // annulées dans la période — hors commandes payées malgré l'annulation —
    // et en attente de paiement à l'instant.
    prisma.$queryRaw`
      WITH ${ownedOrdersCte(countryId)}
      SELECT * FROM (
        SELECT id,
          (owner = ${userId} AND "firstInvoicedAt" BETWEEN ${start} AND ${end}) AS invoiced,
          ("paymentStatus" = 'PAID' AND "paidAt" BETWEEN ${start} AND ${end}) AS paid,
          (owner = ${userId} AND status = 'CANCELLED' AND "paymentStatus" <> 'PAID'
            AND "cancelledAt" BETWEEN ${start} AND ${end}) AS cancelled,
          (status IN ('INVOICED', 'PAYMENT_PENDING')) AS waiting
        FROM owned
        WHERE COALESCE(owner, "assignedInvoicerId") = ${userId}
      ) t
      WHERE invoiced OR paid OR cancelled OR waiting`,
    // Encaissements faits par lui au comptoir.
    prisma.cashierTransaction.findMany({
      where: { cashierId: userId, createdAt: inPeriod, preorder: mine },
      select: { paymentMode: true, amountExpectedFcfa: true, amountReceivedFcfa: true, preorderId: true },
    }),
    prisma.preorder.findMany({
      where: { ...mine, preparationLaunchedById: userId, preparationLaunchedAt: inPeriod },
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
  ]);

  const ownedOrders = await prisma.preorder.findMany({
    where: { id: { in: ownedFlags.map((row) => row.id) } },
    select: ORDER_SELECT,
  });
  const orderById = new Map(ownedOrders.map((order) => [order.id, order]));
  const flagged = (flag) => ownedFlags.filter((row) => row[flag]).map((row) => orderById.get(row.id)).filter(Boolean);
  const invoiced = flagged("invoiced");
  const paid = flagged("paid");
  const cancelled = flagged("cancelled");
  const waitingPaymentNow = flagged("waiting");

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

// Supervision : une ligne par facturier du pays (facturiers caissiers et
// facturiers), mêmes indicateurs que buildInvoicerReport mais agrégés en
// quelques requêtes groupées, plus l'état de la file et la dernière activité.
async function buildSupervisionReport({ countryId, from, to, connectedUserIds = [], maxActive }) {
  const period = parseReportPeriod({ from, to });
  const { start, end } = period;

  const invoicers = await prisma.adminUser.findMany({
    where: { countryId, actif: true, role: { in: ["FACTURIER_CAISSIER", "INVOICER"] } },
    select: { id: true, fullName: true, email: true, role: true, lastLoginAt: true },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
  });
  const ids = invoicers.map((admin) => admin.id);
  if (!ids.length) {
    return { period: { from: period.from, to: period.to }, invoicers: [], queue: await loadQueueState(countryId) };
  }

  const [received, owned, counter, launched, toInvoice, lastLog, lastCounter, queue] =
    await Promise.all([
      prisma.$queryRaw`
        SELECT l.meta->>'assignedInvoicerId' AS id, COUNT(DISTINCT l."preorderId")::int AS count
        FROM "PreorderLog" l JOIN "Preorder" p ON p.id = l."preorderId"
        WHERE p."countryId" = ${countryId} AND l.action = 'ASSIGN_INVOICER'
          AND l."createdAt" BETWEEN ${start} AND ${end}
          AND l.meta->>'assignedInvoicerId' IN (${Prisma.join(ids)})
        GROUP BY 1`,
      // Facturées, payées, annulées et en attente de paiement : mêmes règles que
      // buildInvoicerReport (facturier de la première facturation, cf.
      // ownedOrdersCte ; à défaut, facturier attribué).
      prisma.$queryRaw`
        WITH ${ownedOrdersCte(countryId)}
        SELECT COALESCE(owner, "assignedInvoicerId") AS id,
          COUNT(*) FILTER (WHERE owner IS NOT NULL AND "firstInvoicedAt" BETWEEN ${start} AND ${end})::int AS "invoicedCount",
          COALESCE(SUM(amount) FILTER (WHERE owner IS NOT NULL AND "firstInvoicedAt" BETWEEN ${start} AND ${end}), 0)::bigint AS "invoicedAmount",
          COUNT(*) FILTER (WHERE "paymentStatus" = 'PAID' AND "paidAt" BETWEEN ${start} AND ${end})::int AS "paidCount",
          COALESCE(SUM(amount) FILTER (WHERE "paymentStatus" = 'PAID' AND "paidAt" BETWEEN ${start} AND ${end}), 0)::bigint AS "paidAmount",
          COUNT(*) FILTER (WHERE owner IS NOT NULL AND status = 'CANCELLED' AND "paymentStatus" <> 'PAID'
            AND "cancelledAt" BETWEEN ${start} AND ${end})::int AS "cancelledCount",
          COUNT(*) FILTER (WHERE owner IS NOT NULL AND status = 'CANCELLED' AND "paymentStatus" <> 'PAID'
            AND "cancelledAt" BETWEEN ${start} AND ${end} AND "cancelledById" IS NULL)::int AS "expiredCount",
          COUNT(*) FILTER (WHERE status IN ('INVOICED', 'PAYMENT_PENDING'))::int AS "waitingCount",
          COALESCE(SUM(amount) FILTER (WHERE status IN ('INVOICED', 'PAYMENT_PENDING')), 0)::bigint AS "waitingAmount"
        FROM owned
        WHERE COALESCE(owner, "assignedInvoicerId") IN (${Prisma.join(ids)})
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT t."cashierId" AS id, COUNT(*)::int AS count,
          SUM(COALESCE(t."amountReceivedFcfa", t."amountExpectedFcfa", 0))::bigint AS amount
        FROM "CashierTransaction" t JOIN "Preorder" p ON p.id = t."preorderId"
        WHERE p."countryId" = ${countryId} AND t."createdAt" BETWEEN ${start} AND ${end}
          AND t."cashierId" IN (${Prisma.join(ids)})
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT p."preparationLaunchedById" AS id, COUNT(*)::int AS count
        FROM "Preorder" p
        WHERE p."countryId" = ${countryId} AND p."preparationLaunchedAt" BETWEEN ${start} AND ${end}
          AND p."preparationLaunchedById" IN (${Prisma.join(ids)})
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT p."assignedInvoicerId" AS id, COUNT(*)::int AS count
        FROM "Preorder" p
        WHERE p."countryId" = ${countryId} AND p.status = 'SUBMITTED'
          AND p."billingWorkStatus" IN ('ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER_DATA')
          AND p."assignedInvoicerId" IN (${Prisma.join(ids)})
        GROUP BY 1`,
      // Dernière action tracée (facturation, encaissement, préparation…).
      prisma.$queryRaw`
        SELECT l."actorAdminId" AS id, MAX(l."createdAt") AS at
        FROM "PreorderLog" l
        WHERE l."actorAdminId" IN (${Prisma.join(ids)}) AND l."createdAt" > NOW() - INTERVAL '31 days'
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT t."cashierId" AS id, MAX(t."createdAt") AS at
        FROM "CashierTransaction" t
        WHERE t."cashierId" IN (${Prisma.join(ids)}) AND t."createdAt" > NOW() - INTERVAL '31 days'
        GROUP BY 1`,
      loadQueueState(countryId),
    ]);

  const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
  const maps = {
    received: byId(received),
    owned: byId(owned),
    counter: byId(counter),
    launched: byId(launched),
    toInvoice: byId(toInvoice),
    lastLog: byId(lastLog),
    lastCounter: byId(lastCounter),
  };
  const connected = new Set(connectedUserIds.map(String));
  const n = (value) => Number(value || 0);

  const rows = invoicers.map((admin) => {
    const pick = (key) => maps[key].get(admin.id) || {};
    const activity = [pick("lastLog").at, pick("lastCounter").at].filter(Boolean).map((d) => new Date(d));
    const own = pick("owned");
    return {
      ...admin,
      connected: connected.has(admin.id),
      autoDispatch: admin.role === "FACTURIER_CAISSIER",
      lastActivityAt: activity.length ? new Date(Math.max(...activity)).toISOString() : null,
      load: n(pick("toInvoice").count),
      maxActive,
      waitingPayment: { count: n(own.waitingCount), amountFcfa: n(own.waitingAmount) },
      received: n(pick("received").count),
      invoiced: { count: n(own.invoicedCount), amountFcfa: n(own.invoicedAmount) },
      paid: { count: n(own.paidCount), amountFcfa: n(own.paidAmount) },
      counter: { count: n(pick("counter").count), amountFcfa: n(pick("counter").amount) },
      preparationLaunched: n(pick("launched").count),
      cancelled: { count: n(own.cancelledCount), expiredCount: n(own.expiredCount) },
    };
  });

  const total = (pickValue) => rows.reduce((sum, row) => sum + pickValue(row), 0);
  return {
    period: { from: period.from, to: period.to },
    queue,
    totals: {
      connected: rows.filter((row) => row.connected).length,
      load: total((row) => row.load),
      waitingPayment: total((row) => row.waitingPayment.count),
      invoiced: { count: total((row) => row.invoiced.count), amountFcfa: total((row) => row.invoiced.amountFcfa) },
      paid: { count: total((row) => row.paid.count), amountFcfa: total((row) => row.paid.amountFcfa) },
      counter: { count: total((row) => row.counter.count), amountFcfa: total((row) => row.counter.amountFcfa) },
      preparationLaunched: total((row) => row.preparationLaunched),
      cancelled: total((row) => row.cancelled.count),
    },
    invoicers: rows,
  };
}

// File de facturation : dossiers en attente d'attribution et urgences.
async function loadQueueState(countryId) {
  const [waiting, oldest, escalated] = await Promise.all([
    prisma.preorder.count({
      where: { countryId, status: "SUBMITTED", assignedInvoicerId: null, billingWorkStatus: { in: ["QUEUED", "RELEASED"] } },
    }),
    prisma.preorder.findFirst({
      where: { countryId, status: "SUBMITTED", assignedInvoicerId: null, billingWorkStatus: { in: ["QUEUED", "RELEASED"] } },
      orderBy: { submittedAt: "asc" },
      select: { submittedAt: true },
    }),
    prisma.preorder.count({ where: { countryId, billingWorkStatus: "ESCALATED", status: { not: "CANCELLED" } } }),
  ]);
  return { unassigned: waiting, oldestSubmittedAt: oldest?.submittedAt || null, escalated };
}

module.exports = { buildInvoicerReport, buildSupervisionReport, parseReportPeriod };
