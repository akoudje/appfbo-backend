const prisma = require("../../prisma");
const { scopeWhere } = require("../../helpers/countryScope");
const { AdminRole } = require("../../auth/permissions");
const { generateParcelNumber } = require("../../helpers/parcel-number");
const {
  buildPreparationStartedSmsMessage,
  sendPreorderNotification,
} = require("../../services/preorder-notifications.service");
const { publishRealtimeEvent } = require("../../services/realtime-events.service");
const billingQueueService = require("../../services/billingQueue.service");

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

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatFboDigits(value) {
  const digits = digitsOnly(value);
  if (digits.length <= 3) return digits;
  return digits.match(/.{1,3}/g).join("-");
}

function buildFboSearchTerms(value) {
  const raw = String(value || "").trim();
  const formatted = formatFboDigits(raw);
  return Array.from(new Set([raw, formatted].filter(Boolean)));
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
    AdminRole.FINANCE_MANAGER,
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
    createdAt: order.createdAt,
    preorderNumber: order.preorderNumber,
    parcelNumber: order.parcelNumber,
    factureReference: order.factureReference,
    paymentCollectionCode: order.paymentCollectionCode,
    billingEscalationType: order.billingEscalationType,
    as400CertificationStatus: order.as400CertificationStatus,
    as400CertificationReportedAt: order.as400CertificationReportedAt,
    as400CertificationResolvedAt: order.as400CertificationResolvedAt,
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
          email: order.manualPaymentValidatedBy.email,
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
          cashier: latestCashierTx.cashier
            ? {
                id: latestCashierTx.cashier.id,
                fullName: latestCashierTx.cashier.fullName,
                email: latestCashierTx.cashier.email,
                role: latestCashierTx.cashier.role,
              }
            : null,
        }
      : null,
    logs: Array.isArray(order.logs)
      ? order.logs.map((log) => ({
          id: log.id,
          action: log.action,
          note: log.note,
          meta: log.meta || null,
          createdAt: log.createdAt,
        }))
      : [],
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
    const cashierId = row.validatedBy?.id || row.cashierTransaction?.cashier?.id || "UNASSIGNED";
    const cashierName =
      row.validatedBy?.fullName ||
      row.cashierTransaction?.cashier?.fullName ||
      "Non attribué";
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

function aggregateCashierValidation(rows, amountField = "amountReceivedFcfa") {
  return {
    total: rows.length,
    totalExpectedFcfa: sumAmount(rows, "amountExpectedFcfa"),
    totalReceivedFcfa: sumAmount(rows, amountField),
    byPaymentMode: aggregateByPaymentMode(rows, amountField),
    byCashier: aggregateByCashier(rows),
  };
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
    const qs = String(q || "").trim();
    const fboSearchTerms = buildFboSearchTerms(qs);
    const searchConditions =
      qs
        ? [
            ...fboSearchTerms.map((term) => ({
              fboNumero: { contains: term, mode: "insensitive" },
            })),
            { fboNomComplet: { contains: qs, mode: "insensitive" } },
            { factureReference: { contains: qs, mode: "insensitive" } },
            { paymentCollectionCode: { contains: qs, mode: "insensitive" } },
            { preorderNumber: { contains: qs, mode: "insensitive" } },
            { parcelNumber: { contains: qs, mode: "insensitive" } },
            {
              activePayment: {
                attempts: {
                  some: {
                    providerPayerPhone: { contains: qs, mode: "insensitive" },
                  },
                },
              },
            },
            {
              cashierTransactions: {
                some: {
                  receiptNumber: { contains: qs, mode: "insensitive" },
                },
              },
            },
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
      OR: [
        { billingEscalationType: null },
        { billingEscalationType: { not: "AS400_CERTIFICATION_MISSING" } },
        { as400CertificationStatus: null },
        { as400CertificationStatus: { notIn: ["OPEN", "REPORTED"] } },
      ],
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
    const todayStart = normalizeDateStart(new Date());
    const todayEnd = normalizeDateEnd(new Date());
    if (from || to) {
      toLaunchWhere.paidAt = {};
      if (from) toLaunchWhere.paidAt.gte = from;
      if (to) toLaunchWhere.paidAt.lte = to;

      journalWhere.preparationLaunchedAt = {};
      if (from) journalWhere.preparationLaunchedAt.gte = from;
      if (to) journalWhere.preparationLaunchedAt.lte = to;
    }

    const allowConsolidated = canViewConsolidated(req.user?.role);
    const scope = allowConsolidated && journalScope === "all" ? "all" : "my";
    if (scope === "my") {
      journalWhere.preparationLaunchedById = req.user?.id || "__no_user__";
    }

    const baseValidationWhere = scopeWhere(req, {
      paymentStatus: "PAID",
      manualPaymentValidatedAt: {
        not: null,
      },
    });

    const validationFrom = from || todayStart;
    const validationTo = to || todayEnd;
    baseValidationWhere.manualPaymentValidatedAt = {
      not: null,
      gte: validationFrom,
      lte: validationTo,
    };
    if (searchConditions) {
      baseValidationWhere.AND = [...(baseValidationWhere.AND || []), { OR: searchConditions }];
    }
    if (paymentMode && String(paymentMode).trim()) {
      baseValidationWhere.preorderPaymentMode = String(paymentMode).trim().toUpperCase();
    }

    const personalValidationWhere = {
      ...baseValidationWhere,
      manualPaymentValidatedById: req.user?.id || "__no_user__",
    };
    const validationWhere = allowConsolidated ? baseValidationWhere : personalValidationWhere;

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
        select: { id: true, fullName: true, email: true, role: true },
      },
      cashierTransactions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          cashier: { select: { id: true, fullName: true, email: true, role: true } },
        },
      },
      preparedByAdmin: {
        select: { id: true, fullName: true, role: true },
      },
      preparationLaunchedBy: {
        select: { id: true, fullName: true, role: true },
      },
      logs: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          action: true,
          note: true,
          meta: true,
          createdAt: true,
        },
      },
    };

    const [
      toCollectOrders,
      toLaunchOrders,
      journalOrders,
      validationOrders,
      personalValidationOrders,
    ] = await Promise.all([
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
      prisma.preorder.findMany({
        where: validationWhere,
        include: includeShape,
        orderBy: [
          { manualPaymentValidatedAt: "desc" },
          { paidAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 500,
      }),
      allowConsolidated
        ? prisma.preorder.findMany({
            where: personalValidationWhere,
            include: includeShape,
            orderBy: [
              { manualPaymentValidatedAt: "desc" },
              { paidAt: "desc" },
              { createdAt: "desc" },
            ],
            take: 500,
          })
        : Promise.resolve([]),
    ]);

    const toCollect = toCollectOrders.map(buildOrderSummary);
    const toLaunchPreparation = toLaunchOrders.map(buildOrderSummary);
    const journal = journalOrders.map(buildOrderSummary);
    const validations = validationOrders.map(buildOrderSummary);
    const personalValidations = personalValidationOrders.map(buildOrderSummary);
    const generalValidationSummary = aggregateCashierValidation(validations);
    const personalValidationSummary = allowConsolidated
      ? aggregateCashierValidation(personalValidations)
      : generalValidationSummary;
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
      validationSummary: {
        scope: allowConsolidated ? "all" : "my",
        dateFrom: validationFrom ? validationFrom.toISOString() : null,
        dateTo: validationTo ? validationTo.toISOString() : null,
        ...generalValidationSummary,
        personal: personalValidationSummary,
        general: generalValidationSummary,
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

async function getPaidToday(req, res) {
  try {
    const { date } = req.query;
    const dayStart = normalizeDateStart(date) || normalizeDateStart(new Date());
    const dayEnd = normalizeDateEnd(date) || normalizeDateEnd(new Date());

    const where = scopeWhere(req, {
      paymentStatus: "PAID",
      paidAt: { gte: dayStart, lte: dayEnd },
    });

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
        select: { id: true, fullName: true, email: true, role: true },
      },
      cashierTransactions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          cashier: { select: { id: true, fullName: true, email: true, role: true } },
        },
      },
    };

    const orders = await prisma.preorder.findMany({
      where,
      include: includeShape,
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
      take: 1000,
    });

    const rows = orders.map(buildOrderSummary);

    return res.json({
      ok: true,
      date: dayStart.toISOString().slice(0, 10),
      total: rows.length,
      totalAmountFcfa: sumAmount(rows, "amountReceivedFcfa"),
      rows,
    });
  } catch (error) {
    console.error("cashier getPaidToday error:", error);
    return res.status(500).json({
      message: error.message || "Erreur serveur (cashier paid-today)",
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

    if (
      order.billingEscalationType === "AS400_CERTIFICATION_MISSING" &&
      ["OPEN", "REPORTED"].includes(order.as400CertificationStatus || "")
    ) {
      return res.status(400).json({
        message:
          "Préparation bloquée : facture absente dans l'application de certification AS400. Le contentieux doit être résolu par la facturation.",
      });
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

    publishRealtimeEvent({
      countryId: order.countryId || req.countryId,
      eventKey: "preparation_queue_new",
      orderId: order.id,
      meta: {
        status: "PAID",
        preparationLaunchedAt: now.toISOString(),
      },
    });

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

async function reportAs400CertificationMissing(req, res) {
  try {
    const { id } = req.params;
    const { note } = req.body || {};
    const actorAdminId = req.user?.id || null;

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: {
        id: true,
        countryId: true,
        status: true,
        paymentStatus: true,
        factureReference: true,
        as400InvoiceTotalFcfa: true,
        totalFcfa: true,
        billingEscalationType: true,
        as400CertificationStatus: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.status !== "PAID" || order.paymentStatus !== "PAID") {
      return res.status(400).json({
        message:
          "Le signalement AS400 est réservé aux commandes dont le paiement est déjà confirmé.",
      });
    }

    const result = await billingQueueService.escalateBillingWork({
      preorderId: order.id,
      userId: actorAdminId,
      countryId: order.countryId || req.countryId,
      escalationType: billingQueueService.AS400_CERTIFICATION_MISSING_TYPE,
      as400Reference: order.factureReference,
      as400AmountFcfa: order.as400InvoiceTotalFcfa || order.totalFcfa,
      reason:
        String(note || "").trim() ||
        "Facture absente dans l'application de certification AS400, signalée par la caisse.",
    });

    publishRealtimeEvent({
      countryId: order.countryId || req.countryId,
      eventKey: "as400_certification_dispute_new",
      orderId: order.id,
      meta: {
        billingEscalationType: result?.billingEscalationType || null,
        as400CertificationStatus: result?.as400CertificationStatus || null,
      },
    });

    return res.json({ ok: true, order: result });
  } catch (error) {
    console.error("reportAs400CertificationMissing error:", error);
    return res.status(500).json({
      message: error.message || "Erreur serveur (reportAs400CertificationMissing)",
    });
  }
}


module.exports = {
  getWorkspace,
  getPaidToday,
  launchPreparation,
  reportAs400CertificationMissing,
};
