// Recouvrement des commandes traitées (supervision caisse, étape 2).
//
// Objectif fixé par la direction : que le plus grand nombre de commandes
// traitées (facturées) soient payées. Trois blocs :
// - par facturier : commandes traitées sur la période, payées, en attente,
//   annulées sans paiement, taux de recouvrement. Une commande reste chez le
//   facturier qui l'a traitée à l'origine, même relancée (invoicedById est
//   conservé à la relance depuis la PR #136) ;
// - « À recouvrer » (état actuel, toutes dates) : commandes facturées en
//   attente de paiement (renvoi de la notification), et commandes annulées
//   sans paiement aujourd'hui, encore relançables tant que l'agence est
//   ouverte (voir payment-followup.service.js) ;
// - efficacité des relances sur la période : commandes relancées et
//   notifications renvoyées, et combien ont été payées depuis.

const prisma = require("../prisma");
const { scopeWhere } = require("../helpers/countryScope");
const { timeZone } = require("./ticket-inventory.service");
const { getCashRegisterStatus } = require("./cash-register-closure.service");
const { localDate } = require("./payment-followup.service");

const PENDING_STATUSES = ["INVOICED", "PAYMENT_PENDING"];
const RELAUNCH_LOG_MODE = "ADMIN_RELAUNCH_PAYMENT_AFTER_AUTO_CANCEL";
const RELAUNCHABLE_CANCEL_MODE = "AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW";
const RELAUNCHABLE_CANCEL_SOURCE = "CASH_REGISTER_CLOSURE";
const LIST_LIMIT = 500;

const adminSelect = { select: { id: true, fullName: true, email: true } };

function amountOf(order) {
  return Number(order.as400InvoiceTotalFcfa ?? order.totalFcfa ?? 0) || 0;
}

function adminLabel(admin) {
  return admin ? admin.fullName || admin.email || "Non renseigné" : "Non attribué";
}

function orderOutcome(order) {
  if (String(order.paymentStatus || "").toUpperCase() === "PAID") return "paid";
  const status = String(order.status || "").toUpperCase();
  if (status === "CANCELLED") return "cancelled";
  if (PENDING_STATUSES.includes(status)) return "pending";
  return "other";
}

function emptyBucket() {
  return { count: 0, amountFcfa: 0 };
}

function addTo(bucket, order) {
  bucket.count += 1;
  bucket.amountFcfa += amountOf(order);
}

function withRates(stats) {
  const { processed, paid } = stats;
  return {
    ...stats,
    recoveryRate: processed.count ? Math.round((paid.count / processed.count) * 100) : null,
    amountRecoveryRate: processed.amountFcfa ? Math.round((paid.amountFcfa / processed.amountFcfa) * 100) : null,
  };
}

// Commandes traitées sur la période, par facturier d'origine.
function summarizeByInvoicer(orders) {
  const map = new Map();
  const totals = { processed: emptyBucket(), paid: emptyBucket(), pending: emptyBucket(), cancelled: emptyBucket() };
  for (const order of orders) {
    const key = order.invoicedById || "UNASSIGNED";
    const current = map.get(key) || {
      key,
      label: adminLabel(order.invoicedByAdmin),
      processed: emptyBucket(),
      paid: emptyBucket(),
      pending: emptyBucket(),
      cancelled: emptyBucket(),
    };
    const outcome = orderOutcome(order);
    for (const target of [current, totals]) {
      addTo(target.processed, order);
      if (target[outcome]) addTo(target[outcome], order);
    }
    map.set(key, current);
  }
  return {
    totals: withRates(totals),
    byInvoicer: [...map.values()]
      .map(withRates)
      .sort((a, b) => b.processed.count - a.processed.count),
  };
}

function cancelLogOf(order) {
  return (order.logs || []).find(
    (log) =>
      log.action === "CANCEL" &&
      (log.meta?.mode === RELAUNCHABLE_CANCEL_MODE || log.meta?.source === RELAUNCHABLE_CANCEL_SOURCE),
  );
}

function recoveryRow(order, kind) {
  return {
    kind,
    id: order.id,
    preorderNumber: order.preorderNumber,
    fboNumero: order.fboNumero,
    fboNomComplet: order.fboNomComplet,
    phone: order.factureWhatsappTo || null,
    status: order.status,
    paymentMode: order.preorderPaymentMode,
    bankPaymentStatus: order.bankPaymentStatus,
    amountFcfa: amountOf(order),
    factureReference: order.factureReference,
    invoicedAt: order.invoicedAt,
    paymentExpiresAt: order.paymentExpiresAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    lastNotificationStatus: order.lastWhatsappStatus || null,
    lastNotificationAt: order.lastWhatsappStatusAt || null,
    invoicer: order.invoicedByAdmin ? { id: order.invoicedByAdmin.id, label: adminLabel(order.invoicedByAdmin) } : null,
  };
}

const recoverySelect = {
  id: true,
  preorderNumber: true,
  fboNumero: true,
  fboNomComplet: true,
  factureWhatsappTo: true,
  status: true,
  paymentStatus: true,
  preorderPaymentMode: true,
  bankPaymentStatus: true,
  totalFcfa: true,
  as400InvoiceTotalFcfa: true,
  factureReference: true,
  invoicedAt: true,
  invoicedById: true,
  paymentExpiresAt: true,
  cancelledAt: true,
  cancelReason: true,
  lastWhatsappStatus: true,
  lastWhatsappStatusAt: true,
  invoicedByAdmin: adminSelect,
};

async function loadToRecover(req, { invoicerId, countryCode, now = new Date() }) {
  const zone = timeZone(String(countryCode || "").toUpperCase());
  const today = localDate(now, zone);
  const base = { isTest: false, settlementEntity: null, ...(invoicerId ? { invoicedById: invoicerId } : {}) };

  const [pending, cancelled, register] = await Promise.all([
    prisma.preorder.findMany({
      where: scopeWhere(req, { ...base, status: { in: PENDING_STATUSES }, paymentStatus: { not: "PAID" } }),
      select: recoverySelect,
      orderBy: { invoicedAt: "asc" },
      take: LIST_LIMIT,
    }),
    // Fenêtre large (36 h) puis filtre sur la date locale du pays.
    prisma.preorder.findMany({
      where: scopeWhere(req, {
        ...base,
        status: "CANCELLED",
        paymentStatus: { not: "PAID" },
        factureReference: { not: null },
        cancelledAt: { gte: new Date(now.getTime() - 36 * 3600 * 1000) },
      }),
      select: {
        ...recoverySelect,
        logs: { where: { action: "CANCEL" }, orderBy: { createdAt: "desc" }, take: 3, select: { action: true, meta: true } },
      },
      orderBy: { cancelledAt: "desc" },
      take: LIST_LIMIT,
    }),
    getCashRegisterStatus(req.country?.id || req.countryId, null),
  ]);

  const relaunchable = cancelled
    .filter((order) => order.cancelledAt && localDate(new Date(order.cancelledAt), zone) === today)
    .filter((order) => cancelLogOf(order))
    .map((order) => recoveryRow(order, "RELAUNCH"));

  return {
    agencyOpen: Boolean(register?.isOpen),
    pending: pending.map((order) => recoveryRow(order, "PENDING")),
    relaunchable,
  };
}

// Relances (relaunch-payment) et renvois de notification (resend-invoice-sms)
// faits sur la période, et leur résultat à ce jour.
async function loadRelaunchEffectiveness(req, { start, end }, { invoicerId }) {
  const countryId = req.country?.id || req.countryId;
  const preorderScope = {
    countryId,
    isTest: false,
    ...(invoicerId ? { invoicedById: invoicerId } : {}),
  };
  const logs = await prisma.preorderLog.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      preorder: preorderScope,
      OR: [
        { action: "PAYMENT_PENDING", meta: { path: ["mode"], equals: RELAUNCH_LOG_MODE } },
        // resendInvoiceSms : seule trace, la note du log.
        { action: "WAIT_CUSTOMER_DATA", note: { startsWith: "Notification de facture renvoyée" } },
      ],
    },
    select: {
      action: true,
      preorderId: true,
      actorAdmin: adminSelect,
      preorder: { select: { paymentStatus: true, totalFcfa: true, as400InvoiceTotalFcfa: true } },
    },
    take: 5000,
  });

  const summarize = (action) => {
    const byOrder = new Map();
    const byActor = new Map();
    for (const log of logs.filter((item) => item.action === action)) {
      byOrder.set(log.preorderId, log.preorder);
      const key = log.actorAdmin?.id || "SYSTEM";
      const actor = byActor.get(key) || { key, label: adminLabel(log.actorAdmin), count: 0 };
      actor.count += 1;
      byActor.set(key, actor);
    }
    const orders = [...byOrder.values()];
    const paid = orders.filter((order) => order.paymentStatus === "PAID");
    return {
      actions: logs.filter((item) => item.action === action).length,
      orders: orders.length,
      paidOrders: paid.length,
      paidAmountFcfa: paid.reduce((sum, order) => sum + amountOf(order), 0),
      successRate: orders.length ? Math.round((paid.length / orders.length) * 100) : null,
      byActor: [...byActor.values()].sort((a, b) => b.count - a.count),
    };
  };

  return { relaunches: summarize("PAYMENT_PENDING"), resends: summarize("WAIT_CUSTOMER_DATA") };
}

async function buildRecoveryReport(req, period, { invoicerId = null } = {}) {
  const processedOrders = prisma.preorder.findMany({
    where: scopeWhere(req, {
      isTest: false,
      // Réglées par une autre filiale : hors caisse, hors recouvrement.
      settlementEntity: null,
      invoicedAt: { gte: period.start, lte: period.end },
      ...(invoicerId ? { invoicedById: invoicerId } : {}),
    }),
    select: {
      status: true,
      paymentStatus: true,
      totalFcfa: true,
      as400InvoiceTotalFcfa: true,
      invoicedById: true,
      invoicedByAdmin: adminSelect,
    },
  });

  const [orders, toRecover, effectiveness] = await Promise.all([
    processedOrders,
    loadToRecover(req, { invoicerId, countryCode: req.country?.code }),
    loadRelaunchEffectiveness(req, period, { invoicerId }),
  ]);

  return { ...summarizeByInvoicer(orders), toRecover, effectiveness };
}

module.exports = {
  buildRecoveryReport,
  // exposés pour les tests
  summarizeByInvoicer,
  loadToRecover,
  orderOutcome,
};
