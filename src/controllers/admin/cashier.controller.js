const prisma = require("../../prisma");
const { scopeWhere } = require("../../helpers/countryScope");
const { AdminRole } = require("../../auth/permissions");
const { generateParcelNumber } = require("../../helpers/parcel-number");
const {
  buildPreparationStartedSmsMessage,
  sendPreorderNotification,
} = require("../../services/preorder-notifications.service");

function normalizeDateStart(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function normalizeDateEnd(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(23, 59, 59, 999);
  return dt;
}

function normalizePaymentMode(value) {
  return String(value || "").trim().toUpperCase();
}

function getPayerPhone(order) {
  const latestAttempt = order?.activePayment?.attempts?.[0];
  return (
    latestAttempt?.providerPayerPhone ||
    latestAttempt?.requestPayloadJson?.restrictPayerMobile ||
    latestAttempt?.normalizedPayloadJson?.providerPayerPhone ||
    null
  );
}

function canViewConsolidated(role) {
  return new Set([
    AdminRole.SUPER_ADMIN,
    AdminRole.TECH_ADMIN,
    AdminRole.OPERATIONS_DIRECTOR,
    AdminRole.COUNTER_MANAGER,
  ]).has(String(role || "").trim().toUpperCase());
}

function buildOrderSummary(order) {
  const latestAttempt = order?.activePayment?.attempts?.[0] || null;
  const expectedAmount =
    Number(order?.activePayment?.amountExpectedFcfa || 0) || Number(order?.totalFcfa || 0);

  return {
    id: order.id,
    preorderNumber: order.preorderNumber,
    parcelNumber: order.parcelNumber,
    factureReference: order.factureReference,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentProvider: order.paymentProvider,
    preorderPaymentMode: order.preorderPaymentMode,
    fboNomComplet: order.fboNomComplet,
    fboNumero: order.fboNumero,
    totalFcfa: order.totalFcfa,
    amountExpectedFcfa: expectedAmount,
    paidAt: order.paidAt,
    invoicedAt: order.invoicedAt,
    preparationLaunchedAt: order.preparationLaunchedAt,
    preparedAt: order.preparedAt,
    manualPaymentValidatedAt: order.manualPaymentValidatedAt,
    manualPaymentReference: order.manualPaymentReference,
    manualPaymentProofUrl: order.manualPaymentProofUrl,
    country: order.country || null,
    validatedBy: order.manualPaymentValidatedBy
      ? {
          id: order.manualPaymentValidatedBy.id,
          fullName: order.manualPaymentValidatedBy.fullName,
          role: order.manualPaymentValidatedBy.role,
        }
      : null,
    preparedBy: order.preparedByAdmin
      ? {
          id: order.preparedByAdmin.id,
          fullName: order.preparedByAdmin.fullName,
          role: order.preparedByAdmin.role,
        }
      : null,
    preparationLaunchedBy: order.preparationLaunchedBy
      ? {
          id: order.preparationLaunchedBy.id,
          fullName: order.preparationLaunchedBy.fullName,
          role: order.preparationLaunchedBy.role,
        }
      : null,
    payerPhone: getPayerPhone(order),
    latestAttempt: latestAttempt
      ? {
          id: latestAttempt.id,
          providerSessionId: latestAttempt.providerSessionId,
          providerTransactionId: latestAttempt.providerTransactionId,
          providerPayerPhone: latestAttempt.providerPayerPhone,
          providerStatusLabel: latestAttempt.providerStatusLabel,
          checkoutUrl: latestAttempt.checkoutUrl,
          providerLaunchUrl: latestAttempt.providerLaunchUrl,
          completedAt: latestAttempt.completedAt,
          createdAt: latestAttempt.createdAt,
          requestPayloadJson: latestAttempt.requestPayloadJson || null,
          normalizedPayloadJson: latestAttempt.normalizedPayloadJson || null,
        }
      : null,
    activePayment: order.activePayment
      ? {
          id: order.activePayment.id,
          provider: order.activePayment.provider,
          status: order.activePayment.status,
          amountExpectedFcfa: order.activePayment.amountExpectedFcfa,
          amountPaidFcfa: order.activePayment.amountPaidFcfa,
          providerReference: order.activePayment.providerReference,
          providerTxnId: order.activePayment.providerTxnId,
          initiatedAt: order.activePayment.initiatedAt,
          paidAt: order.activePayment.paidAt,
        }
      : null,
  };
}

function aggregateByPaymentMode(rows) {
  const summary = new Map();

  for (const row of rows) {
    const key = normalizePaymentMode(row.preorderPaymentMode) || "UNKNOWN";
    const current = summary.get(key) || {
      paymentMode: key,
      count: 0,
      amountFcfa: 0,
    };

    current.count += 1;
    current.amountFcfa += Number(row.amountExpectedFcfa || row.totalFcfa || 0);
    summary.set(key, current);
  }

  return Array.from(summary.values()).sort((a, b) => b.count - a.count);
}

function aggregateByCashier(rows) {
  const summary = new Map();

  for (const row of rows) {
    const cashierId = row.preparationLaunchedBy?.id || "UNASSIGNED";
    const cashierName = row.preparationLaunchedBy?.fullName || "Non attribué";
    const current = summary.get(cashierId) || {
      cashierId,
      cashierName,
      count: 0,
      amountFcfa: 0,
    };

    current.count += 1;
    current.amountFcfa += Number(row.amountExpectedFcfa || row.totalFcfa || 0);
    summary.set(cashierId, current);
  }

  return Array.from(summary.values()).sort((a, b) => b.amountFcfa - a.amountFcfa);
}

async function getWorkspace(req, res) {
  try {
    const { q, paymentMode, dateFrom, dateTo, journalScope = "my" } = req.query;
    const queueWhere = scopeWhere(req, {
      OR: [
        { status: { in: ["INVOICED", "PAYMENT_PENDING"] } },
        {
          status: "PAID",
          paymentStatus: "PAID",
          preparationLaunchedAt: null,
        },
      ],
    });

    if (q && String(q).trim()) {
      const qs = String(q).trim();
      queueWhere.OR = [
        { fboNumero: { contains: qs, mode: "insensitive" } },
        { fboNomComplet: { contains: qs, mode: "insensitive" } },
        { factureReference: { contains: qs, mode: "insensitive" } },
        { preorderNumber: { contains: qs, mode: "insensitive" } },
      ];
    }

    if (paymentMode && String(paymentMode).trim()) {
      queueWhere.preorderPaymentMode = String(paymentMode).trim().toUpperCase();
    }

    const journalWhere = scopeWhere(req, {
      OR: [
        {
          status: "PAID",
          paymentStatus: "PAID",
          preparationLaunchedAt: { not: null },
        },
        { status: { in: ["READY", "FULFILLED"] } },
      ],
    });

    const from = normalizeDateStart(dateFrom);
    const to = normalizeDateEnd(dateTo);
    if (from || to) {
      journalWhere.preparationLaunchedAt = {};
      if (from) journalWhere.preparationLaunchedAt.gte = from;
      if (to) journalWhere.preparationLaunchedAt.lte = to;
    }

    const allowConsolidated = canViewConsolidated(req.user?.role);
    const scope = allowConsolidated && journalScope === "all" ? "all" : "my";
    if (scope === "my") {
      journalWhere.preparationLaunchedById = req.user?.id || "__no_user__";
    }

    const includeShape = {
      country: {
        select: { code: true, name: true },
      },
      activePayment: {
        include: {
          attempts: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      manualPaymentValidatedBy: {
        select: { id: true, fullName: true, role: true },
      },
      preparedByAdmin: {
        select: { id: true, fullName: true, role: true },
      },
      preparationLaunchedBy: {
        select: { id: true, fullName: true, role: true },
      },
    };

    const [queueOrders, journalOrders] = await Promise.all([
      prisma.preorder.findMany({
        where: queueWhere,
        include: includeShape,
        orderBy: [
          { status: "asc" },
          { invoicedAt: "asc" },
          { createdAt: "asc" },
        ],
        take: 300,
      }),
      prisma.preorder.findMany({
        where: journalWhere,
        include: includeShape,
        orderBy: [
          { preparationLaunchedAt: "desc" },
          { preparedAt: "desc" },
          { paidAt: "desc" },
        ],
        take: 300,
      }),
    ]);

    const queue = queueOrders.map(buildOrderSummary);
    const journal = journalOrders.map(buildOrderSummary);

    return res.json({
      ok: true,
      queue,
      journal,
      queueSummary: {
        total: queue.length,
        byPaymentMode: aggregateByPaymentMode(queue),
        pendingCash: queue.filter(
          (row) =>
            normalizePaymentMode(row.preorderPaymentMode) === "ESPECES" &&
            row.paymentStatus !== "PAID",
        ).length,
        readyToPrepare: queue.filter((row) => row.status === "PAID").length,
      },
      journalSummary: {
        scope,
        total: journal.length,
        byPaymentMode: aggregateByPaymentMode(journal),
        byCashier: allowConsolidated ? aggregateByCashier(journal) : [],
      },
      permissions: {
        canViewConsolidated: allowConsolidated,
      },
    });
  } catch (error) {
    console.error("cashier workspace error:", error);
    return res.status(500).json({
      message: error.message || "Erreur serveur (cashier workspace)",
    });
  }
}

async function launchPreparation(req, res) {
  try {
    const { id } = req.params;
    const { packingNote } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.status !== "PAID" || order.paymentStatus !== "PAID") {
      return res.status(400).json({
        message:
          "La préparation ne peut être lancée qu'après confirmation du paiement.",
      });
    }

    if (order.preparationLaunchedAt) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        preparationLaunchedAt: order.preparationLaunchedAt,
      });
    }

    const now = new Date();
    const actorAdminId = req.user?.id || null;
    const actorName =
      req.user?.fullName || req.user?.email || req.user?.role || "CAISSE";

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const parcelNumber = order.parcelNumber || generateParcelNumber(order);
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          parcelNumber,
          preparationLaunchedAt: now,
          preparationLaunchedById: actorAdminId,
          packingNote: packingNote
            ? String(packingNote).trim()
            : order.packingNote,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: order.id,
          action: "LAUNCH_PREPARATION",
          note: "Commande transmise à la préparation.",
          meta: {
            actorName,
            launchedAt: now.toISOString(),
            parcelNumber,
          },
          actorAdminId,
        },
      });

      return saved;
    });

    try {
      await sendPreorderNotification({
        preorder: {
          ...order,
          parcelNumber: updatedOrder.parcelNumber,
          preparationLaunchedAt: now,
        },
        purpose: "PREPARATION_STARTED",
        message: buildPreparationStartedSmsMessage({ preorder: order }),
        actorName,
      });
    } catch (smsError) {
      console.error("launchPreparation sms error:", smsError);
    }

    return res.json({
      ok: true,
      order: updatedOrder,
    });
  } catch (error) {
    console.error("launchPreparation error:", error);
    return res.status(500).json({
      message: error.message || "Erreur serveur (launchPreparation)",
    });
  }
}

module.exports = {
  getWorkspace,
  launchPreparation,
};
