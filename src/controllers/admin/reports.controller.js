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

function parseIsoDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function startOfUtcDay(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function endOfUtcDay(iso) {
  return new Date(`${iso}T23:59:59.999Z`);
}

function shiftIsoDay(iso, days) {
  const date = startOfUtcDay(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDayCount(fromIso, toIso) {
  return Math.max(
    1,
    Math.round((startOfUtcDay(toIso).getTime() - startOfUtcDay(fromIso).getTime()) / 86400000) + 1,
  );
}

function resolveReportPeriod(query = {}) {
  const periodType = String(query.period || query.periodType || "day")
    .trim()
    .toLowerCase();
  const date = parseIsoDate(query.date) || new Date().toISOString().slice(0, 10);

  if (periodType === "custom") {
    const fromIso = parseIsoDate(query.dateFrom) || date;
    const toIso = parseIsoDate(query.dateTo) || fromIso;
    const safeFrom = fromIso <= toIso ? fromIso : toIso;
    const safeTo = fromIso <= toIso ? toIso : fromIso;
    const days = inclusiveDayCount(safeFrom, safeTo);
    const previousStartIso = shiftIsoDay(safeFrom, -days);
    const previousEndIso = shiftIsoDay(safeFrom, -1);
    return {
      type: "custom",
      label: `${safeFrom} au ${safeTo}`,
      iso: safeFrom,
      start: startOfUtcDay(safeFrom),
      end: endOfUtcDay(safeTo),
      previous: {
        iso: previousStartIso,
        start: startOfUtcDay(previousStartIso),
        end: endOfUtcDay(previousEndIso),
      },
    };
  }

  if (periodType === "week") {
    const anchor = startOfUtcDay(date);
    const day = anchor.getUTCDay() || 7;
    anchor.setUTCDate(anchor.getUTCDate() - day + 1);
    const startIso = anchor.toISOString().slice(0, 10);
    const endIso = shiftIsoDay(startIso, 6);
    return {
      type: "week",
      label: `Semaine du ${startIso}`,
      iso: startIso,
      start: startOfUtcDay(startIso),
      end: endOfUtcDay(endIso),
      previous: {
        iso: shiftIsoDay(startIso, -7),
        start: startOfUtcDay(shiftIsoDay(startIso, -7)),
        end: endOfUtcDay(shiftIsoDay(startIso, -1)),
      },
    };
  }

  if (periodType === "month") {
    const [year, month] = date.split("-").map((part) => Number(part));
    const startIso = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonth = new Date(Date.UTC(year, month, 1));
    nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
    const endIso = nextMonth.toISOString().slice(0, 10);
    const previousEnd = new Date(Date.UTC(year, month - 1, 0));
    const previousStart = new Date(Date.UTC(previousEnd.getUTCFullYear(), previousEnd.getUTCMonth(), 1));
    return {
      type: "month",
      label: `${startIso.slice(0, 7)}`,
      iso: startIso,
      start: startOfUtcDay(startIso),
      end: endOfUtcDay(endIso),
      previous: {
        iso: previousStart.toISOString().slice(0, 10),
        start: previousStart,
        end: endOfUtcDay(previousEnd.toISOString().slice(0, 10)),
      },
    };
  }

  const day = parseReportDate(date);
  return {
    type: "day",
    label: day.iso,
    ...day,
    previous: shiftDayRange(day.start, -1),
  };
}

function shiftDayRange(start, days) {
  const shiftedStart = new Date(start);
  shiftedStart.setUTCDate(shiftedStart.getUTCDate() + days);
  const iso = shiftedStart.toISOString().slice(0, 10);
  return {
    iso,
    start: new Date(`${iso}T00:00:00.000Z`),
    end: new Date(`${iso}T23:59:59.999Z`),
  };
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

function normalizeFilterId(value) {
  const id = String(value || "").trim();
  return id || null;
}

function normalizePaymentModeFilter(value) {
  const mode = String(value || "").trim().toUpperCase();
  return mode || null;
}

function applyCommonFilters(where = {}, filters = {}) {
  const next = { ...(where || {}) };
  if (filters.paymentMode) {
    next.preorderPaymentMode = filters.paymentMode;
  }
  return next;
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

function buildComparisonMetric(current, previous) {
  const currentCount = toNumber(current?.count);
  const previousCount = toNumber(previous?.count);
  const currentAmount = toNumber(current?.amountFcfa);
  const previousAmount = toNumber(previous?.amountFcfa);
  return {
    currentCount,
    previousCount,
    countDelta: currentCount - previousCount,
    countDeltaPercent: previousCount ? Math.round(((currentCount - previousCount) / previousCount) * 100) : null,
    currentAmountFcfa: currentAmount,
    previousAmountFcfa: previousAmount,
    amountDeltaFcfa: currentAmount - previousAmount,
    amountDeltaPercent: previousAmount ? Math.round(((currentAmount - previousAmount) / previousAmount) * 100) : null,
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

function addAgeAt(rows = [], dateField, end) {
  const endMs = end ? new Date(end).getTime() : Date.now();
  return rows.map((row) => {
    const startedMs = row?.[dateField] ? new Date(row[dateField]).getTime() : NaN;
    const ageMinutes =
      Number.isFinite(startedMs) && Number.isFinite(endMs) && endMs >= startedMs
        ? Math.round((endMs - startedMs) / 60000)
        : null;
    return { ...row, ageMinutes };
  });
}

function takeCritical(rows = [], minAgeMinutes, limit = 25) {
  return rows
    .filter((row) => Number(row.ageMinutes || 0) >= minAgeMinutes)
    .sort((a, b) => Number(b.ageMinutes || 0) - Number(a.ageMinutes || 0))
    .slice(0, limit);
}

const includeShape = {
  invoicedByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
  manualPaymentValidatedBy: { select: { id: true, fullName: true, email: true, role: true } },
  preparationLaunchedBy: { select: { id: true, fullName: true, email: true, role: true } },
  preparedByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
  fulfilledByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
  cancelledByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
};

async function getDailySnapshot(req, start, end, filters = {}) {
  const base = (where = {}) => scopeWhere(req, where);
  const [submitted, invoiced, paid, cancelled] = await Promise.all([
    prisma.preorder.aggregate({
      where: base(applyCommonFilters({ submittedAt: { gte: start, lte: end } }, filters)),
      _count: { _all: true },
      _sum: { totalFcfa: true },
    }),
    prisma.preorder.aggregate({
      where: base(applyCommonFilters({
        invoicedAt: { gte: start, lte: end },
        ...(filters.invoicerId ? { invoicedById: filters.invoicerId } : {}),
      }, filters)),
      _count: { _all: true },
      _sum: { as400InvoiceTotalFcfa: true },
    }),
    prisma.preorder.aggregate({
      where: base(applyCommonFilters({
        paymentStatus: "PAID",
        ...(filters.cashierId ? { manualPaymentValidatedById: filters.cashierId } : {}),
        OR: [
          { manualPaymentValidatedAt: { gte: start, lte: end } },
          { paidAt: { gte: start, lte: end } },
        ],
      }, filters)),
      _count: { _all: true },
      _sum: { as400InvoiceTotalFcfa: true },
    }),
    prisma.preorder.aggregate({
      where: base(applyCommonFilters({ cancelledAt: { gte: start, lte: end } }, filters)),
      _count: { _all: true },
      _sum: { as400InvoiceTotalFcfa: true },
    }),
  ]);

  return {
    submitted: {
      count: submitted?._count?._all || 0,
      amountFcfa: toNumber(submitted?._sum?.totalFcfa),
    },
    invoiced: {
      count: invoiced?._count?._all || 0,
      amountFcfa: toNumber(invoiced?._sum?.as400InvoiceTotalFcfa),
    },
    paid: {
      count: paid?._count?._all || 0,
      amountFcfa: toNumber(paid?._sum?.as400InvoiceTotalFcfa),
    },
    cancelled: {
      count: cancelled?._count?._all || 0,
      amountFcfa: toNumber(cancelled?._sum?.as400InvoiceTotalFcfa),
    },
  };
}

async function getDailySalesReport(req, res) {
  try {
    const countryId = pickCountryId(req);
    const reportPeriod = resolveReportPeriod(req.query || {});
    const { iso, start, end } = reportPeriod;
    const base = (where = {}) => scopeWhere(req, where);
    const filters = {
      paymentMode: normalizePaymentModeFilter(req.query?.paymentMode),
      invoicerId: normalizeFilterId(req.query?.invoicerId),
      cashierId: normalizeFilterId(req.query?.cashierId),
    };

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
        where: base(applyCommonFilters({ submittedAt: { gte: start, lte: end } }, filters)),
        include: includeShape,
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({
          invoicedAt: { gte: start, lte: end },
          ...(filters.invoicerId ? { invoicedById: filters.invoicerId } : {}),
        }, filters)),
        include: includeShape,
        orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({
          paymentStatus: "PAID",
          ...(filters.cashierId ? { manualPaymentValidatedById: filters.cashierId } : {}),
          OR: [
            { manualPaymentValidatedAt: { gte: start, lte: end } },
            { paidAt: { gte: start, lte: end } },
          ],
        }, filters)),
        include: includeShape,
        orderBy: [{ paidAt: "asc" }, { manualPaymentValidatedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({ cancelledAt: { gte: start, lte: end } }, filters)),
        include: includeShape,
        orderBy: [{ cancelledAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({ preparationLaunchedAt: { gte: start, lte: end } }, filters)),
        include: includeShape,
        orderBy: [{ preparationLaunchedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({ preparedAt: { gte: start, lte: end } }, filters)),
        include: includeShape,
        orderBy: [{ preparedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({ fulfilledAt: { gte: start, lte: end } }, filters)),
        include: includeShape,
        orderBy: [{ fulfilledAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({
          submittedAt: { lte: end },
          invoicedAt: null,
          status: { not: "CANCELLED" },
        }, filters)),
        include: includeShape,
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({
          invoicedAt: { lte: end },
          paymentStatus: { not: "PAID" },
          status: { not: "CANCELLED" },
        }, filters)),
        include: includeShape,
        orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
        take: 2000,
      }),
      prisma.preorder.findMany({
        where: base(applyCommonFilters({
          paymentStatus: "PAID",
          preparationLaunchedAt: null,
          status: { not: "CANCELLED" },
          ...(filters.cashierId ? { manualPaymentValidatedById: filters.cashierId } : {}),
          OR: [{ paidAt: { lte: end } }, { manualPaymentValidatedAt: { lte: end } }],
        }, filters)),
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
    const pendingSubmittedRows = addAgeAt(pendingSubmittedRaw.map(buildOrderRow), "submittedAt", end);
    const pendingInvoicedRows = addAgeAt(pendingInvoicedRaw.map(buildOrderRow), "invoicedAt", end);
    const pendingPaidRows = addAgeAt(pendingPaidRaw.map(buildOrderRow), "paidAt", end);

    const previousDayInvoiced = invoicedRows.filter((row) => {
      if (!row.submittedAt) return false;
      const submittedAt = new Date(row.submittedAt);
      return submittedAt < start;
    });
    const previousDay = reportPeriod.previous;
    const previousSnapshot = await getDailySnapshot(req, previousDay.start, previousDay.end, filters);
    const currentSnapshot = {
      submitted: summarizeRows(submittedRows, "totalFcfa"),
      invoiced: summarizeRows(invoicedRows, "as400InvoiceTotalFcfa"),
      paid: summarizeRows(paidRows, "as400InvoiceTotalFcfa"),
      cancelled: summarizeRows(cancelledRows, "as400InvoiceTotalFcfa"),
    };

    return res.json({
      ok: true,
      date: iso,
      countryId,
      filters,
      period: {
        type: reportPeriod.type,
        label: reportPeriod.label,
        start: start.toISOString(),
        end: end.toISOString(),
        previousStart: previousDay.start.toISOString(),
        previousEnd: previousDay.end.toISOString(),
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
      critical: {
        thresholdsMinutes: {
          submittedNotInvoiced: 120,
          invoicedNotPaid: 60,
          paidNotLaunched: 30,
        },
        submittedNotInvoiced: takeCritical(pendingSubmittedRows, 120),
        invoicedNotPaid: takeCritical(pendingInvoicedRows, 60),
        paidNotLaunched: takeCritical(pendingPaidRows, 30),
      },
      performance: {
        byInvoicer: groupByAdmin(invoicedRows, (row) => row.invoicedBy, "as400InvoiceTotalFcfa"),
        byCashier: groupByAdmin(paidRows, (row) => row.cashier, "as400InvoiceTotalFcfa"),
        averageSubmitToInvoiceMinutes: averageMinutes(invoicedRows, "submittedAt", "invoicedAt"),
        averageInvoiceToPaymentMinutes: averageMinutes(paidRows, "invoicedAt", "paidAt"),
        averagePaymentToPreparationMinutes: averageMinutes(launchedRows, "paidAt", "preparationLaunchedAt"),
      },
      comparison: {
        previousDay: {
          date: previousDay.iso,
          label: reportPeriod.type === "day" ? "veille" : "période précédente",
          submitted: buildComparisonMetric(currentSnapshot.submitted, previousSnapshot.submitted),
          invoiced: buildComparisonMetric(currentSnapshot.invoiced, previousSnapshot.invoiced),
          paid: buildComparisonMetric(currentSnapshot.paid, previousSnapshot.paid),
          cancelled: buildComparisonMetric(currentSnapshot.cancelled, previousSnapshot.cancelled),
        },
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
