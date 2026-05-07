const prisma = require("../../prisma");
const { scopeWhere, pickCountryId } = require("../../helpers/countryScope");

function parseReportDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const now = new Date();
  const iso = match
    ? `${match[1]}-${match[2]}-${match[3]}`
    : now.toISOString().slice(0, 10);
  const start = new Date(`${iso}T00:00:00.000Z`);
  const end = new Date(`${iso}T23:59:59.999Z`);
  return { iso, start, end };
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function sumAmount(rows = [], field = "totalFcfa") {
  return rows.reduce((total, row) => total + toNumber(row?.[field]), 0);
}

function formatAdmin(admin) {
  if (!admin) return null;
  return {
    id: admin.id || null,
    fullName: admin.fullName || null,
    email: admin.email || null,
    role: admin.role || null,
    label: admin.fullName || admin.email || admin.role || "Non renseigné",
  };
}

function paymentModeLabel(value) {
  const mode = String(value || "").trim().toUpperCase();
  return mode || "NON_RENSEIGNE";
}

function cancellationReasonLabel(value) {
  const reason = String(value || "").trim();
  return reason || "Motif non renseigné";
}

function groupBy(rows = [], keyFn, amountField = "totalFcfa") {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = map.get(key) || { key, count: 0, amountFcfa: 0 };
    current.count += 1;
    current.amountFcfa += toNumber(row?.[amountField]);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.amountFcfa - a.amountFcfa);
}

function groupByAdmin(rows = [], keyFn, amountField = "totalFcfa") {
  const map = new Map();
  for (const row of rows) {
    const admin = keyFn(row);
    const id = admin?.id || "UNKNOWN";
    const current = map.get(id) || {
      admin: formatAdmin(admin) || { id: null, label: "Non renseigné" },
      count: 0,
      amountFcfa: 0,
    };
    current.count += 1;
    current.amountFcfa += toNumber(row?.[amountField]);
    map.set(id, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.amountFcfa - a.amountFcfa);
}

function averageMinutes(rows = [], startField, endField) {
  const durations = rows
    .map((row) => {
      const start = row?.[startField] ? new Date(row[startField]).getTime() : NaN;
      const end = row?.[endField] ? new Date(row[endField]).getTime() : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return Math.round((end - start) / 60000);
    })
    .filter((value) => value !== null);

  if (!durations.length) return null;
  return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

function effectivePaidAt(order) {
  return order?.manualPaymentValidatedAt || order?.paidAt || null;
}

function summarizeRows(rows = [], amountField = "totalFcfa") {
  return {
    count: rows.length,
    amountFcfa: sumAmount(rows, amountField),
  };
}

function buildOrderRow(order) {
  const paidAt = effectivePaidAt(order);
  return {
    id: order.id,
    preorderNumber: order.preorderNumber || null,
    parcelNumber: order.parcelNumber || null,
    fboNumero: order.fboNumero || null,
    fboNomComplet: order.fboNomComplet || null,
    status: order.status || null,
    paymentStatus: order.paymentStatus || null,
    preorderPaymentMode: order.preorderPaymentMode || null,
    deliveryMode: order.deliveryMode || null,
    totalFcfa: toNumber(order.totalFcfa),
    as400InvoiceTotalFcfa: toNumber(order.as400InvoiceTotalFcfa || order.totalFcfa),
    submittedAt: order.submittedAt || null,
    invoicedAt: order.invoicedAt || null,
    paidAt,
    preparationLaunchedAt: order.preparationLaunchedAt || null,
    preparedAt: order.preparedAt || null,
    fulfilledAt: order.fulfilledAt || null,
    cancelledAt: order.cancelledAt || null,
    cancelReason: order.cancelReason || null,
    factureReference: order.factureReference || null,
    paymentCollectionCode: order.paymentCollectionCode || null,
    invoicedBy: formatAdmin(order.invoicedByAdmin),
    cashier: formatAdmin(order.manualPaymentValidatedBy),
    preparationLaunchedBy: formatAdmin(order.preparationLaunchedBy),
    preparedBy: formatAdmin(order.preparedByAdmin),
    fulfilledBy: formatAdmin(order.fulfilledByAdmin),
    cancelledBy: formatAdmin(order.cancelledByAdmin),
  };
}

const includeShape = {
  invoicedByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
  manualPaymentValidatedBy: { select: { id: true, fullName: true, email: true, role: true } },
  preparationLaunchedBy: { select: { id: true, fullName: true, email: true, role: true } },
  preparedByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
  fulfilledByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
  cancelledByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
};

async function getDailySalesReport(req, res) {
  try {
    const countryId = pickCountryId(req);
    const { iso, start, end } = parseReportDate(req.query?.date);
    const base = (where = {}) => scopeWhere(req, where);

    const [
      submittedRaw,
      invoicedRaw,
      paidRaw,
      cancelledRaw,
      launchedRaw,
      preparedRaw,
      fulfilledRaw,
      pendingSubmittedRaw,
      pendingInvoicedRaw,
      pendingPaidRaw,
    ] = await Promise.all([
      prisma.preorder.findMany({
        where: base({ submittedAt: { gte: start, lte: end } }),
        include: includeShape,
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({ invoicedAt: { gte: start, lte: end } }),
        include: includeShape,
        orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({
          paymentStatus: "PAID",
          OR: [
            { manualPaymentValidatedAt: { gte: start, lte: end } },
            { paidAt: { gte: start, lte: end } },
          ],
        }),
        include: includeShape,
        orderBy: [{ paidAt: "asc" }, { manualPaymentValidatedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({ cancelledAt: { gte: start, lte: end } }),
        include: includeShape,
        orderBy: [{ cancelledAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({ preparationLaunchedAt: { gte: start, lte: end } }),
        include: includeShape,
        orderBy: [{ preparationLaunchedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({ preparedAt: { gte: start, lte: end } }),
        include: includeShape,
        orderBy: [{ preparedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({ fulfilledAt: { gte: start, lte: end } }),
        include: includeShape,
        orderBy: [{ fulfilledAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({
          submittedAt: { lte: end },
          invoicedAt: null,
          status: { not: "CANCELLED" },
        }),
        include: includeShape,
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({
          invoicedAt: { lte: end },
          paymentStatus: { not: "PAID" },
          status: { not: "CANCELLED" },
        }),
        include: includeShape,
        orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base({
          paymentStatus: "PAID",
          preparationLaunchedAt: null,
          status: { not: "CANCELLED" },
          OR: [{ paidAt: { lte: end } }, { manualPaymentValidatedAt: { lte: end } }],
        }),
        include: includeShape,
        orderBy: [{ paidAt: "asc" }, { manualPaymentValidatedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
    ]);

    const submittedRows = submittedRaw.map(buildOrderRow);
    const invoicedRows = invoicedRaw.map(buildOrderRow);
    const paidRows = paidRaw.map(buildOrderRow);
    const cancelledRows = cancelledRaw.map(buildOrderRow);
    const launchedRows = launchedRaw.map(buildOrderRow);
    const preparedRows = preparedRaw.map(buildOrderRow);
    const fulfilledRows = fulfilledRaw.map(buildOrderRow);
    const pendingSubmittedRows = pendingSubmittedRaw.map(buildOrderRow);
    const pendingInvoicedRows = pendingInvoicedRaw.map(buildOrderRow);
    const pendingPaidRows = pendingPaidRaw.map(buildOrderRow);

    const previousDayInvoiced = invoicedRows.filter((row) => {
      if (!row.submittedAt) return false;
      const submittedAt = new Date(row.submittedAt);
      return submittedAt < start;
    });

    return res.json({
      ok: true,
      date: iso,
      countryId,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      submitted: {
        ...summarizeRows(submittedRows, "totalFcfa"),
        byPaymentMode: groupBy(submittedRows, (row) => paymentModeLabel(row.preorderPaymentMode)),
        byDeliveryMode: groupBy(submittedRows, (row) => String(row.deliveryMode || "NON_RENSEIGNE")),
        rows: submittedRows,
      },
      invoiced: {
        ...summarizeRows(invoicedRows, "as400InvoiceTotalFcfa"),
        fromPreviousDays: previousDayInvoiced.length,
        fromSameDay: invoicedRows.length - previousDayInvoiced.length,
        byInvoicer: groupByAdmin(invoicedRows, (row) => row.invoicedBy, "as400InvoiceTotalFcfa"),
        rows: invoicedRows,
      },
      paid: {
        ...summarizeRows(paidRows, "as400InvoiceTotalFcfa"),
        byPaymentMode: groupBy(paidRows, (row) => paymentModeLabel(row.preorderPaymentMode), "as400InvoiceTotalFcfa"),
        byCashier: groupByAdmin(paidRows, (row) => row.cashier, "as400InvoiceTotalFcfa"),
        rows: paidRows,
      },
      cancelled: {
        ...summarizeRows(cancelledRows, "as400InvoiceTotalFcfa"),
        byReason: groupBy(cancelledRows, (row) => cancellationReasonLabel(row.cancelReason), "as400InvoiceTotalFcfa"),
        byActor: groupByAdmin(cancelledRows, (row) => row.cancelledBy, "as400InvoiceTotalFcfa"),
        rows: cancelledRows,
      },
      preparation: {
        launched: { ...summarizeRows(launchedRows, "as400InvoiceTotalFcfa"), rows: launchedRows },
        prepared: { ...summarizeRows(preparedRows, "as400InvoiceTotalFcfa"), rows: preparedRows },
        fulfilled: { ...summarizeRows(fulfilledRows, "as400InvoiceTotalFcfa"), rows: fulfilledRows },
      },
      pending: {
        submittedNotInvoiced: {
          ...summarizeRows(pendingSubmittedRows, "totalFcfa"),
          rows: pendingSubmittedRows,
        },
        invoicedNotPaid: {
          ...summarizeRows(pendingInvoicedRows, "as400InvoiceTotalFcfa"),
          rows: pendingInvoicedRows,
        },
        paidNotLaunched: {
          ...summarizeRows(pendingPaidRows, "as400InvoiceTotalFcfa"),
          rows: pendingPaidRows,
        },
      },
      performance: {
        byInvoicer: groupByAdmin(invoicedRows, (row) => row.invoicedBy, "as400InvoiceTotalFcfa"),
        byCashier: groupByAdmin(paidRows, (row) => row.cashier, "as400InvoiceTotalFcfa"),
        averageSubmitToInvoiceMinutes: averageMinutes(invoicedRows, "submittedAt", "invoicedAt"),
        averageInvoiceToPaymentMinutes: averageMinutes(paidRows, "invoicedAt", "paidAt"),
        averagePaymentToPreparationMinutes: averageMinutes(launchedRows, "paidAt", "preparationLaunchedAt"),
      },
    });
  } catch (error) {
    console.error("getDailySalesReport error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (rapport quotidien)",
    });
  }
}

module.exports = {
  getDailySalesReport,
};
