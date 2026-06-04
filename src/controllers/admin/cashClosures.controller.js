const prisma = require("../../prisma");
const { pickCountryId, scopeWhere } = require("../../helpers/countryScope");
const { AdminRole } = require("../../auth/permissions");

const REVIEW_ROLES = new Set([
  AdminRole.SUPER_ADMIN,
  AdminRole.TECH_ADMIN,
  AdminRole.OPERATIONS_DIRECTOR,
  AdminRole.COUNTER_MANAGER,
]);

const PAYMENT_MODE_LABELS = {
  ESPECES: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
  BANK_TRANSFER: "Virement bancaire",
  ECOBANK_PAY: "Ecobank Pay",
  TPE_CARD: "TPE / Carte bancaire",
  MANUAL: "Autre paiement manuel",
  UNKNOWN: "Non renseigné",
};

const DECLARATION_PAYMENT_MODES = [
  "ESPECES",
  "WAVE",
  "ORANGE_MONEY",
  "TPE_CARD",
  "BANK_TRANSFER",
  "ECOBANK_PAY",
];

function isVisibleDeclarationLine(line) {
  const mode = normalizePaymentMode(line?.paymentMode);
  if (DECLARATION_PAYMENT_MODES.includes(mode)) return true;
  return (
    toAmount(line?.expectedFcfa) > 0 ||
    toAmount(line?.declaredFcfa) > 0 ||
    Number(line?.transactionCount || 0) > 0 ||
    String(line?.note || "").trim().length > 0
  );
}

function normalizeDateKey(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = raw ? new Date(raw) : new Date();
  if (Number.isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

function dateRangeUtc(dateKey) {
  return {
    start: new Date(`${dateKey}T00:00:00.000Z`),
    end: new Date(`${dateKey}T23:59:59.999Z`),
  };
}

function normalizePaymentMode(value) {
  return String(value || "").trim().toUpperCase() || "UNKNOWN";
}

function paymentModeLabel(value) {
  const mode = normalizePaymentMode(value);
  return PAYMENT_MODE_LABELS[mode] || mode.replace(/_/g, " ");
}

function toAmount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function canReview(req) {
  return REVIEW_ROLES.has(String(req.user?.role || "").trim().toUpperCase());
}

function assertCanAccessClosure(req, closure) {
  if (!closure) {
    const error = new Error("Clôture introuvable");
    error.statusCode = 404;
    throw error;
  }
  if (closure.countryId !== pickCountryId(req)) {
    const error = new Error("Accès interdit à cette clôture");
    error.statusCode = 403;
    throw error;
  }
  if (!canReview(req) && closure.cashierId !== req.user?.id) {
    const error = new Error("Accès interdit à cette clôture");
    error.statusCode = 403;
    throw error;
  }
}

function buildLineTotalsFromOrders(orders = []) {
  const map = new Map();

  for (const paymentMode of DECLARATION_PAYMENT_MODES) {
    map.set(paymentMode, {
      paymentMode,
      label: paymentModeLabel(paymentMode),
      expectedFcfa: 0,
      declaredFcfa: 0,
      discrepancyFcfa: 0,
      transactionCount: 0,
      note: null,
    });
  }

  for (const order of orders) {
    const latestTx = order?.cashierTransactions?.[0] || null;
    const paymentMode = normalizePaymentMode(
      latestTx?.paymentMode || order?.preorderPaymentMode || order?.paymentProvider,
    );
    const current = map.get(paymentMode) || {
      paymentMode,
      label: paymentModeLabel(paymentMode),
      expectedFcfa: 0,
      declaredFcfa: 0,
      discrepancyFcfa: 0,
      transactionCount: 0,
      note: null,
    };
    const expected = toAmount(
      latestTx?.amountReceivedFcfa ||
        latestTx?.amountExpectedFcfa ||
        order?.as400InvoiceTotalFcfa ||
        order?.totalFcfa,
    );
    current.expectedFcfa += expected;
    current.transactionCount += 1;
    current.discrepancyFcfa = current.declaredFcfa - current.expectedFcfa;
    map.set(paymentMode, current);
  }

  return Array.from(map.values()).sort((a, b) => {
    const ai = DECLARATION_PAYMENT_MODES.indexOf(a.paymentMode);
    const bi = DECLARATION_PAYMENT_MODES.indexOf(b.paymentMode);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.label.localeCompare(b.label);
  });
}

function summarizeLines(lines = []) {
  const totalExpectedFcfa = lines.reduce((sum, line) => sum + toAmount(line.expectedFcfa), 0);
  const totalDeclaredFcfa = lines.reduce((sum, line) => sum + toAmount(line.declaredFcfa), 0);
  const transactionCount = lines.reduce((sum, line) => sum + Number(line.transactionCount || 0), 0);
  return {
    totalExpectedFcfa,
    totalDeclaredFcfa,
    discrepancyFcfa: totalDeclaredFcfa - totalExpectedFcfa,
    transactionCount,
  };
}

function serializeAdmin(admin) {
  if (!admin) return null;
  return {
    id: admin.id,
    fullName: admin.fullName,
    email: admin.email,
    role: admin.role,
    label: admin.fullName || admin.email || admin.role,
  };
}

function serializeClosure(closure) {
  if (!closure) return null;
  return {
    id: closure.id,
    dateKey: closure.dateKey,
    status: closure.status,
    totalExpectedFcfa: closure.totalExpectedFcfa,
    totalDeclaredFcfa: closure.totalDeclaredFcfa,
    discrepancyFcfa: closure.discrepancyFcfa,
    transactionCount: closure.transactionCount,
    note: closure.note || "",
    reviewNote: closure.reviewNote || "",
    submittedAt: closure.submittedAt,
    reviewedAt: closure.reviewedAt,
    createdAt: closure.createdAt,
    updatedAt: closure.updatedAt,
    country: closure.country || null,
    cashier: serializeAdmin(closure.cashier),
    submittedBy: serializeAdmin(closure.submittedBy),
    reviewedBy: serializeAdmin(closure.reviewedBy),
    lines: (closure.lines || [])
      .map((line) => ({
        id: line.id,
        paymentMode: line.paymentMode,
        label: line.label,
        expectedFcfa: line.expectedFcfa,
        declaredFcfa: line.declaredFcfa,
        discrepancyFcfa: line.discrepancyFcfa,
        transactionCount: line.transactionCount,
        note: line.note || "",
      }))
      .filter(isVisibleDeclarationLine),
  };
}

const includeClosure = {
  country: { select: { id: true, code: true, name: true } },
  cashier: { select: { id: true, fullName: true, email: true, role: true } },
  submittedBy: { select: { id: true, fullName: true, email: true, role: true } },
  reviewedBy: { select: { id: true, fullName: true, email: true, role: true } },
  lines: { orderBy: { label: "asc" } },
};

async function findClosure(req, id) {
  const closure = await prisma.cashClosure.findUnique({
    where: { id },
    include: includeClosure,
  });
  assertCanAccessClosure(req, closure);
  return closure;
}

async function fetchOrdersForClosure(req, { dateKey, cashierId }) {
  const { start, end } = dateRangeUtc(dateKey);
  return prisma.preorder.findMany({
    where: scopeWhere(req, {
      paymentStatus: "PAID",
      manualPaymentValidatedById: cashierId,
      manualPaymentValidatedAt: { gte: start, lte: end },
    }),
    select: {
      id: true,
      preorderPaymentMode: true,
      paymentProvider: true,
      totalFcfa: true,
      as400InvoiceTotalFcfa: true,
      manualPaymentValidatedAt: true,
      cashierTransactions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          paymentMode: true,
          amountExpectedFcfa: true,
          amountReceivedFcfa: true,
        },
      },
    },
    orderBy: { manualPaymentValidatedAt: "asc" },
  });
}

async function syncClosureSnapshot(tx, closure, orders) {
  const freshLines = buildLineTotalsFromOrders(orders);
  const existingLines = await tx.cashClosureLine.findMany({
    where: { closureId: closure.id },
  });
  const existingByMode = new Map(existingLines.map((line) => [line.paymentMode, line]));
  const freshModes = new Set(freshLines.map((line) => line.paymentMode));

  for (const line of freshLines) {
    const existing = existingByMode.get(line.paymentMode);
    const declaredFcfa = existing ? toAmount(existing.declaredFcfa) : 0;
    await tx.cashClosureLine.upsert({
      where: {
        closureId_paymentMode: {
          closureId: closure.id,
          paymentMode: line.paymentMode,
        },
      },
      update: {
        label: line.label,
        expectedFcfa: line.expectedFcfa,
        declaredFcfa,
        discrepancyFcfa: declaredFcfa - line.expectedFcfa,
        transactionCount: line.transactionCount,
      },
      create: {
        closureId: closure.id,
        paymentMode: line.paymentMode,
        label: line.label,
        expectedFcfa: line.expectedFcfa,
        declaredFcfa,
        discrepancyFcfa: declaredFcfa - line.expectedFcfa,
        transactionCount: line.transactionCount,
      },
    });
  }

  for (const existing of existingLines) {
    if (freshModes.has(existing.paymentMode)) continue;
    if (!isVisibleDeclarationLine(existing)) {
      await tx.cashClosureLine.delete({ where: { id: existing.id } });
      continue;
    }
    await tx.cashClosureLine.update({
      where: { id: existing.id },
      data: {
        expectedFcfa: 0,
        discrepancyFcfa: toAmount(existing.declaredFcfa),
        transactionCount: 0,
      },
    });
  }

  const allLines = await tx.cashClosureLine.findMany({
    where: { closureId: closure.id },
  });
  const totals = summarizeLines(allLines);
  return tx.cashClosure.update({
    where: { id: closure.id },
    data: totals,
    include: includeClosure,
  });
}

async function getOrCreateDraft(req, res) {
  try {
    const dateKey = normalizeDateKey(req.query.date || req.query.dateKey);
    const cashierId = canReview(req) && req.query.cashierId ? String(req.query.cashierId) : req.user?.id;
    const countryId = pickCountryId(req);

    if (!cashierId) {
      return res.status(400).json({ message: "Caissière introuvable pour la clôture." });
    }

    const orders = await fetchOrdersForClosure(req, { dateKey, cashierId });
    const closure = await prisma.$transaction(async (tx) => {
      const saved = await tx.cashClosure.upsert({
        where: {
          countryId_cashierId_dateKey: {
            countryId,
            cashierId,
            dateKey,
          },
        },
        update: {},
        create: {
          countryId,
          cashierId,
          dateKey,
        },
      });

      if (!["DRAFT", "REJECTED"].includes(saved.status)) {
        return tx.cashClosure.findUnique({ where: { id: saved.id }, include: includeClosure });
      }

      return syncClosureSnapshot(tx, saved, orders);
    });

    return res.json({
      ok: true,
      closure: serializeClosure(closure),
      permissions: { canReview: canReview(req) },
    });
  } catch (error) {
    console.error("cash closure draft error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (clôture caisse)",
    });
  }
}

async function listClosures(req, res) {
  try {
    const dateKey = normalizeDateKey(req.query.date || req.query.dateKey);
    const where = scopeWhere(req, { dateKey });
    if (!canReview(req)) where.cashierId = req.user?.id || "__none__";
    if (canReview(req) && req.query.cashierId) where.cashierId = String(req.query.cashierId);
    if (req.query.status) where.status = String(req.query.status).trim().toUpperCase();

    const closures = await prisma.cashClosure.findMany({
      where,
      include: includeClosure,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100,
    });

    return res.json({
      ok: true,
      dateKey,
      closures: closures.map(serializeClosure),
      permissions: { canReview: canReview(req) },
    });
  } catch (error) {
    console.error("cash closure list error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (liste clôtures caisse)",
    });
  }
}

async function updateClosure(req, res) {
  try {
    const closure = await findClosure(req, req.params.id);
    if (!["DRAFT", "REJECTED"].includes(closure.status)) {
      return res.status(400).json({
        message: "Cette clôture ne peut plus être modifiée.",
      });
    }

    const lineInputs = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const note = req.body?.note !== undefined ? String(req.body.note || "").trim() : closure.note;

    const updated = await prisma.$transaction(async (tx) => {
      for (const input of lineInputs) {
        const paymentMode = normalizePaymentMode(input.paymentMode);
        const existing = closure.lines.find((line) => line.paymentMode === paymentMode);
        if (!existing) continue;
        const declaredFcfa = toAmount(input.declaredFcfa);
        await tx.cashClosureLine.update({
          where: { id: existing.id },
          data: {
            declaredFcfa,
            discrepancyFcfa: declaredFcfa - toAmount(existing.expectedFcfa),
            note: input.note !== undefined ? String(input.note || "").trim() : existing.note,
          },
        });
      }

      const lines = await tx.cashClosureLine.findMany({ where: { closureId: closure.id } });
      return tx.cashClosure.update({
        where: { id: closure.id },
        data: {
          ...summarizeLines(lines),
          note,
          status: closure.status === "REJECTED" ? "DRAFT" : closure.status,
          reviewedById: closure.status === "REJECTED" ? null : closure.reviewedById,
          reviewedAt: closure.status === "REJECTED" ? null : closure.reviewedAt,
          reviewNote: closure.status === "REJECTED" ? null : closure.reviewNote,
        },
        include: includeClosure,
      });
    });

    return res.json({ ok: true, closure: serializeClosure(updated) });
  } catch (error) {
    console.error("cash closure update error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (mise à jour clôture)",
    });
  }
}

async function submitClosure(req, res) {
  try {
    const closure = await findClosure(req, req.params.id);
    if (!["DRAFT", "REJECTED"].includes(closure.status)) {
      return res.status(400).json({ message: "Cette clôture a déjà été soumise." });
    }

    const updated = await prisma.cashClosure.update({
      where: { id: closure.id },
      data: {
        status: "SUBMITTED",
        submittedById: req.user?.id || null,
        submittedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        reviewNote: null,
      },
      include: includeClosure,
    });

    return res.json({ ok: true, closure: serializeClosure(updated) });
  } catch (error) {
    console.error("cash closure submit error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (soumission clôture)",
    });
  }
}

async function reviewClosure(req, res, status) {
  try {
    if (!canReview(req)) {
      return res.status(403).json({ message: "Accès réservé au responsable caisse." });
    }

    const closure = await findClosure(req, req.params.id);
    if (closure.status !== "SUBMITTED") {
      return res.status(400).json({
        message: "Seule une clôture soumise peut être validée ou rejetée.",
      });
    }

    const updated = await prisma.cashClosure.update({
      where: { id: closure.id },
      data: {
        status,
        reviewedById: req.user?.id || null,
        reviewedAt: new Date(),
        reviewNote: req.body?.reviewNote ? String(req.body.reviewNote).trim() : null,
      },
      include: includeClosure,
    });

    return res.json({ ok: true, closure: serializeClosure(updated) });
  } catch (error) {
    console.error("cash closure review error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (validation clôture)",
    });
  }
}

module.exports = {
  getOrCreateDraft,
  listClosures,
  updateClosure,
  submitClosure,
  approveClosure: (req, res) => reviewClosure(req, res, "APPROVED"),
  rejectClosure: (req, res) => reviewClosure(req, res, "REJECTED"),
};
