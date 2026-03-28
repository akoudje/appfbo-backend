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
  const latestCashierTx = order?.cashierTransactions?.[0] || null;
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
    cashierTransaction: latestCashierTx
      ? {
          id: latestCashierTx.id,
          paymentMode: latestCashierTx.paymentMode,
          amountExpectedFcfa: latestCashierTx.amountExpectedFcfa,
          amountReceivedFcfa: latestCashierTx.amountReceivedFcfa,
          providerReference: latestCashierTx.providerReference,
          receiptNumber: latestCashierTx.receiptNumber,
          cashDeskLabel: latestCashierTx.cashDeskLabel,
          preparationLaunchedAt: latestCashierTx.preparationLaunchedAt,
          createdAt: latestCashierTx.createdAt,
        }
      : null,
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

function aggregateByPaymentMode(rows, amountField = "amountExpectedFcfa") {
  const summary = new Map();

  for (const row of rows) {
    const key = normalizePaymentMode(row.preorderPaymentMode) || "UNKNOWN";
    const current = summary.get(key) || {
      paymentMode: key,
      count: 0,
      amountFcfa: 0,
    };

    current.count += 1;
    current.amountFcfa += Number(
      row?.[amountField] ||
        row?.cashierTransaction?.[amountField] ||
        row.amountExpectedFcfa ||
        row.totalFcfa ||
        0,
    );
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
    current.amountFcfa += Number(
      row?.cashierTransaction?.amountReceivedFcfa ||
        row.amountExpectedFcfa ||
        row.totalFcfa ||
        0,
    );
    summary.set(cashierId, current);
  }

  return Array.from(summary.values()).sort((a, b) => b.amountFcfa - a.amountFcfa);
}

function sumAmount(rows, amountField = "amountExpectedFcfa") {
  return rows.reduce(
    (sum, row) =>
      sum +
      Number(
        row?.[amountField] ||
          row?.cashierTransaction?.[amountField] ||
          row.amountExpectedFcfa ||
          row.totalFcfa ||
          0,
      ),
    0,
  );
}

async function getWorkspace(req, res) {
  try {
    const { q, paymentMode, dateFrom, dateTo, journalScope = "my" } = req.query;
    const searchConditions =
      q && String(q).trim()
        ? [
            { fboNumero: { contains: String(q).trim(), mode: "insensitive" } },
            { fboNomComplet: { contains: String(q).trim(), mode: "insensitive" } },
            { factureReference: { contains: String(q).trim(), mode: "insensitive" } },
            { preorderNumber: { contains: String(q).trim(), mode: "insensitive" } },
            { parcelNumber: { contains: String(q).trim(), mode: "insensitive" } },
          ]
        : null;

    const toCollectWhere = scopeWhere(req, {
      OR: [
        { status: { in: ["INVOICED", "PAYMENT_PENDING"] } },
      ],
    });

    const toLaunchWhere = scopeWhere(req, {
      status: "PAID",
      paymentStatus: "PAID",
      preparationLaunchedAt: null,
    });

    if (searchConditions) {
      toCollectWhere.AND = [...(toCollectWhere.AND || []), { OR: searchConditions }];
      toLaunchWhere.AND = [...(toLaunchWhere.AND || []), { OR: searchConditions }];
    }

    if (paymentMode && String(paymentMode).trim()) {
      const normalizedMode = String(paymentMode).trim().toUpperCase();
      toCollectWhere.preorderPaymentMode = normalizedMode;
      toLaunchWhere.preorderPaymentMode = normalizedMode;
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

    if (searchConditions) {
      journalWhere.AND = [...(journalWhere.AND || []), { OR: searchConditions }];
    }

    if (paymentMode && String(paymentMode).trim()) {
      journalWhere.preorderPaymentMode = String(paymentMode).trim().toUpperCase();
    }

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
      cashierTransactions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      preparedByAdmin: {
        select: { id: true, fullName: true, role: true },
      },
      preparationLaunchedBy: {
        select: { id: true, fullName: true, role: true },
      },
    };

    const [toCollectOrders, toLaunchOrders, journalOrders] = await Promise.all([
      prisma.preorder.findMany({
        where: toCollectWhere,
        include: includeShape,
        orderBy: [
          { invoicedAt: "asc" },
          { createdAt: "asc" },
        ],
        take: 300,
      }),
      prisma.preorder.findMany({
        where: toLaunchWhere,
        include: includeShape,
        orderBy: [{ paidAt: "asc" }, { invoicedAt: "asc" }, { createdAt: "asc" }],
        take: 300,
      }),
      prisma.preorder.findMany({
        where: journalWhere,
        include: includeShape,
        orderBy: [
          { preparationLaunchedAt: "desc" },
          { paidAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 300,
      }),
    ]);

    const toCollect = toCollectOrders.map(buildOrderSummary);
    const toLaunchPreparation = toLaunchOrders.map(buildOrderSummary);
    const journal = journalOrders.map(buildOrderSummary);
    const pendingCashRows = toCollect.filter(
      (row) =>
        normalizePaymentMode(row.preorderPaymentMode) === "ESPECES" &&
        row.paymentStatus !== "PAID",
    );
    const pendingElectronicRows = toCollect.filter(
      (row) =>
        normalizePaymentMode(row.preorderPaymentMode) !== "ESPECES" &&
        row.paymentStatus !== "PAID",
    );

    return res.json({
      ok: true,
      toCollect,
      toLaunchPreparation,
      journal,
      collectionSummary: {
        total: toCollect.length,
        pendingCash: pendingCashRows.length,
        pendingElectronic: pendingElectronicRows.length,
        expectedAmountFcfa: sumAmount(toCollect),
        byPaymentMode: aggregateByPaymentMode(toCollect),
      },
      launchSummary: {
        total: toLaunchPreparation.length,
        amountFcfa: sumAmount(toLaunchPreparation),
        byPaymentMode: aggregateByPaymentMode(toLaunchPreparation),
      },
      journalSummary: {
        scope,
        total: journal.length,
        totalExpectedFcfa: sumAmount(journal),
        totalReceivedFcfa: sumAmount(journal, "amountReceivedFcfa"),
        byPaymentMode: aggregateByPaymentMode(journal, "amountReceivedFcfa"),
        byCashier: allowConsolidated ? aggregateByCashier(journal) : [],
      },
      financialSummary: {
        dateFrom: from ? from.toISOString() : null,
        dateTo: to ? to.toISOString() : null,
        transactionsCount: journal.length,
        totalExpectedFcfa: sumAmount(journal),
        totalReceivedFcfa: sumAmount(journal, "amountReceivedFcfa"),
        totalToLaunchPreparation: toLaunchPreparation.length,
        totalPendingCollection: toCollect.length,
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
        items: true,
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

      for (const item of order.items || []) {
        await tx.preparationChecklistItem.upsert({
          where: {
            preorderId_preorderItemId: {
              preorderId: order.id,
              preorderItemId: item.id,
            },
          },
          update: {},
          create: {
            preorderId: order.id,
            preorderItemId: item.id,
          },
        });
      }

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

      const latestCashierTx = await tx.cashierTransaction.findFirst({
        where: { preorderId: order.id },
        orderBy: { createdAt: "desc" },
      });

      if (latestCashierTx) {
        await tx.cashierTransaction.update({
          where: { id: latestCashierTx.id },
          data: {
            preparationLaunchedAt: now,
          },
        });
      }

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
