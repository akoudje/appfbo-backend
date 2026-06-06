const prisma = require("../../prisma");
const fs = require("fs");
const path = require("path");
const { generateParcelNumber } = require("../../helpers/parcel-number");
const { AdminRole } = require("../../auth/permissions");

const {
  invoiceAndSendPreorder,
  buildInvoiceMessage,
  buildInvoicePreview,
} = require("../../services/invoiceAndSendPreorder.service");
const {
  computePreorderTotals,
  computeLineFromProduct,
} = require("../../services/pricing.service");
const {
  buildOrderReadySmsMessage,
  buildOrderFulfilledSmsMessage,
  sendPreorderNotification,
} = require("../../services/preorder-notifications.service");
const { normalizePhone } = require("../../services/sms.service");
const { normalizeEmail } = require("../../services/email.service");
const { publishRealtimeEvent } = require("../../services/realtime-events.service");

const {
  scopeWhere,
  safeFindUniqueScoped,
} = require("../../helpers/countryScope");
const {
  streamBankProofFileToResponse,
} = require("../../utils/bankProofFiles");
const { computePaymentPricing } = require("../../payments/payment-pricing");

function parseIntSafe(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
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

function normalizeRelaunchPaymentWindowMinutes(body = {}) {
  const rawMinutes =
    body.durationMinutes ??
    body.paymentWindowMinutes ??
    body.minutes ??
    null;
  const rawHours =
    body.durationHours ??
    body.paymentWindowHours ??
    body.hours ??
    null;

  const minutes = Number(rawMinutes);
  if (Number.isFinite(minutes) && minutes > 0) {
    return Math.min(30, Math.max(10, Math.round(minutes)));
  }

  const hours = Number(rawHours);
  if (Number.isFinite(hours) && hours > 0) {
    return Math.min(30, Math.max(10, Math.round(hours * 60)));
  }

  return 10;
}

function normalizeDateStart(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function normalizeDateEnd(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(23, 59, 59, 999);
  return dt;
}

const ALLOWED = {
  DRAFT: ["CANCELLED"],
  SUBMITTED: ["INVOICED", "CANCELLED"],
  INVOICED: ["PAYMENT_PENDING", "PAID", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "CANCELLED"],
  PAID: ["READY", "CANCELLED"],
  READY: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

function assertTransition(from, to) {
  const ok = (ALLOWED[from] || []).includes(to);
  if (!ok) {
    const err = new Error(`Transition invalide ${from} -> ${to}`);
    err.statusCode = 400;
    throw err;
  }
}

async function addLogTx(tx, preorderId, action, note, meta, actorAdminId = null) {
  await tx.preorderLog.create({
    data: {
      preorderId,
      action,
      note: note || null,
      meta: meta || undefined,
      actorAdminId: actorAdminId || null,
    },
  });
}

async function ensurePreparationChecklist(tx, preorder) {
  const items = Array.isArray(preorder?.items) ? preorder.items : [];
  for (const item of items) {
    await tx.preparationChecklistItem.upsert({
      where: {
        preorderId_preorderItemId: {
          preorderId: preorder.id,
          preorderItemId: item.id,
        },
      },
      update: {},
      create: {
        preorderId: preorder.id,
        preorderItemId: item.id,
      },
    });
  }
}

function actorLabel(req) {
  return (
    req.user?.fullName ||
    req.user?.email ||
    req.user?.id ||
    req.user?.role ||
    "admin"
  );
}

function resolveOrderAmountToPayFcfa(order) {
  const activeExpected = Number(order?.activePayment?.amountExpectedFcfa || 0);
  if (activeExpected > 0) return activeExpected;

  const pricing = computePaymentPricing({
    preorderPaymentMode: order?.preorderPaymentMode,
    paymentMode: order?.paymentMode,
    paymentProvider: order?.paymentProvider,
    orderTotalFcfa: Number(order?.totalFcfa || 0),
  });

  return Number(pricing.amountToPayFcfa || 0);
}

function isGlobalAdminRole(role) {
  const normalized = String(role || "").trim().toUpperCase();
  return (
    normalized === AdminRole.SUPER_ADMIN ||
    normalized === AdminRole.TECH_ADMIN
  );
}

function canRegularizeFulfillment(role) {
  const normalized = String(role || "").trim().toUpperCase();
  return (
    normalized === AdminRole.SUPER_ADMIN ||
    normalized === AdminRole.TECH_ADMIN ||
    normalized === AdminRole.OPERATIONS_DIRECTOR
  );
}

function normalizeOptionalNotificationPhone(value) {
  if (value === undefined) return undefined;
  const raw = String(value || "").trim();
  if (!raw) return null;
  return normalizePhone(raw) || "__INVALID_PHONE__";
}

function normalizeOptionalNotificationEmail(value) {
  if (value === undefined) return undefined;
  const raw = String(value || "").trim();
  if (!raw) return null;
  return normalizeEmail(raw) || "__INVALID_EMAIL__";
}

function toAscii(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .trim();
}

function escapePdfText(value) {
  return toAscii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createSimplePdf(lines = []) {
  const top = 800;
  const step = 14;
  const maxLines = 48;
  const clippedLines = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    clippedLines.push("... (suite non affichee)");
  }

  const streamBody = clippedLines
    .map((line, index) => {
      const y = top - index * step;
      return `BT /F1 11 Tf 40 ${y} Td (${escapePdfText(line)}) Tj ET`;
    })
    .join("\n");

  const stream = `${streamBody}\n`;
  const streamLength = Buffer.byteLength(stream, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

function buildOrdersListWhere(req, overrides = {}) {
  const {
    status,
    q,
    dateFrom,
    dateTo,
    paymentStatus,
    preorderPaymentMode,
    billingWorkStatus,
    billingPriority,
    as400Reference,
    as400Amount,
    lateWaveReview,
    assignedOnly,
    assignedToMe,
    invoicerId,
  } = req.query;

  const where = scopeWhere(req);
  const includeDrafts = String(req.query.includeDrafts) === "true";
  const includeCancelled = String(req.query.includeCancelled) === "true";

  if (!status && !overrides.status) {
    const excludedStatuses = [];
    if (!includeDrafts) excludedStatuses.push("DRAFT");
    if (!includeCancelled) excludedStatuses.push("CANCELLED");

    if (excludedStatuses.length === 1) {
      where.status = { not: excludedStatuses[0] };
    } else if (excludedStatuses.length > 1) {
      where.status = { notIn: excludedStatuses };
    }
  }

  if (status) where.status = status;
  if (paymentStatus) where.paymentStatus = paymentStatus;
  if (preorderPaymentMode) {
    where.preorderPaymentMode = String(preorderPaymentMode).trim().toUpperCase();
  }
  if (billingWorkStatus) where.billingWorkStatus = billingWorkStatus;
  if (billingPriority) {
    where.billingPriority = String(billingPriority).trim().toUpperCase();
  }
  if (as400Reference && String(as400Reference).trim()) {
    where.factureReference = {
      contains: String(as400Reference).trim(),
      mode: "insensitive",
    };
  }
  if (
    as400Amount !== undefined &&
    as400Amount !== null &&
    String(as400Amount).trim() !== ""
  ) {
    const parsedAs400Amount = Number(String(as400Amount).replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(parsedAs400Amount)) {
      where.as400InvoiceTotalFcfa = Math.round(parsedAs400Amount);
    }
  }
  if (String(lateWaveReview) === "true") {
    where.status = "CANCELLED";
    where.paymentStatus = "PAID";
    where.billingWorkStatus = "ESCALATED";
    where.OR = [
      { paymentProvider: "WAVE" },
      { preorderPaymentMode: "WAVE" },
    ];
  }

  if (String(assignedToMe) === "true") {
    where.assignedInvoicerId = req.user?.id || "__no_user__";
  } else if (String(assignedOnly) === "true") {
    where.assignedInvoicerId = { not: null };
  }

  if (invoicerId && String(invoicerId).trim()) {
    where.assignedInvoicerId = String(invoicerId).trim();
  }

  if (q && String(q).trim()) {
    const qs = String(q).trim();
    const fboSearchTerms = buildFboSearchTerms(qs);
    where.OR = [
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
    ];
  }

  const from = dateFrom ? normalizeDateStart(String(dateFrom)) : null;
  const to = dateTo ? normalizeDateEnd(String(dateTo)) : null;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  return { ...where, ...overrides };
}

async function listOrders(req, res) {
  try {
    const {
      status,
      q,
      dateFrom,
      dateTo,
      sort = "createdAt",
      dir = "desc",
      paymentStatus,
      preorderPaymentMode,
      billingWorkStatus,
      billingPriority,
      as400Reference,
      as400Amount,
      assignedOnly,
      assignedToMe,
      invoicerId,
    } = req.query;

    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const pageSize = Math.min(
      100,
      Math.max(10, parseIntSafe(req.query.pageSize, 20)),
    );
    const skip = (page - 1) * pageSize;

    const where = buildOrdersListWhere(req);

    const sortMap = {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      total: "totalFcfa",
      totalFcfa: "totalFcfa",
      billingSlaDeadlineAt: "billingSlaDeadlineAt",
      billingQueueEnteredAt: "billingQueueEnteredAt",
      billingPriority: "billingPriority",
      assignedAt: "assignedAt",
      billingLastActivityAt: "billingLastActivityAt",
      billingEscalatedAt: "billingEscalatedAt",
    };
    const sortField = sortMap[String(sort || "").trim()] || "createdAt";
    const sortDir = dir === "asc" ? "asc" : "desc";
    const orderBy = [{ [sortField]: sortDir }, { createdAt: "desc" }];

    const [totalCount, orders] = await Promise.all([
      prisma.preorder.count({ where }),
      prisma.preorder.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          paymentProvider: true,
          preorderPaymentMode: true,
          totalFcfa: true,
          fboGrade: true,
          billingGrade: true,
          indicativeTotalFcfa: true,
          computedGradeTotalFcfa: true,
          as400InvoiceTotalFcfa: true,
          fboNumero: true,
          fboNomComplet: true,
          pointDeVente: true,
          deliveryMode: true,
          parcelNumber: true,
          factureReference: true,
          paymentCollectionCode: true,
          billingWorkStatus: true,
          preparationLaunchedAt: true,
          billingPriority: true,
          billingQueueEnteredAt: true,
          assignedAt: true,
          billingSlaDeadlineAt: true,
          createdAt: true,
          updatedAt: true,
          preorderNumber: true,
          paidAt: true,
          preparedAt: true,
          fulfilledAt: true,
          assignedInvoicerId: true,
          assignedInvoicer: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          _count: { select: { items: true } },
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      data: orders,
    });
  } catch (e) {
    console.error("listOrders error:", e);
    return res.status(500).json({ message: "Erreur serveur (listOrders)" });
  }
}

async function getSubmittedOrdersExport(req, res) {
  try {
    const where = buildOrdersListWhere(req, { status: "SUBMITTED" });

    const orders = await prisma.preorder.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { preorderNumber: "asc" }],
      select: {
        id: true,
        preorderNumber: true,
        fboNomComplet: true,
        fboNumero: true,
        createdAt: true,
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            qty: true,
            productSkuSnapshot: true,
            productNameSnapshot: true,
            product: {
              select: {
                sku: true,
                nom: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      totalCount: orders.length,
      data: orders.map((order) => ({
        id: order.id,
        preorderNumber: order.preorderNumber || "",
        fboNomComplet: order.fboNomComplet || "",
        fboNumero: order.fboNumero || "",
        createdAt: order.createdAt,
        items: Array.isArray(order.items)
          ? order.items.map((item) => ({
              id: item.id,
              qty: Number(item.qty || 0),
              sku:
                item.productSkuSnapshot ||
                item.product?.sku ||
                item.productNameSnapshot ||
                item.product?.nom ||
                "",
            }))
          : [],
      })),
    });
  } catch (e) {
    console.error("getSubmittedOrdersExport error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (getSubmittedOrdersExport)" });
  }
}

async function getOrderById(req, res) {
  try {
    const { id } = req.params;
    const order = await safeFindUniqueScoped(
      prisma.preorder,
      req,
      id,
      {},
      {
        include: {
          items: {
            include: { product: true },
            orderBy: { createdAt: "asc" },
          },
          country: {
            select: {
              code: true,
              name: true,
            },
          },
          fbo: true,
          assignedInvoicer: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          invoicedByAdmin: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          manualPaymentValidatedBy: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          preparationLaunchedBy: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          pickupCodeVerifiedBy: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          preparedByAdmin: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          fulfilledByAdmin: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          cancelledByAdmin: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          activePayment: {
            include: {
              attempts: {
                orderBy: { createdAt: "desc" },
              },
              refunds: {
                orderBy: { createdAt: "desc" },
              },
            },
          },
          payments: {
            include: {
              attempts: {
                orderBy: { createdAt: "desc" },
              },
              refunds: {
                orderBy: { createdAt: "desc" },
              },
            },
            orderBy: { createdAt: "desc" },
          },
          cashierTransactions: {
            orderBy: { createdAt: "desc" },
            include: {
              cashier: {
                select: { id: true, fullName: true, email: true, role: true },
              },
            },
          },
          paymentTransactionLogs: {
            orderBy: { createdAt: "desc" },
            take: 200,
            include: {
              actorAdmin: {
                select: { id: true, fullName: true, email: true, role: true },
              },
            },
          },
          logs: {
            orderBy: { createdAt: "desc" },
            include: {
              actorAdmin: {
                select: { id: true, fullName: true, email: true, role: true },
              },
            },
          },
          stockMovements: {
            orderBy: { createdAt: "desc" },
            include: {
              product: { select: { id: true, sku: true, nom: true } },
              createdByAdmin: {
                select: { id: true, fullName: true, email: true, role: true },
              },
            },
          },
          messages: {
            include: {
              events: { orderBy: { createdAt: "desc" } },
            },
            orderBy: { createdAt: "desc" },
          },
          bankPaymentProofs: {
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              id: true,
              status: true,
              declaredAmountFcfa: true,
              reference: true,
              note: true,
              fileUrl: true,
              fileMimeType: true,
              fileSizeBytes: true,
              originalFileName: true,
              submittedAt: true,
              reviewedAt: true,
              rejectionReason: true,
            },
          },
          preparationItems: {
            orderBy: { createdAt: "asc" },
            include: {
              preorderItem: {
                include: {
                  product: true,
                },
              },
              checkedBy: {
                select: { id: true, fullName: true, email: true, role: true },
              },
            },
          },
          preparationAnomalies: {
            orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
            include: {
              preorderItem: {
                include: {
                  product: true,
                },
              },
              createdBy: {
                select: { id: true, fullName: true, email: true, role: true },
              },
              resolvedBy: {
                select: { id: true, fullName: true, email: true, role: true },
              },
            },
          },
        },
      },
    );

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status) && order.items?.length) {
      await prisma.$transaction(async (tx) => {
        await ensurePreparationChecklist(tx, order);
      });

      const hydratedOrder = await safeFindUniqueScoped(
        prisma.preorder,
        req,
        id,
        {},
        {
          include: {
            items: {
              include: { product: true },
              orderBy: { createdAt: "asc" },
            },
            country: { select: { code: true, name: true } },
            fbo: true,
            assignedInvoicer: { select: { id: true, fullName: true, email: true, role: true } },
            invoicedByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
            manualPaymentValidatedBy: { select: { id: true, fullName: true, email: true, role: true } },
            preparationLaunchedBy: { select: { id: true, fullName: true, email: true, role: true } },
            pickupCodeVerifiedBy: { select: { id: true, fullName: true, email: true, role: true } },
            preparedByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
            fulfilledByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
            cancelledByAdmin: { select: { id: true, fullName: true, email: true, role: true } },
            activePayment: { include: { attempts: { orderBy: { createdAt: "desc" } }, refunds: { orderBy: { createdAt: "desc" } } } },
            payments: { include: { attempts: { orderBy: { createdAt: "desc" } }, refunds: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } },
            cashierTransactions: { orderBy: { createdAt: "desc" }, include: { cashier: { select: { id: true, fullName: true, email: true, role: true } } } },
            paymentTransactionLogs: { orderBy: { createdAt: "desc" }, take: 200, include: { actorAdmin: { select: { id: true, fullName: true, email: true, role: true } } } },
            logs: { orderBy: { createdAt: "desc" }, include: { actorAdmin: { select: { id: true, fullName: true, email: true, role: true } } } },
            stockMovements: { orderBy: { createdAt: "desc" }, include: { product: { select: { id: true, sku: true, nom: true } }, createdByAdmin: { select: { id: true, fullName: true, email: true, role: true } } } },
            messages: { include: { events: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } },
            bankPaymentProofs: {
              orderBy: { createdAt: "desc" },
              take: 10,
              select: {
                id: true,
                status: true,
                declaredAmountFcfa: true,
                reference: true,
                note: true,
                fileUrl: true,
                fileMimeType: true,
                fileSizeBytes: true,
                originalFileName: true,
                submittedAt: true,
                reviewedAt: true,
                rejectionReason: true,
              },
            },
            preparationItems: {
              orderBy: { createdAt: "asc" },
              include: { preorderItem: { include: { product: true } }, checkedBy: { select: { id: true, fullName: true, email: true, role: true } } },
            },
            preparationAnomalies: {
              orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
              include: {
                preorderItem: { include: { product: true } },
                createdBy: { select: { id: true, fullName: true, email: true, role: true } },
                resolvedBy: { select: { id: true, fullName: true, email: true, role: true } },
              },
            },
          },
        },
      );

      return res.json(hydratedOrder);
    }

    return res.json(order);
  } catch (e) {
    console.error("getOrderById error:", e);
    return res.status(500).json({ message: "Erreur serveur (getOrderById)" });
  }
}

async function listOrderMessages(req, res) {
  try {
    const { id } = req.params;

    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: { id: true },
    });

    if (!preorder) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const messages = await prisma.orderMessage.findMany({
      where: { preorderId: id },
      include: {
        events: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(messages);
  } catch (e) {
    console.error("listOrderMessages error:", e);
    return res.status(500).json({
      message: "Erreur serveur (listOrderMessages)",
    });
  }
}

async function downloadBankProofFile(req, res) {
  try {
    const { id, proofId } = req.params;

    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: { id: true },
    });

    if (!preorder) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const proof = await prisma.bankPaymentProof.findFirst({
      where: {
        id: proofId,
        preorderId: preorder.id,
      },
      select: {
        id: true,
        fileUrl: true,
        fileMimeType: true,
        originalFileName: true,
      },
    });

    if (!proof) {
      return res.status(404).json({ message: "Preuve introuvable" });
    }

    const streamed = await streamBankProofFileToResponse({
      res,
      fileUrl: proof.fileUrl,
      fileMimeType: proof.fileMimeType,
      originalFileName: proof.originalFileName,
    });
    if (!streamed) {
      return res.status(404).json({ message: "Fichier preuve introuvable" });
    }
    return undefined;
  } catch (e) {
    console.error("downloadBankProofFile error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur (downloadBankProofFile)",
    });
  }
}

async function downloadLegacyManualProofFile(req, res) {
  try {
    const { id } = req.params;

    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: {
        id: true,
        manualPaymentProofUrl: true,
      },
    });

    if (!preorder) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const streamed = await streamBankProofFileToResponse({
      res,
      fileUrl: preorder.manualPaymentProofUrl,
      fileMimeType: null,
      originalFileName: preorder.manualPaymentReference || "proof",
    });
    if (!streamed) {
      return res.status(404).json({ message: "Fichier preuve introuvable" });
    }
    return undefined;
  } catch (e) {
    console.error("downloadLegacyManualProofFile error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur (downloadLegacyManualProofFile)",
    });
  }
}

async function getDeliveryNotePdf(req, res) {
  try {
    const { id } = req.params;
    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: {
        id: true,
        preorderNumber: true,
        parcelNumber: true,
        fboNomComplet: true,
        fboNumero: true,
        totalFcfa: true,
        deliveryMode: true,
        fulfillmentMode: true,
        pickupPointLabel: true,
        deliveryCarrier: true,
        items: {
          select: {
            id: true,
            qty: true,
            productSkuSnapshot: true,
            productNameSnapshot: true,
            product: {
              select: {
                sku: true,
                nom: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const nowLabel = new Date().toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
    const unitCount = (order.items || []).reduce(
      (sum, item) => sum + Number(item?.qty || 0),
      0,
    );

    const lines = [
      "BON DE LIVRAISON",
      "",
      `Colis: ${order.parcelNumber || "-"}`,
      `Precommande: ${order.preorderNumber || order.id || "-"}`,
      `Client: ${order.fboNomComplet || "-"} (FBO ${order.fboNumero || "-"})`,
      `Date impression: ${nowLabel}`,
      `Mode remise: ${order.fulfillmentMode || order.deliveryMode || "-"}`,
      `Point retrait: ${order.pickupPointLabel || "-"}`,
      `Transporteur: ${order.deliveryCarrier || "-"}`,
      `Total commande: ${Number(order.totalFcfa || 0)} FCFA`,
      "",
      "Produits:",
      "SKU | Nom | Qt",
      "-----------------------------------------------",
      ...(order.items || []).map((item) => {
        const sku = item?.productSkuSnapshot || item?.product?.sku || "-";
        const nom = item?.productNameSnapshot || item?.product?.nom || "Produit";
        const qty = Number(item?.qty || 0);
        return `${sku} | ${nom} | ${qty}`;
      }),
      "-----------------------------------------------",
      `Lignes: ${itemCount} | Unites: ${unitCount}`,
    ];

    const pdfBuffer = createSimplePdf(lines);
    const fileName = `bon-livraison-${order.parcelNumber || order.preorderNumber || order.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    return res.send(pdfBuffer);
  } catch (e) {
    console.error("getDeliveryNotePdf error:", e);
    return res.status(500).json({ message: "Erreur serveur (getDeliveryNotePdf)" });
  }
}

async function updateOrderStatus(req, res) {
  return res.status(400).json({
    message:
      "Endpoint générique désactivé. Utiliser les endpoints métier dédiés.",
  });
}

async function getInvoicePreview(req, res) {
  try {
    const { id } = req.params;
    const { fboGrade, invoiceAmountFcfa } = req.query || {};

    const result = await buildInvoicePreview({
      preorderId: id,
      billingGradeInput: fboGrade,
      invoiceAmountOverrideInput: invoiceAmountFcfa,
    });

    return res.json(result);
  } catch (e) {
    if (e.message === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (e.message === "PREORDER_EMPTY_ITEMS") {
      return res.status(400).json({
        message:
          "Commande incohérente : elle ne contient aucun article et ne peut pas être facturée.",
      });
    }

    if (e.message === "INVALID_FBO_GRADE") {
      return res.status(400).json({
        message: "Le grade de facturation est invalide.",
      });
    }

    if (e.message === "INVALID_INVOICE_AMOUNT") {
      return res.status(400).json({
        message: "Le montant final de facturation est invalide.",
      });
    }

    if (e.message === "INVALID_NOTIFICATION_EMAIL") {
      return res.status(400).json({
        message: "Adresse email de notification invalide.",
      });
    }

    console.error("getInvoicePreview error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur (getInvoicePreview)",
    });
  }
}

async function invoiceOrder(req, res) {
  try {
    console.log("[admin/orders.controller][invoiceOrder] HIT", {
      orderId: req.params?.id,
      hasReq: Boolean(req),
      originalUrl: req.originalUrl,
      userId: req.user?.id || null,
    });

    const { id } = req.params;
    const {
      factureReference,
      whatsappTo,
      notificationEmail,
      note,
      fboGrade,
      invoiceAmountFcfa,
    } =
      req.body || {};

    const actorName = actorLabel(req);
    const actorAdminId = req.user?.id || null;

    const result = await invoiceAndSendPreorder({
      req,
      preorderId: id,
      actorName,
      actorAdminId,
      invoiceRefInput: factureReference,
      whatsappToInput: whatsappTo,
      notificationEmailInput: notificationEmail,
      invoiceNote: note,
      billingGradeInput: fboGrade,
      invoiceAmountOverrideInput: invoiceAmountFcfa,
    });

    publishRealtimeEvent({
      countryId: result?.preorder?.countryId || req.countryId,
      eventKey: "cashier_collect_new",
      orderId: result?.preorder?.id || id,
      meta: {
        status: result?.preorder?.status || "INVOICED",
        paymentStatus: result?.preorder?.paymentStatus || null,
      },
    });

    return res.json(result.preorder);
  } catch (e) {
    console.error("invoiceOrder error:", e);

    if (e.message === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (e.message === "PREORDER_NOT_INVOICEABLE") {
      return res.status(400).json({
        message: "Cette commande ne peut pas être facturée actuellement.",
      });
    }

    if (e.message === "PREORDER_EMPTY_ITEMS") {
      return res.status(400).json({
        message:
          "Commande incohérente : elle ne contient aucun article et ne peut pas être facturée.",
      });
    }

    if (e.message === "PREORDER_ID_REQUIRED") {
      return res.status(400).json({
        message: "Identifiant de commande manquant.",
      });
    }

    if (e.message === "INVALID_FBO_GRADE") {
      return res.status(400).json({
        message: "Le grade de facturation est invalide.",
      });
    }

    if (e.message === "INVALID_INVOICE_AMOUNT") {
      return res.status(400).json({
        message: "Le montant final de facturation est invalide.",
      });
    }

    if (e.message === "INVALID_NOTIFICATION_EMAIL") {
      return res.status(400).json({
        message: "Adresse email de notification invalide.",
      });
    }

    if (e.message === "INVOICE_REFERENCE_REQUIRED") {
      return res.status(400).json({
        message: "La référence AS400 est obligatoire pour facturer la précommande.",
      });
    }

    return res.status(500).json({
      message: e.message || "Erreur serveur (invoiceOrder)",
    });
  }
}

async function relaunchPayment(req, res) {
  const { id } = req.params;
  const actorName = actorLabel(req);
  const actorAdminId = req.user?.id || null;
  const durationMinutes = normalizeRelaunchPaymentWindowMinutes(req.body || {});
  const paymentExpiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
  const note = String(req.body?.note || "").trim();

  try {
    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: true,
        logs: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const status = String(order.status || "").toUpperCase();
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    if (status !== "CANCELLED" || paymentStatus === "PAID") {
      return res.status(400).json({
        message:
          "Seule une commande annulée et non payée peut être relancée pour paiement.",
      });
    }

    if (!Array.isArray(order.items) || order.items.length === 0) {
      return res.status(400).json({
        message:
          "Commande incohérente : elle ne contient aucun article et ne peut pas être relancée.",
      });
    }

    const autoCancelLog = order.logs.find(
      (log) =>
        String(log.action || "").toUpperCase() === "CANCEL" &&
        String(log.meta?.mode || "").toUpperCase() ===
          "AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW",
    );
    const cancelReason = String(order.cancelReason || "").toLowerCase();
    const isAutoExpiredCancel =
      Boolean(autoCancelLog) ||
      (cancelReason.includes("automatique") &&
        cancelReason.includes("sans paiement"));

    if (!isAutoExpiredCancel) {
      return res.status(400).json({
        message:
          "Cette relance est réservée aux commandes annulées automatiquement après expiration du délai de paiement.",
      });
    }

    if (!String(order.factureReference || "").trim()) {
      return res.status(400).json({
        message:
          "Impossible de relancer cette commande : aucune référence AS400 n'est enregistrée.",
      });
    }

    const previousSnapshot = {
      status: order.status,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      cancelledById: order.cancelledById,
      billingWorkStatus: order.billingWorkStatus,
      billingCompletedAt: order.billingCompletedAt,
      activePaymentId: order.activePaymentId,
      paidAt: order.paidAt,
    };

    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: {
          preorderId: order.id,
          status: {
            notIn: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"],
          },
        },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
      });

      await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "SUBMITTED",
          paymentStatus: "UNPAID",
          cancelledAt: null,
          cancelReason: null,
          cancelledById: null,
          activePaymentId: null,
          paidAt: null,
          billingWorkStatus: "QUEUED",
          billingQueueEnteredAt: new Date(),
          billingCompletedAt: null,
          billingLastActivityAt: new Date(),
          paymentExpiresAt,
        },
      });

      await addLogTx(
        tx,
        order.id,
        "PAYMENT_PENDING",
        `Relance du paiement pour ${durationMinutes} minute(s).`,
        {
          mode: "ADMIN_RELAUNCH_PAYMENT_AFTER_AUTO_CANCEL",
          durationMinutes,
          paymentExpiresAt: paymentExpiresAt.toISOString(),
          previousStatus: order.status,
          note: note || null,
        },
        actorAdminId,
      );
    });

    try {
      const result = await invoiceAndSendPreorder({
        req,
        preorderId: order.id,
        actorName,
        actorAdminId,
        invoiceRefInput: order.factureReference,
        whatsappToInput: order.factureWhatsappTo || "",
        notificationEmailInput: order.fboEmail,
        invoiceNote: note || "Relance du délai de paiement.",
        billingGradeInput: order.billingGrade || order.fboGrade,
        invoiceAmountOverrideInput:
          order.as400InvoiceTotalFcfa || order.totalFcfa || "",
        paymentExpiresAtInput: paymentExpiresAt,
      });

      publishRealtimeEvent({
        countryId: result?.preorder?.countryId || req.countryId,
        eventKey: "cashier_collect_new",
        orderId: result?.preorder?.id || id,
        meta: {
          status: result?.preorder?.status || "INVOICED",
          paymentStatus: result?.preorder?.paymentStatus || null,
          relaunched: true,
          paymentExpiresAt: paymentExpiresAt.toISOString(),
        },
      });

      return res.json({
        ...result.preorder,
        paymentExpiresAt,
      });
    } catch (error) {
      await prisma.preorder.update({
        where: { id: order.id },
        data: {
          status: previousSnapshot.status,
          cancelledAt: previousSnapshot.cancelledAt,
          cancelReason: previousSnapshot.cancelReason,
          cancelledById: previousSnapshot.cancelledById,
          billingWorkStatus: previousSnapshot.billingWorkStatus,
          billingCompletedAt: previousSnapshot.billingCompletedAt,
          activePaymentId: previousSnapshot.activePaymentId,
          paidAt: previousSnapshot.paidAt,
          paymentExpiresAt: order.paymentExpiresAt || null,
        },
      });
      throw error;
    }
  } catch (e) {
    console.error("relaunchPayment error:", e);

    if (e.message === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (e.message === "PREORDER_NOT_INVOICEABLE") {
      return res.status(400).json({
        message: "Cette commande ne peut pas être relancée actuellement.",
      });
    }

    if (e.message === "PREORDER_EMPTY_ITEMS") {
      return res.status(400).json({
        message:
          "Commande incohérente : elle ne contient aucun article et ne peut pas être relancée.",
      });
    }

    if (e.message === "INVALID_NOTIFICATION_EMAIL") {
      return res.status(400).json({
        message: "Adresse email de notification invalide.",
      });
    }

    return res.status(500).json({
      message: e.message || "Erreur serveur (relaunchPayment)",
    });
  }
}

async function replaceBillingOrderItem(req, res) {
  try {
    const { id, itemId } = req.params;
    const { replacementProductId, note } = req.body || {};

    const nextProductId = String(replacementProductId || "").trim();
    if (!nextProductId) {
      return res
        .status(400)
        .json({ message: "replacementProductId est obligatoire." });
    }

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: {
          include: { product: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const editableStatuses = new Set([
      "SUBMITTED",
      "INVOICED",
      "PAYMENT_PENDING",
      "PAYMENT_PROOF_RECEIVED",
    ]);
    if (!editableStatuses.has(String(order.status || "").toUpperCase())) {
      return res.status(400).json({
        message:
          "Remplacement autorisé uniquement avant paiement confirmé.",
      });
    }

    const targetItem = (order.items || []).find((it) => it.id === itemId);
    if (!targetItem) {
      return res.status(404).json({ message: "Ligne de commande introuvable" });
    }

    const replacement = await prisma.product.findFirst({
      where: scopeWhere(req, {
        id: nextProductId,
        actif: true,
      }),
      select: {
        id: true,
        sku: true,
        nom: true,
      },
    });

    if (!replacement) {
      return res
        .status(404)
        .json({ message: "Produit de remplacement introuvable" });
    }

    if (replacement.id === targetItem.productId) {
      return res.status(400).json({
        message: "Le produit de remplacement doit être différent du produit actuel.",
      });
    }

    await prisma.preorderItem.update({
      where: { id: targetItem.id },
      data: {
        productId: replacement.id,
      },
    });

    const summary = await computePreorderTotals(order.id, order.countryId);

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const refreshedItems = await tx.preorderItem.findMany({
        where: { preorderId: order.id },
        include: { product: true },
        orderBy: { createdAt: "asc" },
      });

      for (const dbItem of refreshedItems) {
        const computed = computeLineFromProduct(
          dbItem.product,
          dbItem.qty,
          summary.discountPercent || 0,
        );
        if (!computed) continue;

        await tx.preorderItem.update({
          where: { id: dbItem.id },
          data: {
            productSkuSnapshot: dbItem.product?.sku || null,
            productNameSnapshot: dbItem.product?.nom || null,
            prixCatalogueFcfa: computed.prixCatalogueFcfa || 0,
            discountPercent: String(computed.discountPercent || "0.00"),
            prixUnitaireFcfa: computed.prixUnitaireFcfa || 0,
            ccUnitaire: String(Number(computed.ccUnitaire || 0).toFixed(3)),
            poidsUnitaireKg: String(
              Number(computed.poidsUnitaireKg || 0).toFixed(3),
            ),
            lineTotalFcfa: computed.lineTotalFcfa || 0,
            lineTotalCc: String(Number(computed.lineTotalCc || 0).toFixed(3)),
            lineTotalPoids: String(
              Number(computed.lineTotalPoids || 0).toFixed(3),
            ),
          },
        });
      }

      const mustResetInvoiceFlow =
        String(order.status || "").toUpperCase() !== "SUBMITTED";

      await tx.preorder.update({
        where: { id: order.id },
        data: {
          totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
          totalPoidsKg: String(Number(summary.totals.totalPoidsKg || 0).toFixed(3)),
          totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
          fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
          totalFcfa: summary.totals.totalFcfa || 0,
          as400InvoiceTotalFcfa: summary.totals.totalFcfa || 0,
          computedGradeTotalFcfa: summary.totals.totalFcfa || 0,
          ...(mustResetInvoiceFlow
            ? {
                status: "SUBMITTED",
                paymentStatus: "UNPAID",
                activePaymentId: null,
                paymentProvider: null,
                paidAt: null,
                factureReference: null,
                invoicedAt: null,
                manualPaymentReference: null,
                manualPaymentProofUrl: null,
                manualPaymentProofNote: null,
                manualPaymentReceivedAt: null,
                manualPaymentValidatedAt: null,
                manualPaymentValidatedById: null,
                billingAdjustmentReason: null,
                whatsappMessage: null,
                lastWhatsappMessageId: null,
                lastWhatsappStatus: null,
                lastWhatsappStatusAt: null,
                paymentLinkClickedAt: null,
                paymentLinkClickCount: 0,
                billingWorkStatus: "IN_PROGRESS",
                billingLastActivityAt: new Date(),
              }
            : {}),
        },
      });

      await addLogTx(
        tx,
        order.id,
        "REPRICE",
        note
          ? String(note).trim()
          : "Remplacement produit demandé par facturation",
        {
          preorderItemId: targetItem.id,
          previousProductId: targetItem.productId,
          previousProductSku: targetItem.productSkuSnapshot || targetItem.product?.sku || null,
          previousProductName:
            targetItem.productNameSnapshot || targetItem.product?.nom || null,
          replacementProductId: replacement.id,
          replacementProductSku: replacement.sku || null,
          replacementProductName: replacement.nom || null,
          qty: targetItem.qty || 0,
          totalFcfaAfter: summary.totals.totalFcfa || 0,
          requiresReinvoice: mustResetInvoiceFlow,
        },
        req.user?.id || null,
      );

      return tx.preorder.findFirst({
        where: { id: order.id },
        include: {
          items: {
            include: { product: true },
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });

    return res.json({
      ok: true,
      message: "Produit remplacé avec succès.",
      order: updatedOrder,
    });
  } catch (e) {
    console.error("replaceBillingOrderItem error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (replaceBillingOrderItem)" });
  }
}

async function updateNotificationContacts(req, res) {
  try {
    const { id } = req.params;
    const hasPhone = Object.prototype.hasOwnProperty.call(req.body || {}, "phone");
    const hasEmail = Object.prototype.hasOwnProperty.call(req.body || {}, "email");

    if (!hasPhone && !hasEmail) {
      return res.status(400).json({
        message: "Renseignez au moins un numéro ou un email de notification.",
      });
    }

    const phone = normalizeOptionalNotificationPhone(req.body?.phone);
    const email = normalizeOptionalNotificationEmail(req.body?.email);

    if (phone === "__INVALID_PHONE__") {
      return res.status(400).json({
        message: "Numéro de notification invalide.",
      });
    }

    if (email === "__INVALID_EMAIL__") {
      return res.status(400).json({
        message: "Adresse email de notification invalide.",
      });
    }

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: {
        id: true,
        status: true,
        factureWhatsappTo: true,
        fboEmail: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["FULFILLED", "CANCELLED"].includes(String(order.status || "").toUpperCase())) {
      return res.status(400).json({
        message: "Impossible de modifier les coordonnées sur une commande clôturée.",
      });
    }

    const data = {};
    if (hasPhone) data.factureWhatsappTo = phone;
    if (hasEmail) data.fboEmail = email;

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          ...data,
          billingLastActivityAt: new Date(),
        },
      });

      await addLogTx(
        tx,
        order.id,
        "WAIT_CUSTOMER_DATA",
        "Coordonnées de notification client mises à jour",
        {
          previousPhone: order.factureWhatsappTo || null,
          nextPhone: hasPhone ? phone : order.factureWhatsappTo || null,
          previousEmail: order.fboEmail || null,
          nextEmail: hasEmail ? email : order.fboEmail || null,
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json({
      ok: true,
      order: updated,
      factureWhatsappTo: updated.factureWhatsappTo || null,
      fboEmail: updated.fboEmail || null,
    });
  } catch (e) {
    console.error("updateNotificationContacts error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (updateNotificationContacts)" });
  }
}

async function resendInvoiceSms(req, res) {
  try {
    const { id } = req.params;
    const requestedChannel = String(req.body?.channel || "").trim().toUpperCase();
    const phoneOverride = normalizeOptionalNotificationPhone(req.body?.phone);
    const emailOverride = normalizeOptionalNotificationEmail(req.body?.email);

    if (phoneOverride === "__INVALID_PHONE__") {
      return res.status(400).json({
        message: "Numéro de notification invalide.",
      });
    }

    if (emailOverride === "__INVALID_EMAIL__") {
      return res.status(400).json({
        message: "Adresse email de notification invalide.",
      });
    }

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: {
        id: true,
        countryId: true,
        preorderNumber: true,
        status: true,
        fboNomComplet: true,
        fboNumero: true,
        fboEmail: true,
        factureReference: true,
        paymentCollectionCode: true,
        totalFcfa: true,
        preorderPaymentMode: true,
        paymentProvider: true,
        factureWhatsappTo: true,
        whatsappMessage: true,
        activePayment: {
          select: {
            amountExpectedFcfa: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const latestMessage = await prisma.orderMessage.findFirst({
      where: {
        preorderId: order.id,
        purpose: { in: ["INVOICE", "PAYMENT_LINK", "REMINDER"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        body: true,
        purpose: true,
        toPhone: true,
        paymentLinkTarget: true,
        paymentLinkTracked: true,
      },
    });

    const amountToPayFcfa = resolveOrderAmountToPayFcfa(order);
    const paymentLink = String(
      latestMessage?.paymentLinkTracked ||
        latestMessage?.paymentLinkTarget ||
        "",
    ).trim();
    const smsBody = buildInvoiceMessage({
      preorder: order,
      invoiceRef: order.factureReference || order.preorderNumber || "-",
      paymentLink: paymentLink || null,
      amountToPayFcfa,
    });
    const destination =
      (phoneOverride !== undefined ? String(phoneOverride || "").trim() : "") ||
      String(order.factureWhatsappTo || "").trim() ||
      String(latestMessage?.toPhone || "").trim();
    const emailDestination =
      (emailOverride !== undefined ? emailOverride : null) ||
      normalizeEmail(order.fboEmail || "") ||
      null;

    if (!smsBody) {
      return res.status(400).json({
        message:
          "Aucun message de facture disponible. Générez une facture avant renvoi.",
      });
    }

    if (!destination && requestedChannel !== "EMAIL") {
      return res.status(400).json({
        message:
          "Aucun numéro destinataire disponible pour renvoyer le SMS.",
      });
    }

    if (requestedChannel === "EMAIL" && !emailDestination) {
      return res.status(400).json({
        message: "Aucune adresse email client disponible pour renvoyer le lien.",
      });
    }

    const actorName = actorLabel(req);
    const now = new Date();
    const paymentMode = String(
      order?.preorderPaymentMode || order?.paymentProvider || "",
    )
      .trim()
      .toUpperCase();
    const notificationPurpose =
      paymentLink && paymentMode.includes("WAVE") ? "PAYMENT_LINK" : "INVOICE";
    const sendResult = await sendPreorderNotification({
      preorder: {
        ...order,
        factureWhatsappTo: destination,
        fboEmail: emailDestination,
      },
      purpose:
        latestMessage?.purpose === "PAYMENT_LINK" ||
        latestMessage?.purpose === "INVOICE"
          ? latestMessage.purpose
          : notificationPurpose,
      message: smsBody,
      actorName,
      paymentLinkTarget: latestMessage?.paymentLinkTarget || paymentLink || null,
      paymentLinkTracked: latestMessage?.paymentLinkTracked || paymentLink || null,
      forceChannel: ["SMS", "WHATSAPP", "EMAIL"].includes(requestedChannel)
        ? requestedChannel
        : null,
      toEmail: emailDestination,
    });
    const smsDispatched = Boolean(sendResult?.smsSent);
    const smsQueued = Boolean(sendResult?.smsQueued);

    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: order.id },
        data: {
          factureWhatsappTo: destination,
          fboEmail: emailDestination,
          whatsappMessage: smsBody,
          lastWhatsappStatus: smsDispatched ? "SENT" : smsQueued ? "QUEUED" : "FAILED",
          lastWhatsappStatusAt: now,
          lastWhatsappMessageId: sendResult?.providerMessageId || null,
        },
      });

      await addLogTx(
        tx,
        order.id,
        "WAIT_CUSTOMER_DATA",
        requestedChannel === "EMAIL"
          ? "Notification de facture renvoyée par email"
          : requestedChannel === "SMS"
            ? "Notification de facture renvoyée par SMS"
            : "Notification de facture renvoyée au client",
        {
          toPhone: destination,
          toEmail: sendResult?.toEmail || emailDestination || null,
          sent: Boolean(sendResult?.sent),
          channel: sendResult?.channel || null,
          attempts: sendResult?.attempts || [],
          messageId: sendResult?.messageId || null,
          providerMessageId: sendResult?.providerMessageId || null,
          errorCode: sendResult?.errorCode || null,
          errorMessage: sendResult?.errorMessage || null,
        },
        req.user?.id || null,
      );
    });

    return res.json({
      ok: true,
      sent: Boolean(sendResult?.sent),
      queued: Boolean(sendResult?.smsQueued),
      toPhone: destination,
      toEmail: sendResult?.toEmail || emailDestination || null,
      channel: sendResult?.channel || null,
      attempts: sendResult?.attempts || [],
      messageId: sendResult?.messageId || null,
      providerMessageId: sendResult?.providerMessageId || null,
      errorCode: sendResult?.errorCode || null,
      errorMessage: sendResult?.errorMessage || null,
    });
  } catch (e) {
    console.error("resendInvoiceSms error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (resendInvoiceSms)" });
  }
}

async function resendConfirmationSms(req, res) {
  try {
    const { id } = req.params;
    const globalAdmin = isGlobalAdminRole(req.user?.role);
    const phoneOverride = normalizeOptionalNotificationPhone(req.body?.phone);
    const emailOverride = normalizeOptionalNotificationEmail(req.body?.email);

    if (phoneOverride === "__INVALID_PHONE__") {
      return res.status(400).json({
        message: "Numéro de notification invalide.",
      });
    }

    if (emailOverride === "__INVALID_EMAIL__") {
      return res.status(400).json({
        message: "Adresse email de notification invalide.",
      });
    }

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: {
        id: true,
        countryId: true,
        status: true,
        preorderNumber: true,
        parcelNumber: true,
        fboNomComplet: true,
        fboNumero: true,
        fboEmail: true,
        pickupSecretCode: true,
        factureReference: true,
        paymentCollectionCode: true,
        totalFcfa: true,
        preorderPaymentMode: true,
        paymentProvider: true,
        factureWhatsappTo: true,
        activePayment: {
          select: {
            amountExpectedFcfa: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const normalizedStatus = String(order.status || "").toUpperCase();
    if (!["READY", "FULFILLED"].includes(normalizedStatus) && !globalAdmin) {
      return res.status(400).json({
        message:
          "Le renvoi du SMS de confirmation est disponible uniquement pour les commandes READY ou FULFILLED.",
      });
    }

    const amountToPayFcfa = resolveOrderAmountToPayFcfa(order);
    const actorName = actorLabel(req);
    const destination =
      (phoneOverride !== undefined ? String(phoneOverride || "").trim() : "") ||
      String(order.factureWhatsappTo || "").trim();
    const emailDestination =
      (emailOverride !== undefined ? emailOverride : null) ||
      normalizeEmail(order.fboEmail || "") ||
      null;
    const payloadOrder = {
      ...order,
      factureWhatsappTo: destination,
      fboEmail: emailDestination,
    };

    let purpose = normalizedStatus === "READY" ? "ORDER_READY" : "REMINDER";
    let smsMessage;

    if (normalizedStatus === "READY") {
      smsMessage = buildOrderReadySmsMessage({
        preorder: payloadOrder,
        pickupSecretCode: order.pickupSecretCode || "-",
      });
    } else if (normalizedStatus === "FULFILLED") {
      smsMessage = buildOrderFulfilledSmsMessage({
        preorder: payloadOrder,
      });
    } else {
      const latestMessage = await prisma.orderMessage.findFirst({
        where: { preorderId: order.id },
        orderBy: { createdAt: "desc" },
        select: {
          body: true,
          purpose: true,
          paymentLinkTracked: true,
          paymentLinkTarget: true,
        },
      });

      purpose = latestMessage?.purpose || "REMINDER";
      smsMessage =
        buildInvoiceMessage({
          preorder: payloadOrder,
          invoiceRef: order.factureReference || order.preorderNumber || "-",
          paymentLink:
            latestMessage?.paymentLinkTracked ||
            latestMessage?.paymentLinkTarget ||
            null,
          amountToPayFcfa,
        }) ||
        String(latestMessage?.body || "").trim();
    }

    if (!String(smsMessage || "").trim()) {
      return res.status(400).json({
        message: "Aucun message SMS disponible pour cette commande.",
      });
    }

    const sendResult = await sendPreorderNotification({
      preorder: payloadOrder,
      purpose,
      message: smsMessage,
      actorName,
      toPhone: destination,
      toEmail: emailDestination,
    });

    if (sendResult?.skipped) {
      return res.status(400).json({
        message:
          "Aucun numéro client disponible pour envoyer le SMS de confirmation.",
      });
    }

    const now = new Date();
    const smsDispatched = Boolean(sendResult?.smsSent);
    const smsQueued = Boolean(sendResult?.smsQueued);
    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: order.id },
        data: {
          factureWhatsappTo: destination,
          fboEmail: emailDestination,
          lastWhatsappStatus: smsDispatched ? "SENT" : smsQueued ? "QUEUED" : "FAILED",
          lastWhatsappStatusAt: now,
          lastWhatsappMessageId: sendResult?.providerMessageId || null,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: order.id,
          action: "WAIT_CUSTOMER_DATA",
          note: "Renvoi notification de confirmation",
          meta: {
            purpose,
            sent: Boolean(sendResult?.sent),
            channel: sendResult?.channel || null,
            attempts: sendResult?.attempts || [],
            toPhone: sendResult?.toPhone || destination || null,
            toEmail: sendResult?.toEmail || emailDestination || null,
            messageId: sendResult?.messageId || null,
            providerMessageId: sendResult?.providerMessageId || null,
            errorCode: sendResult?.errorCode || null,
            errorMessage: sendResult?.errorMessage || null,
          },
          actorAdminId: req.user?.id || null,
        },
      });
    });

    return res.json({
      ok: true,
      purpose,
      sent: Boolean(sendResult?.sent),
      channel: sendResult?.channel || null,
      attempts: sendResult?.attempts || [],
      toPhone: sendResult?.toPhone || destination || null,
      toEmail: sendResult?.toEmail || emailDestination || null,
      messageId: sendResult?.messageId || null,
      providerMessageId: sendResult?.providerMessageId || null,
      errorCode: sendResult?.errorCode || null,
      errorMessage: sendResult?.errorMessage || null,
    });
  } catch (e) {
    console.error("resendConfirmationSms error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (resendConfirmationSms)" });
  }
}

async function switchWaveToManualPayment(req, res) {
  try {
    const { id } = req.params;

    if (!isGlobalAdminRole(req.user?.role)) {
      return res.status(403).json({
        message: "Seuls les administrateurs globaux peuvent changer ce mode de paiement.",
      });
    }

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        preorderPaymentMode: true,
        paymentProvider: true,
        activePaymentId: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const paymentMode = String(order.preorderPaymentMode || "").toUpperCase();
    const provider = String(order.paymentProvider || "").toUpperCase();
    const isWave = paymentMode === "WAVE" || provider === "WAVE";
    const isBankTransfer =
      paymentMode === "BANK_TRANSFER" || provider === "BANK_TRANSFER";
    const isEcobankPay =
      paymentMode === "ECOBANK_PAY" || provider === "ECOBANK_PAY";
    if (!isWave && !isBankTransfer && !isEcobankPay) {
      return res.status(400).json({
        message: "Seules les commandes Wave, virement bancaire ou Ecobank Pay peuvent être basculées en paiement à la caisse.",
      });
    }

    if (["PAID", "READY", "FULFILLED", "CANCELLED"].includes(String(order.status || "").toUpperCase())) {
      return res.status(400).json({
        message: "Impossible de changer le mode de paiement sur une commande déjà soldée ou clôturée.",
      });
    }

    const sourceLabel = isEcobankPay ? "Ecobank Pay" : isBankTransfer ? "virement bancaire" : "Wave";

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (order.activePaymentId) {
        const active = await tx.payment.findUnique({
          where: { id: order.activePaymentId },
          select: { id: true, status: true, cancelledAt: true },
        });
        const currentStatus = String(active?.status || "").toUpperCase();
        if (
          active &&
          !["SUCCEEDED", "PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"].includes(
            currentStatus,
          )
        ) {
          await tx.payment.update({
            where: { id: active.id },
            data: {
              status: "CANCELLED",
              cancelledAt: active.cancelledAt || now,
            },
          });
        }
      }

      const nextStatus =
        String(order.status || "").toUpperCase() === "PAYMENT_PENDING"
          ? "INVOICED"
          : order.status;

      await tx.preorder.update({
        where: { id: order.id },
        data: {
          preorderPaymentMode: "ESPECES",
          paymentProvider: "MANUAL",
          paymentStatus:
            String(order.paymentStatus || "").toUpperCase() === "PAID"
              ? order.paymentStatus
              : "UNPAID",
          status: nextStatus,
          activePaymentId: null,
          paidAt: null,
        },
      });

      await addLogTx(
        tx,
        order.id,
        "WAIT_CUSTOMER_DATA",
        `Bascule du mode de paiement ${sourceLabel} vers paiement à la caisse`,
        {
          fromPreorderPaymentMode: order.preorderPaymentMode || null,
          toPreorderPaymentMode: "ESPECES",
          fromPaymentProvider: order.paymentProvider || null,
          toPaymentProvider: "MANUAL",
          fromStatus: order.status || null,
          toStatus: nextStatus || null,
        },
        req.user?.id || null,
      );
    });

    const updated = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: {
          include: { product: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return res.json({
      ok: true,
      message: "Mode de paiement basculé en paiement à la caisse.",
      order: updated,
    });
  } catch (e) {
    console.error("switchWaveToManualPayment error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (switchWaveToManualPayment)" });
  }
}

async function prepareOrder(req, res) {
  try {
    const { id } = req.params;
    const { packingNote } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                nom: true,
                sku: true,
                countryId: true,
                actif: true,
                stockQty: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    if (!order.preparationLaunchedAt) {
      return res.status(400).json({
        message:
          "La caisse doit d'abord lancer la préparation avant que le stock ne puisse traiter cette commande.",
      });
    }

    assertTransition(order.status, "READY");

    if (!order.items || order.items.length === 0) {
      return res
        .status(400)
        .json({ message: "Impossible de préparer une commande vide." });
    }

    if (order.stockDeductedAt) {
      const now = new Date();
      const parcelNumber = order.parcelNumber || generateParcelNumber(order);
      const pickupSecretCode =
        order.pickupSecretCode ||
        String(Math.floor(100000 + Math.random() * 900000));
      const actorName = actorLabel(req);

      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.preorder.update({
          where: { id: order.id },
          data: {
            status: "READY",
            parcelNumber,
            preparedAt: order.preparedAt || now,
            pickupSecretCode,
            packingNote: packingNote
              ? String(packingNote).trim()
              : order.packingNote,
            preparedById: order.preparedById || req.user?.id || null,
          },
        });

        await addLogTx(
          tx,
          id,
          "PREPARE",
          packingNote || "Colis prêt",
          {
            fromStatus: order.status,
            toStatus: "READY",
            stockDeducted: false,
            stockAlreadyDeducted: true,
            parcelNumber,
            pickupSecretCode,
          },
          req.user?.id || null,
        );

        return saved;
      });

      try {
        await sendPreorderNotification({
          preorder: {
            ...order,
            ...updated,
            parcelNumber,
            pickupSecretCode,
          },
          purpose: "ORDER_READY",
          message: buildOrderReadySmsMessage({
            preorder: {
              ...order,
              ...updated,
              parcelNumber,
            },
            pickupSecretCode,
          }),
          actorName,
        });
      } catch (smsError) {
        console.error("prepareOrder already-deducted sms error:", smsError);
      }

      return res.json(updated);
    }

    const unresolvedBlockingAnomalies = await prisma.preparationAnomaly.count({
      where: {
        preorderId: order.id,
        blocking: true,
        resolvedAt: null,
      },
    });

    if (unresolvedBlockingAnomalies > 0) {
      return res.status(400).json({
        message:
          "Impossible de marquer le colis prêt tant qu'une anomalie bloquante de préparation n'est pas résolue.",
      });
    }

    await prisma.$transaction(async (tx) => {
      await ensurePreparationChecklist(tx, order);
    });

    const checklistItems = await prisma.preparationChecklistItem.findMany({
      where: { preorderId: order.id },
    });

    const allChecked =
      checklistItems.length > 0 && checklistItems.every((item) => item.checked);

    if (!allChecked) {
      return res.status(400).json({
        message:
          "Toutes les lignes de checklist doivent être cochées avant de marquer le colis prêt.",
      });
    }

    const now = new Date();
    const parcelNumber = order.parcelNumber || generateParcelNumber(order);
    const pickupSecretCode =
      order.pickupSecretCode ||
      String(Math.floor(100000 + Math.random() * 900000));
    const actorName = actorLabel(req);

    const updated = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const updatedStock = await tx.countryProduct.updateMany({
          where: {
            countryId: order.countryId,
            productId: item.productId,
            actif: true,
            stockQty: { gte: item.qty },
          },
          data: {
            stockQty: { decrement: item.qty },
          },
        });

        if (updatedStock.count !== 1) {
          const err = new Error(
            `Stock insuffisant pour ${
              item.productNameSnapshot || item.product?.nom || item.productId
            }`,
          );
          err.statusCode = 409;
          throw err;
        }

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            countryId: order.countryId,
            preorderId: order.id,
            type: "DEBIT",
            reason: "PREPARE_ORDER",
            qty: item.qty,
            note: "Sortie de stock lors de la préparation commande",
            meta: {
              preorderId: order.id,
              productId: item.productId,
              qty: item.qty,
            },
            createdById: req.user?.id || null,
          },
        });
      }

      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "READY",
          parcelNumber,
          preparedAt: order.preparedAt || now,
          pickupSecretCode,
          packingNote: packingNote
            ? String(packingNote).trim()
            : order.packingNote,
          preparedById: order.preparedById || req.user?.id || null,
          stockDeductedAt: order.stockDeductedAt || now,
        },
      });

      await addLogTx(
        tx,
        id,
        "PREPARE",
        packingNote || "Colis prêt",
        {
          fromStatus: order.status,
          toStatus: "READY",
          stockDeducted: true,
          parcelNumber,
          pickupSecretCode,
        },
        req.user?.id || null,
      );

      return saved;
    });

    try {
      await sendPreorderNotification({
        preorder: {
          ...order,
          parcelNumber,
          pickupSecretCode,
        },
        purpose: "ORDER_READY",
        message: buildOrderReadySmsMessage({
          preorder: {
            ...order,
            parcelNumber,
          },
          pickupSecretCode,
        }),
        actorName,
      });
    } catch (smsError) {
      console.error("prepareOrder sms error:", smsError);
    }

    return res.json(updated);
  } catch (e) {
    console.error("prepareOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (prepareOrder)" });
  }
}

async function updatePreparationChecklistItem(req, res) {
  try {
    const { id } = req.params;
    const { itemId, checked, note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const targetItem = order.items.find((item) => item.id === itemId);
    if (!targetItem) {
      return res.status(404).json({ message: "Ligne de commande introuvable" });
    }

    const checkedValue = Boolean(checked);
    const saved = await prisma.$transaction(async (tx) => {
      await ensurePreparationChecklist(tx, order);

      return tx.preparationChecklistItem.upsert({
        where: {
          preorderId_preorderItemId: {
            preorderId: order.id,
            preorderItemId: targetItem.id,
          },
        },
        update: {
          checked: checkedValue,
          checkedAt: checkedValue ? new Date() : null,
          checkedById: checkedValue ? req.user?.id || null : null,
          note: note ? String(note).trim() : null,
        },
        create: {
          preorderId: order.id,
          preorderItemId: targetItem.id,
          checked: checkedValue,
          checkedAt: checkedValue ? new Date() : null,
          checkedById: checkedValue ? req.user?.id || null : null,
          note: note ? String(note).trim() : null,
        },
        include: {
          preorderItem: {
            include: { product: true },
          },
          checkedBy: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      });
    });

    return res.json(saved);
  } catch (e) {
    console.error("updatePreparationChecklistItem error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur (updatePreparationChecklistItem)",
    });
  }
}

async function bulkUpdatePreparationChecklist(req, res) {
  try {
    const { id } = req.params;
    const { checked } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const checkedValue = Boolean(checked);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await ensurePreparationChecklist(tx, order);

      for (const item of order.items) {
        await tx.preparationChecklistItem.update({
          where: {
            preorderId_preorderItemId: {
              preorderId: order.id,
              preorderItemId: item.id,
            },
          },
          data: {
            checked: checkedValue,
            checkedAt: checkedValue ? now : null,
            checkedById: checkedValue ? req.user?.id || null : null,
          },
        });
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("bulkUpdatePreparationChecklist error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur (bulkUpdatePreparationChecklist)",
    });
  }
}

async function createPreparationAnomaly(req, res) {
  try {
    const { id } = req.params;
    const { itemId, kind, note, blocking = true } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const normalizedKind = String(kind || "").trim().toUpperCase();
    const normalizedNote = String(note || "").trim();
    if (!normalizedKind || !normalizedNote) {
      return res.status(400).json({
        message: "Le type d'anomalie et la note sont obligatoires.",
      });
    }

    if (itemId && !order.items.some((item) => item.id === itemId)) {
      return res.status(404).json({ message: "Ligne de commande introuvable" });
    }

    const saved = await prisma.preparationAnomaly.create({
      data: {
        preorderId: order.id,
        preorderItemId: itemId || null,
        kind: normalizedKind,
        note: normalizedNote,
        blocking: Boolean(blocking),
        createdById: req.user?.id || null,
      },
      include: {
        preorderItem: { include: { product: true } },
        createdBy: {
          select: { id: true, fullName: true, email: true, role: true },
        },
        resolvedBy: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
    });

    return res.status(201).json(saved);
  } catch (e) {
    console.error("createPreparationAnomaly error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur (createPreparationAnomaly)",
    });
  }
}

async function resolvePreparationAnomaly(req, res) {
  try {
    const { id, anomalyId } = req.params;
    const { resolutionNote } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      select: { id: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const anomaly = await prisma.preparationAnomaly.findFirst({
      where: {
        id: anomalyId,
        preorderId: order.id,
      },
    });

    if (!anomaly) {
      return res.status(404).json({ message: "Anomalie introuvable" });
    }

    const saved = await prisma.preparationAnomaly.update({
      where: { id: anomaly.id },
      data: {
        resolvedAt: anomaly.resolvedAt || new Date(),
        resolvedById: anomaly.resolvedById || req.user?.id || null,
        resolutionNote: resolutionNote
          ? String(resolutionNote).trim()
          : anomaly.resolutionNote,
      },
      include: {
        preorderItem: { include: { product: true } },
        createdBy: {
          select: { id: true, fullName: true, email: true, role: true },
        },
        resolvedBy: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
    });

    return res.json(saved);
  } catch (e) {
    console.error("resolvePreparationAnomaly error:", e);
    return res.status(500).json({
      message: e.message || "Erreur serveur (resolvePreparationAnomaly)",
    });
  }
}

async function fulfillOrder(req, res) {
  try {
    const { id } = req.params;
    const {
      deliveryTracking,
      note,
      pickupCode,
      pickupPointLabel,
      deliveryCarrier,
      fulfillmentMode,
      pickupRecipientType,
      pickupRecipientName,
      pickupRecipientPhone,
      pickupConfirmationNote,
    } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.status === "FULFILLED") {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "FULFILLED");
    const isPickupOrder = order.deliveryMode === "RETRAIT_SITE_FLP";
    const normalizedPickupCode = String(pickupCode || "").trim();
    const normalizedFulfillmentMode =
      String(fulfillmentMode || (isPickupOrder ? "PICKUP" : "DELIVERY"))
        .trim()
        .toUpperCase() || null;
    const normalizedPickupRecipientType = String(
      pickupRecipientType || (isPickupOrder ? "CUSTOMER" : "DELIVERY_AGENT"),
    )
      .trim()
      .toUpperCase();
    const normalizedPickupRecipientName = String(pickupRecipientName || "").trim();
    const normalizedPickupRecipientPhone = String(pickupRecipientPhone || "").trim();
    const normalizedPickupConfirmationNote = String(pickupConfirmationNote || "").trim();
    const actorName = actorLabel(req);

    if (isPickupOrder) {
      if (!normalizedPickupCode) {
        return res.status(400).json({
          message:
            "Le code secret présenté par le client est requis pour confirmer le retrait.",
        });
      }

      if (normalizedPickupCode !== String(order.pickupSecretCode || "").trim()) {
        return res.status(400).json({
          message: "Le code secret présenté ne correspond pas à ce colis.",
        });
      }

      if (!normalizedPickupRecipientName) {
        return res.status(400).json({
          message:
            "Le nom de la personne qui récupère le colis est obligatoire.",
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "FULFILLED",
          fulfilledAt: order.fulfilledAt || new Date(),
          deliveryTracking: deliveryTracking
            ? String(deliveryTracking).trim()
            : order.deliveryTracking,
          fulfillmentMode: normalizedFulfillmentMode,
          pickupPointLabel: pickupPointLabel
            ? String(pickupPointLabel).trim()
            : order.pickupPointLabel,
          deliveryCarrier: deliveryCarrier
            ? String(deliveryCarrier).trim()
            : order.deliveryCarrier,
          internalNote: note ? String(note).trim() : order.internalNote,
          pickupCodeVerifiedAt: isPickupOrder
            ? order.pickupCodeVerifiedAt || new Date()
            : order.pickupCodeVerifiedAt,
          pickupCodeVerifiedById: isPickupOrder
            ? order.pickupCodeVerifiedById || req.user?.id || null
            : order.pickupCodeVerifiedById,
          pickupRecipientType: isPickupOrder
            ? normalizedPickupRecipientType
            : order.pickupRecipientType,
          pickupRecipientName: isPickupOrder
            ? normalizedPickupRecipientName
            : order.pickupRecipientName,
          pickupRecipientPhone: isPickupOrder
            ? normalizedPickupRecipientPhone || null
            : order.pickupRecipientPhone,
          pickupConfirmationNote: isPickupOrder
            ? normalizedPickupConfirmationNote || null
            : order.pickupConfirmationNote,
          fulfilledById: order.fulfilledById || req.user?.id || null,
        },
      });

      await addLogTx(
        tx,
        id,
        "FULFILL",
        note || "Commande clôturée",
        {
          fromStatus: order.status,
          toStatus: "FULFILLED",
          deliveryTracking: saved.deliveryTracking,
          parcelNumber: order.parcelNumber,
          pickupCodeVerified: isPickupOrder,
          pickupRecipientType: isPickupOrder ? normalizedPickupRecipientType : null,
          pickupRecipientName: isPickupOrder ? normalizedPickupRecipientName : null,
          pickupRecipientPhone: isPickupOrder ? normalizedPickupRecipientPhone || null : null,
          pickupConfirmationNote: isPickupOrder
            ? normalizedPickupConfirmationNote || null
            : null,
          fulfillmentMode: normalizedFulfillmentMode,
          pickupPointLabel: pickupPointLabel
            ? String(pickupPointLabel).trim()
            : order.pickupPointLabel,
          deliveryCarrier: deliveryCarrier
            ? String(deliveryCarrier).trim()
            : order.deliveryCarrier,
        },
        req.user?.id || null,
      );

      return saved;
    });

    try {
      await sendPreorderNotification({
        preorder: {
          ...order,
          ...updated,
        },
        purpose: "ORDER_FULFILLED",
        message: buildOrderFulfilledSmsMessage({
          preorder: {
            ...order,
            ...updated,
          },
        }),
        actorName,
      });
    } catch (smsError) {
      console.error("fulfillOrder sms error:", smsError);
    }

    return res.json(updated);
  } catch (e) {
    console.error("fulfillOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (fulfillOrder)" });
  }
}

async function regularizeFulfillmentNoNotification(req, res) {
  try {
    const { id } = req.params;
    const {
      note,
      fulfillmentMode,
      pickupPointLabel,
      deliveryCarrier,
      deliveryTracking,
      pickupRecipientType,
      pickupRecipientName,
      pickupRecipientPhone,
      pickupConfirmationNote,
    } = req.body || {};

    if (!canRegularizeFulfillment(req.user?.role)) {
      return res.status(403).json({
        message:
          "Seuls les administrateurs autorisés peuvent clôturer une commande sans notification.",
      });
    }

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: {
          include: {
            product: {
              select: { id: true, nom: true, sku: true },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const status = String(order.status || "").toUpperCase();
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();

    if (status === "FULFILLED") {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    if (!["PAID", "READY"].includes(status) || paymentStatus !== "PAID") {
      return res.status(400).json({
        message:
          "La clôture sans notification est réservée aux commandes payées, en préparation ou prêtes.",
      });
    }

    if (!order.items || order.items.length === 0) {
      return res.status(400).json({
        message: "Impossible de clôturer une commande vide.",
      });
    }

    const now = new Date();
    const normalizedFulfillmentMode =
      String(
        fulfillmentMode ||
          order.fulfillmentMode ||
          (order.deliveryMode === "RETRAIT_SITE_FLP" ? "PICKUP" : "DELIVERY"),
      )
        .trim()
        .toUpperCase() || null;
    const isPickupOrder = order.deliveryMode === "RETRAIT_SITE_FLP";
    const normalizedPickupRecipientType = String(
      pickupRecipientType ||
        order.pickupRecipientType ||
        (isPickupOrder ? "CUSTOMER" : ""),
    )
      .trim()
      .toUpperCase();
    const normalizedPickupRecipientName = String(
      pickupRecipientName || order.pickupRecipientName || "",
    ).trim();
    const normalizedPickupRecipientPhone = String(
      pickupRecipientPhone || order.pickupRecipientPhone || "",
    ).trim();
    const normalizedPickupConfirmationNote = String(
      pickupConfirmationNote || order.pickupConfirmationNote || "",
    ).trim();
    const regularizationNote =
      String(note || "").trim() ||
      "Régularisation admin : commande déjà livrée physiquement, clôturée sans notification.";
    const parcelNumber = order.parcelNumber || generateParcelNumber(order);
    const pickupSecretCode =
      order.pickupSecretCode ||
      String(Math.floor(100000 + Math.random() * 900000));
    const mustDebitStock = !order.stockDeductedAt;

    const updated = await prisma.$transaction(async (tx) => {
      await ensurePreparationChecklist(tx, order);

      if (mustDebitStock) {
        for (const item of order.items) {
          const updatedStock = await tx.countryProduct.updateMany({
            where: {
              countryId: order.countryId,
              productId: item.productId,
              actif: true,
              stockQty: { gte: item.qty },
            },
            data: {
              stockQty: { decrement: item.qty },
            },
          });

          if (updatedStock.count !== 1) {
            const err = new Error(
              `Stock insuffisant pour ${
                item.productNameSnapshot || item.product?.nom || item.productId
              }`,
            );
            err.statusCode = 409;
            throw err;
          }

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              countryId: order.countryId,
              preorderId: order.id,
              type: "DEBIT",
              reason: "PREPARE_ORDER",
              qty: item.qty,
              note: "Sortie de stock lors d'une clôture admin sans notification",
              meta: {
                preorderId: order.id,
                productId: item.productId,
                qty: item.qty,
                fromStatus: status,
                regularization: true,
                notificationsSkipped: true,
              },
              createdById: req.user?.id || null,
            },
          });
        }
      }

      await tx.preparationChecklistItem.updateMany({
        where: { preorderId: order.id, checked: false },
        data: {
          checked: true,
          checkedAt: now,
          checkedById: req.user?.id || null,
          note: "Cochée automatiquement lors de la régularisation admin.",
        },
      });

      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "FULFILLED",
          parcelNumber,
          preparedAt: order.preparedAt || now,
          preparedById: order.preparedById || req.user?.id || null,
          stockDeductedAt: order.stockDeductedAt || now,
          pickupSecretCode,
          fulfilledAt: order.fulfilledAt || now,
          fulfilledById: order.fulfilledById || req.user?.id || null,
          fulfillmentMode: normalizedFulfillmentMode,
          deliveryTracking: deliveryTracking
            ? String(deliveryTracking).trim()
            : order.deliveryTracking,
          pickupPointLabel: pickupPointLabel
            ? String(pickupPointLabel).trim()
            : order.pickupPointLabel,
          deliveryCarrier: deliveryCarrier
            ? String(deliveryCarrier).trim()
            : order.deliveryCarrier,
          pickupRecipientType:
            normalizedPickupRecipientType || order.pickupRecipientType,
          pickupRecipientName:
            normalizedPickupRecipientName || order.pickupRecipientName,
          pickupRecipientPhone:
            normalizedPickupRecipientPhone || order.pickupRecipientPhone,
          pickupConfirmationNote:
            normalizedPickupConfirmationNote || order.pickupConfirmationNote,
          internalNote: regularizationNote,
        },
      });

      await addLogTx(
        tx,
        order.id,
        "FULFILL",
        regularizationNote,
        {
          fromStatus: order.status,
          toStatus: "FULFILLED",
          stockDeducted: mustDebitStock,
          notificationsSkipped: true,
          regularization: true,
          reason: "PHYSICAL_DELIVERY_REGULARIZATION",
          parcelNumber,
          fulfillmentMode: normalizedFulfillmentMode,
          pickupRecipientType: normalizedPickupRecipientType || null,
          pickupRecipientName: normalizedPickupRecipientName || null,
          pickupRecipientPhone: normalizedPickupRecipientPhone || null,
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json({
      ok: true,
      notificationsSkipped: true,
      stockDeducted: mustDebitStock,
      order: updated,
      ...updated,
    });
  } catch (e) {
    console.error("regularizeFulfillmentNoNotification error:", e);
    return res
      .status(e.statusCode || 500)
      .json({
        message:
          e.message ||
          "Erreur serveur (regularizeFulfillmentNoNotification)",
      });
  }
}

async function cancelOrder(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        items: {
          include: {
            product: {
              select: { id: true, nom: true, sku: true },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (order.status === "CANCELLED") {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "CANCELLED");

    const cancelReason =
      reason && String(reason).trim() ? String(reason).trim() : "Annulée";

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const mustRollbackStock =
        !!order.stockDeductedAt && !order.stockRestoredAt;

      if (mustRollbackStock) {
        for (const item of order.items) {
          await tx.countryProduct.update({
            where: {
              countryId_productId: {
                countryId: order.countryId,
                productId: item.productId,
              },
            },
            data: {
              stockQty: { increment: item.qty },
            },
          });

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              countryId: order.countryId,
              preorderId: order.id,
              type: "CREDIT",
              reason: "CANCEL_ORDER",
              qty: item.qty,
              note: "Retour stock suite annulation commande",
              meta: {
                preorderId: order.id,
                productId: item.productId,
                qty: item.qty,
              },
              createdById: req.user?.id || null,
            },
          });
        }
      }

      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          cancelledAt: order.cancelledAt || now,
          cancelReason,
          cancelledById: order.cancelledById || req.user?.id || null,
          stockRestoredAt:
            mustRollbackStock && !order.stockRestoredAt
              ? now
              : order.stockRestoredAt,
        },
      });

      await addLogTx(
        tx,
        id,
        "CANCEL",
        cancelReason,
        {
          fromStatus: order.status,
          toStatus: "CANCELLED",
          stockRollback: mustRollbackStock,
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("cancelOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (cancelOrder)" });
  }
}

module.exports = {
  listOrders,
  getSubmittedOrdersExport,
  getOrderById,
  listOrderMessages,
  downloadBankProofFile,
  downloadLegacyManualProofFile,
  getDeliveryNotePdf,
  updateOrderStatus,
  getInvoicePreview,
  invoiceOrder,
  relaunchPayment,
  replaceBillingOrderItem,
  updateNotificationContacts,
  resendInvoiceSms,
  resendConfirmationSms,
  switchWaveToManualPayment,
  updatePreparationChecklistItem,
  bulkUpdatePreparationChecklist,
  createPreparationAnomaly,
  resolvePreparationAnomaly,
  prepareOrder,
  fulfillOrder,
  regularizeFulfillmentNoNotification,
  cancelOrder,
};
