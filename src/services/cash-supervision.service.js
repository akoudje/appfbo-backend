// Point de caisse : tous les encaissements de la plateforme sur une période,
// quelle que soit leur source.
//
// Règles validées le 30/10/2026 avec la direction :
// - précommandes (achats de parrainage compris) : l'encaissement est
//   attribué au facturier qui a facturé (invoicedById), quel que soit le
//   moyen de paiement ; le caissier qui a validé reste indiqué à part ;
// - billets d'événement ;
// - liens de paiement hors précommande (formulaire QR ou lien créé par un
//   admin, attribué à son créateur) ;
// - frais d'expédition (lien de paiement rattaché à une précommande).
// Les liens hors précommande et les frais d'expédition sont présentés à part.
//
// Montant et moyen de paiement d'une précommande : mêmes règles que les
// clôtures de caisse (cashClosures.controller.js), pour que le point de
// caisse et les clôtures donnent les mêmes chiffres. Le montant encaissé
// inclut les frais de service Wave, isolés dans serviceFeeFcfa.

const prisma = require("../prisma");
const { scopeWhere } = require("../helpers/countryScope");
const {
  resolveOrderPaymentMode,
  resolveOrderExpectedAmount,
  paymentModeLabel,
} = require("../controllers/admin/cashClosures.controller");

const DETAIL_ROWS_LIMIT = 10000;

const SOURCES = {
  PREORDER: "Précommandes",
  TICKET: "Billets d'événement",
  EXTERNAL_LINK: "Liens hors précommande",
  SHIPPING: "Frais d'expédition",
};

// Billets réglés sans argent frais : gratuits ou payés avec un avoir billet.
const NON_CASH_TICKET_METHODS = ["FREE", "TICKET_CREDIT"];

const adminSelect = { select: { id: true, fullName: true, email: true, role: true } };

function toAmount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function formatAdmin(admin) {
  if (!admin) return null;
  return { id: admin.id, label: admin.fullName || admin.email || admin.role || "Non renseigné" };
}

function normalizeMode(value) {
  return String(value || "").trim().toUpperCase() || "UNKNOWN";
}

function normalizeFilters(query = {}) {
  const pick = (value) => String(value || "").trim() || null;
  const source = pick(query.source)?.toUpperCase() || null;
  return {
    paymentMode: pick(query.paymentMode)?.toUpperCase() || null,
    invoicerId: pick(query.invoicerId),
    source: source && SOURCES[source] ? source : null,
  };
}

function paidWindow(start, end) {
  return { gte: start, lte: end };
}

function preorderRow(order) {
  const amountFcfa = resolveOrderExpectedAmount(order);
  const baseAmountFcfa = toAmount(order.as400InvoiceTotalFcfa || order.totalFcfa);
  return {
    source: "PREORDER",
    id: order.id,
    reference: order.preorderNumber,
    customer: [order.fboNumero, order.fboNomComplet].filter(Boolean).join(" · ") || null,
    detail: order.factureReference ? `Facture AS400 ${order.factureReference}` : null,
    paymentMode: resolveOrderPaymentMode(order),
    paidAt:
      order.manualPaymentValidatedAt ||
      order.paidAt ||
      order.activePayment?.paidAt ||
      null,
    amountFcfa,
    baseAmountFcfa,
    serviceFeeFcfa: Math.max(0, amountFcfa - baseAmountFcfa),
    packagingFcfa: toAmount(order.emballageFcfa),
    invoicer: formatAdmin(order.invoicedByAdmin),
    cashier: formatAdmin(order.manualPaymentValidatedBy),
  };
}

function ticketRow(order) {
  const amountFcfa = toAmount(order.amountToPayFcfa ?? order.totalFcfa);
  return {
    source: "TICKET",
    id: order.id,
    reference: order.orderNumber,
    customer: [order.buyerFboNumber, order.buyerFullName].filter(Boolean).join(" · ") || null,
    detail: [order.event?.title, order.quantity ? `${order.quantity} billet(s)` : null]
      .filter(Boolean)
      .join(" · "),
    eventId: order.eventId,
    eventTitle: order.event?.title || null,
    quantity: order.quantity || 0,
    paymentMode: normalizeMode(order.paymentMethod || order.paymentProvider),
    paidAt: order.paidAt,
    amountFcfa,
    baseAmountFcfa: toAmount(order.totalFcfa),
    serviceFeeFcfa: toAmount(order.paymentServiceFeeFcfa),
    packagingFcfa: 0,
    invoicer: null,
    cashier: null,
  };
}

function linkRow(link) {
  const isShipping = Boolean(link.shippingOrder);
  const amountFcfa = toAmount(link.amountFcfa);
  return {
    source: isShipping ? "SHIPPING" : "EXTERNAL_LINK",
    id: link.id,
    reference: isShipping ? link.shippingOrder.preorderNumber : link.reference,
    customer: [link.customerFboNumber, link.customerName].filter(Boolean).join(" · ") || null,
    detail: isShipping
      ? `Expédition ${link.shippingOrder.shippingDestinationCity || ""}`.trim()
      : [link.source === "QR_FORM" ? "Paiement QR" : "Lien admin", link.invoiceReference || link.title]
          .filter(Boolean)
          .join(" · "),
    paymentMode: normalizeMode(link.paymentMethod || link.provider),
    paidAt: link.paidAt,
    amountFcfa,
    baseAmountFcfa: toAmount(link.baseAmountFcfa ?? amountFcfa - toAmount(link.serviceFeeFcfa)),
    serviceFeeFcfa: toAmount(link.serviceFeeFcfa),
    packagingFcfa: 0,
    invoicer: formatAdmin(link.createdBy),
    cashier: null,
  };
}

async function loadRows(req, { start, end }, filters) {
  const wanted = (source) => !filters.source || filters.source === source;
  const withInvoicer = Boolean(filters.invoicerId);

  const preorders = wanted("PREORDER")
    ? prisma.preorder.findMany({
        where: scopeWhere(req, {
          paymentStatus: "PAID",
          isTest: false,
          // Réglées au siège d'une autre filiale : rien n'est encaissé ici.
          settlementEntity: null,
          ...(withInvoicer ? { invoicedById: filters.invoicerId } : {}),
          OR: [
            { manualPaymentValidatedAt: paidWindow(start, end) },
            { paidAt: paidWindow(start, end) },
            { activePayment: { is: { status: "SUCCEEDED", paidAt: paidWindow(start, end) } } },
          ],
        }),
        select: {
          id: true,
          preorderNumber: true,
          fboNumero: true,
          fboNomComplet: true,
          factureReference: true,
          preorderPaymentMode: true,
          paymentProvider: true,
          totalFcfa: true,
          as400InvoiceTotalFcfa: true,
          emballageFcfa: true,
          paidAt: true,
          manualPaymentValidatedAt: true,
          invoicedByAdmin: adminSelect,
          manualPaymentValidatedBy: adminSelect,
          activePayment: {
            select: { provider: true, amountPaidFcfa: true, amountExpectedFcfa: true, paidAt: true, status: true },
          },
          cashierTransactions: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { paymentMode: true, amountExpectedFcfa: true, amountReceivedFcfa: true },
          },
        },
        take: DETAIL_ROWS_LIMIT,
      })
    : [];

  // Billets et paiements QR n'ont pas de facturier : exclus du filtre facturier.
  const tickets = wanted("TICKET") && !withInvoicer
    ? prisma.ticketOrder.findMany({
        where: scopeWhere(req, {
          paymentStatus: "SUCCEEDED",
          isTest: false,
          paidAt: paidWindow(start, end),
          NOT: { paymentMethod: { in: NON_CASH_TICKET_METHODS } },
        }),
        select: {
          id: true,
          orderNumber: true,
          eventId: true,
          buyerFullName: true,
          buyerFboNumber: true,
          quantity: true,
          totalFcfa: true,
          amountToPayFcfa: true,
          paymentServiceFeeFcfa: true,
          paymentMethod: true,
          paymentProvider: true,
          paidAt: true,
          event: { select: { title: true } },
        },
        take: DETAIL_ROWS_LIMIT,
      })
    : [];

  const linkSources = ["EXTERNAL_LINK", "SHIPPING"].filter(wanted);
  const links = linkSources.length
    ? prisma.externalPaymentLink.findMany({
        where: scopeWhere(req, {
          status: "PAID",
          paidAt: paidWindow(start, end),
          ...(withInvoicer ? { createdById: filters.invoicerId } : {}),
          ...(linkSources.length === 1
            ? { shippingOrder: linkSources[0] === "SHIPPING" ? { isNot: null } : { is: null } }
            : {}),
        }),
        select: {
          id: true,
          reference: true,
          invoiceReference: true,
          title: true,
          source: true,
          customerName: true,
          customerFboNumber: true,
          amountFcfa: true,
          baseAmountFcfa: true,
          serviceFeeFcfa: true,
          paymentMethod: true,
          provider: true,
          paidAt: true,
          createdBy: adminSelect,
          shippingOrder: { select: { preorderNumber: true, shippingDestinationCity: true } },
        },
        take: DETAIL_ROWS_LIMIT,
      })
    : [];

  const [preorderRows, ticketRows, linkRows] = await Promise.all([preorders, tickets, links]);
  const rows = [
    ...preorderRows.map(preorderRow),
    ...ticketRows.map(ticketRow),
    ...linkRows.map(linkRow),
  ].filter((row) => !filters.paymentMode || row.paymentMode === filters.paymentMode);

  rows.sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0));
  const truncated = [preorderRows, ticketRows, linkRows].some((list) => list.length >= DETAIL_ROWS_LIMIT);
  return { rows, truncated };
}

function sumRows(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.count += 1;
      acc.amountFcfa += row.amountFcfa;
      acc.baseAmountFcfa += row.baseAmountFcfa;
      acc.serviceFeeFcfa += row.serviceFeeFcfa;
      return acc;
    },
    { count: 0, amountFcfa: 0, baseAmountFcfa: 0, serviceFeeFcfa: 0 },
  );
}

function groupRows(rows, keyOf, labelOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const group = map.get(key) || { key, label: labelOf(row), rows: [] };
    group.rows.push(row);
    map.set(key, group);
  }
  return [...map.values()]
    .map(({ key, label, rows: groupRowsList }) => ({ key, label, ...sumRows(groupRowsList) }))
    .sort((a, b) => b.amountFcfa - a.amountFcfa || b.count - a.count);
}

function summarize(rows) {
  const preorders = rows.filter((row) => row.source === "PREORDER");
  const tickets = rows.filter((row) => row.source === "TICKET");
  return {
    totals: sumRows(rows),
    bySource: Object.keys(SOURCES).map((source) => ({
      key: source,
      label: SOURCES[source],
      ...sumRows(rows.filter((row) => row.source === source)),
    })),
    byPaymentMode: groupRows(rows, (row) => row.paymentMode, (row) => paymentModeLabel(row.paymentMode)),
    // Précommandes et liens créés par un admin ; billets et QR « Non attribué ».
    byInvoicer: groupRows(
      rows,
      (row) => row.invoicer?.id || "UNASSIGNED",
      (row) => row.invoicer?.label || "Non attribué (billets, QR)",
    ),
    packaging: {
      count: preorders.filter((row) => row.packagingFcfa > 0).length,
      amountFcfa: preorders.reduce((sum, row) => sum + row.packagingFcfa, 0),
    },
    ticketsByEvent: groupRows(tickets, (row) => row.eventId, (row) => row.eventTitle || "Événement").map(
      (group) => ({
        ...group,
        ticketCount: tickets
          .filter((row) => row.eventId === group.key)
          .reduce((sum, row) => sum + (row.quantity || 0), 0),
      }),
    ),
    byDay: summarizeByDay(rows),
  };
}

// Évolution jour par jour (semaine, mois, période) : total, emballage et
// billets. Jour UTC, comme les bornes de période (UTC = heure d'Abidjan).
function summarizeByDay(rows) {
  const days = new Map();
  for (const row of rows) {
    if (!row.paidAt) continue;
    const key = new Date(row.paidAt).toISOString().slice(0, 10);
    const day = days.get(key) || {
      key,
      count: 0,
      amountFcfa: 0,
      packagingFcfa: 0,
      preorderCount: 0,
      ticketAmountFcfa: 0,
      ticketCount: 0,
    };
    day.count += 1;
    day.amountFcfa += row.amountFcfa;
    day.packagingFcfa += row.packagingFcfa;
    if (row.source === "PREORDER") day.preorderCount += 1;
    if (row.source === "TICKET") {
      day.ticketAmountFcfa += row.amountFcfa;
      day.ticketCount += row.quantity || 0;
    }
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// Pouls du jour : requêtes agrégées très légères, interrogées toutes les
// quelques secondes par la page ; le rapport complet n'est rechargé que si la
// signature change. Couvre toutes les sources sans dépendre des événements
// temps réel (non émis par les confirmations Wave, et propres à chaque
// instance du serveur).
async function buildPulse(req, now = new Date()) {
  const dayIso = now.toISOString().slice(0, 10);
  const window = paidWindow(new Date(`${dayIso}T00:00:00.000Z`), new Date(`${dayIso}T23:59:59.999Z`));
  const [preorders, validated, tickets, links] = await Promise.all([
    prisma.preorder.aggregate({
      where: scopeWhere(req, { paymentStatus: "PAID", isTest: false, paidAt: window }),
      _count: { _all: true },
      _max: { paidAt: true },
    }),
    prisma.preorder.aggregate({
      where: scopeWhere(req, { paymentStatus: "PAID", isTest: false, manualPaymentValidatedAt: window }),
      _count: { _all: true },
      _max: { manualPaymentValidatedAt: true },
    }),
    prisma.ticketOrder.aggregate({
      where: scopeWhere(req, { paymentStatus: "SUCCEEDED", isTest: false, paidAt: window }),
      _count: { _all: true },
      _max: { paidAt: true },
    }),
    prisma.externalPaymentLink.aggregate({
      where: scopeWhere(req, { status: "PAID", paidAt: window }),
      _count: { _all: true },
      _max: { paidAt: true },
    }),
  ]);

  const dates = [
    preorders._max?.paidAt,
    validated._max?.manualPaymentValidatedAt,
    tickets._max?.paidAt,
    links._max?.paidAt,
  ].filter(Boolean);
  const lastPaidAt = dates.length ? new Date(Math.max(...dates.map((d) => new Date(d).getTime()))) : null;
  const counts = [preorders, validated, tickets, links].map((result) => result._count?._all || 0);
  return {
    date: dayIso,
    lastPaidAt,
    signature: `${counts.join("-")}@${lastPaidAt ? lastPaidAt.toISOString() : ""}`,
  };
}

const GLOBAL_ADMIN_ROLES = new Set(["SUPER_ADMIN", "TECH_ADMIN"]);

// Un virement validé n'entre pas dans le tiroir : un jour où le caissier n'a
// validé que des virements (ou rien), aucune clôture n'est attendue, et un
// brouillon laissé ouvert ces jours-là ne compte pas comme manquant.
// Un administrateur global n'encaisse pas : il aide le client (relance,
// changement de moyen de paiement) et transmet la preuve au facturier.
function closureState(row) {
  if (row.closure && row.closure.status !== "DRAFT") return row.closure.status;
  if (row.adminAssist) return "ADMIN_ASSIST";
  if (row.transferCount < row.transactionCount) return row.closure ? "DRAFT" : "MISSING";
  return row.transactionCount ? "TRANSFER_ONLY" : "NOTHING_TO_CLOSE";
}

// Clôtures de caisse sur la période, par caissier et par jour : attendu
// (commandes dont il a validé le paiement), déclaré, écart, et clôtures
// manquantes (encaissements sans clôture). Mêmes montants que
// cashClosures.controller.js.

async function buildClosuresReport(req, period) {
  const fromKey = period.start.toISOString().slice(0, 10);
  const toKey = period.end.toISOString().slice(0, 10);
  const window = paidWindow(period.start, period.end);

  const [orders, closures, registers] = await Promise.all([
    prisma.preorder.findMany({
      where: scopeWhere(req, {
        paymentStatus: "PAID",
        isTest: false,
        settlementEntity: null,
        manualPaymentValidatedById: { not: null },
        OR: [{ manualPaymentValidatedAt: window }, { paidAt: window }],
      }),
      select: {
        manualPaymentValidatedAt: true,
        paidAt: true,
        preorderPaymentMode: true,
        paymentProvider: true,
        totalFcfa: true,
        as400InvoiceTotalFcfa: true,
        manualPaymentValidatedBy: adminSelect,
        activePayment: { select: { provider: true, amountPaidFcfa: true, amountExpectedFcfa: true } },
        cashierTransactions: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { paymentMode: true, amountExpectedFcfa: true, amountReceivedFcfa: true },
        },
      },
      take: DETAIL_ROWS_LIMIT,
    }),
    prisma.cashClosure.findMany({
      where: scopeWhere(req, { dateKey: { gte: fromKey, lte: toKey } }),
      select: {
        id: true,
        dateKey: true,
        status: true,
        totalExpectedFcfa: true,
        totalDeclaredFcfa: true,
        discrepancyFcfa: true,
        transactionCount: true,
        submittedAt: true,
        reviewedAt: true,
        cashier: adminSelect,
        reviewedBy: adminSelect,
      },
    }),
    prisma.cashRegisterStatus.findMany({
      where: scopeWhere(req, {}),
      select: { userId: true, isOpen: true, closedAt: true, reopenedAt: true, user: adminSelect },
    }),
  ]);

  const rows = new Map();
  const rowFor = (dateKey, cashier) => {
    const key = `${dateKey}|${cashier.id}`;
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        dateKey,
        cashier: formatAdmin(cashier),
        adminAssist: GLOBAL_ADMIN_ROLES.has(String(cashier?.role || "").toUpperCase()),
        expectedFcfa: 0,
        transferFcfa: 0,
        transactionCount: 0,
        transferCount: 0,
        closure: null,
      });
    }
    return rows.get(key);
  };

  for (const order of orders) {
    const at = order.manualPaymentValidatedAt || order.paidAt;
    const row = rowFor(new Date(at).toISOString().slice(0, 10), order.manualPaymentValidatedBy);
    const amount = resolveOrderExpectedAmount(order);
    row.expectedFcfa += amount;
    row.transactionCount += 1;
    if (resolveOrderPaymentMode(order) === "BANK_TRANSFER") {
      row.transferFcfa += amount;
      row.transferCount += 1;
    }
  }
  for (const closure of closures) {
    rowFor(closure.dateKey, closure.cashier).closure = {
      id: closure.id,
      status: closure.status,
      expectedFcfa: closure.totalExpectedFcfa,
      declaredFcfa: closure.totalDeclaredFcfa,
      discrepancyFcfa: closure.discrepancyFcfa,
      submittedAt: closure.submittedAt,
      reviewedAt: closure.reviewedAt,
      reviewedBy: formatAdmin(closure.reviewedBy),
    };
  }

  const list = [...rows.values()]
    .map((row) => ({ ...row, state: closureState(row) }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.cashier.label.localeCompare(b.cashier.label));
  const closed = list.filter((row) => row.closure && row.closure.status !== "DRAFT");

  return {
    rows: list,
    summary: {
      expectedFcfa: list.reduce((sum, row) => sum + row.expectedFcfa, 0),
      declaredFcfa: closed.reduce((sum, row) => sum + row.closure.declaredFcfa, 0),
      discrepancyFcfa: closed.reduce((sum, row) => sum + row.closure.discrepancyFcfa, 0),
      missing: list.filter((row) => row.state === "MISSING" || row.state === "DRAFT").length,
      transferOnly: list.filter((row) => row.state === "TRANSFER_ONLY").length,
      adminAssist: list.filter((row) => row.state === "ADMIN_ASSIST").length,
      toReview: list.filter((row) => row.state === "SUBMITTED").length,
      withDiscrepancy: closed.filter((row) => row.closure.discrepancyFcfa !== 0).length,
    },
    registers: registers
      .map((register) => ({
        global: !register.userId,
        label: register.userId ? formatAdmin(register.user)?.label || "Caisse personnelle" : "Caisse du comptoir",
        isOpen: register.isOpen,
        closedAt: register.closedAt,
        reopenedAt: register.reopenedAt,
      }))
      .sort((a, b) => Number(b.global) - Number(a.global) || a.label.localeCompare(b.label)),
  };
}

async function buildCashSupervisionReport(req, period, filters) {
  const withPreorders = !filters.source || filters.source === "PREORDER";
  const [{ rows, truncated }, previous, settledElsewhere] = await Promise.all([
    loadRows(req, period, filters),
    loadRows(req, period.previous, filters),
    withPreorders && prisma.preorder.aggregate({
      where: scopeWhere(req, {
        paymentStatus: "PAID",
        isTest: false,
        settlementEntity: { not: null },
        ...(filters.invoicerId ? { invoicedById: filters.invoicerId } : {}),
        OR: [
          { manualPaymentValidatedAt: paidWindow(period.start, period.end) },
          { paidAt: paidWindow(period.start, period.end) },
        ],
      }),
      _count: { _all: true },
      _sum: { as400InvoiceTotalFcfa: true },
    }),
  ]);

  return {
    ...summarize(rows),
    previousTotals: sumRows(previous.rows),
    settledElsewhere: {
      count: settledElsewhere?._count?._all || 0,
      amountFcfa: toAmount(settledElsewhere?._sum?.as400InvoiceTotalFcfa),
    },
    rows,
    rowsTruncated: truncated,
    detailRowsLimit: DETAIL_ROWS_LIMIT,
  };
}

module.exports = {
  SOURCES,
  paymentModeLabel,
  normalizeFilters,
  buildCashSupervisionReport,
  buildPulse,
  buildClosuresReport,
  // exposés pour les tests
  preorderRow,
  ticketRow,
  linkRow,
  summarize,
};
