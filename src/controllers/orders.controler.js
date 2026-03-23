// src/controllers/admin/orders.controller.js
// Contrôleur commandes admin
// - listing enrichi
// - détail commande
// - actions métier commande
// - paiement manuel
// - messages commande

const prisma = require("../../prisma");

const {
  scopeWhere,
  safeFindUniqueScoped,
} = require("../../helpers/countryScope");

const {
  invoiceAndSendPreorder,
} = require("../../services/invoiceAndSendPreorder.service");

/* ===================================================================
   HELPERS
   =================================================================== */

function parseIntSafe(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(v) {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return false;
  return ["true", "1", "yes", "oui"].includes(v.trim().toLowerCase());
}

function cleanString(v) {
  return typeof v === "string" ? v.trim() : "";
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

function getOrderByClause(sort, dir) {
  const direction = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "total":
      return { totalFcfa: direction };
    case "updatedAt":
      return { updatedAt: direction };
    case "billingQueueEnteredAt":
      return { billingQueueEnteredAt: direction };
    case "assignedAt":
      return { assignedAt: direction };
    case "billingSlaDeadlineAt":
      return { billingSlaDeadlineAt: direction };
    case "priority":
      return { billingPriority: direction };
    case "createdAt":
    default:
      return { createdAt: direction };
  }
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

async function addLogTx(
  tx,
  preorderId,
  action,
  note,
  meta,
  actorAdminId = null,
) {
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

function actorLabel(req) {
  return (
    req.user?.fullName ||
    req.user?.email ||
    req.user?.id ||
    req.user?.role ||
    "admin"
  );
}

/* ===================================================================
   LISTING
   =================================================================== */

/**
 * GET /api/admin/orders
 */
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
      billingWorkStatus,
      priority,
      assignedOnly,
      hasAssignee,
      invoicerId,
      includeDrafts,
    } = req.query;

    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const pageSize = Math.min(
      100,
      Math.max(10, parseIntSafe(req.query.pageSize || req.query.limit, 20)),
    );
    const skip = (page - 1) * pageSize;

    const where = scopeWhere(req);

    if (!status && !parseBoolean(includeDrafts)) {
      where.status = { not: "DRAFT" };
    }

    if (status) where.status = cleanString(status);
    if (paymentStatus) where.paymentStatus = cleanString(paymentStatus);
    if (billingWorkStatus)
      where.billingWorkStatus = cleanString(billingWorkStatus);
    if (priority) where.billingPriority = cleanString(priority);

    if (parseBoolean(assignedOnly) && req.user?.id) {
      where.assignedInvoicerId = req.user.id;
    }

    if (parseBoolean(hasAssignee)) {
      where.assignedInvoicerId = { not: null };
    }

    if (invoicerId && cleanString(invoicerId)) {
      where.assignedInvoicerId = cleanString(invoicerId);
    }

    if (q && cleanString(q)) {
      const qs = cleanString(q);
      where.OR = [
        { fboNumero: { contains: qs, mode: "insensitive" } },
        { fboNomComplet: { contains: qs, mode: "insensitive" } },
        { factureReference: { contains: qs, mode: "insensitive" } },
      ];
    }

    const from = dateFrom ? normalizeDateStart(String(dateFrom)) : null;
    const to = dateTo ? normalizeDateEnd(String(dateTo)) : null;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const orderBy = getOrderByClause(sort, dir);

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
          totalFcfa: true,
          fboGrade: true,
          fboNumero: true,
          fboNomComplet: true,
          pointDeVente: true,
          deliveryMode: true,
          factureReference: true,

          billingWorkStatus: true,
          billingPriority: true,
          billingQueueEnteredAt: true,
          assignedAt: true,
          billingSlaDeadlineAt: true,

          createdAt: true,
          updatedAt: true,

          assignedInvoicerId: true,
          assignedInvoicer: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          _count: {
            select: {
              items: true,
              messages: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      data: orders,
      meta: {
        filters: {
          status: status || "",
          q: q || "",
          dateFrom: dateFrom || "",
          dateTo: dateTo || "",
          paymentStatus: paymentStatus || "",
          billingWorkStatus: billingWorkStatus || "",
          priority: priority || "",
          assignedOnly: parseBoolean(assignedOnly),
          hasAssignee: parseBoolean(hasAssignee),
          invoicerId: invoicerId || "",
          includeDrafts: parseBoolean(includeDrafts),
          sort,
          dir,
        },
      },
    });
  } catch (e) {
    console.error("listOrders error:", e);
    return res.status(500).json({ message: "Erreur serveur (listOrders)" });
  }
}

/* ===================================================================
   DETAIL
   =================================================================== */

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
              attempts: { orderBy: { createdAt: "desc" } },
              refunds: { orderBy: { createdAt: "desc" } },
            },
          },
          payments: {
            include: {
              attempts: { orderBy: { createdAt: "desc" } },
              refunds: { orderBy: { createdAt: "desc" } },
            },
            orderBy: { createdAt: "desc" },
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
        },
      },
    );

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    return res.json(order);
  } catch (e) {
    console.error("getOrderById error:", e);
    return res.status(500).json({ message: "Erreur serveur (getOrderById)" });
  }
}

async function updateOrderStatus(req, res) {
  return res.status(400).json({
    message:
      "Endpoint générique désactivé. Utiliser les endpoints métier dédiés.",
  });
}

/* ===================================================================
   FACTURATION
   =================================================================== */

async function invoiceOrder(req, res) {
  try {
    const { id } = req.params;
    const { factureReference, whatsappTo, note } = req.body || {};

    const actorName = actorLabel(req);
    const actorAdminId = req.user?.id || null;

    const result = await invoiceAndSendPreorder({
      preorderId: id,
      actorName,
      actorAdminId,
      invoiceRefInput: factureReference,
      whatsappToInput: whatsappTo,
      invoiceNote: note,
    });

    return res.json(result.preorder);
  } catch (e) {
    console.error("invoiceOrder error:", e);

    console.log("[orders.controller][invoiceOrder] HIT", {
      orderId: req.params?.id,
      hasReq: Boolean(req),
      userId: req.user?.id || null,
    });

    if (e.message === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (e.message === "PREORDER_NOT_INVOICEABLE") {
      return res.status(400).json({
        message: "Cette commande ne peut pas être facturée actuellement.",
      });
    }

    if (e.message === "PREORDER_ID_REQUIRED") {
      return res.status(400).json({
        message: "Identifiant de commande manquant.",
      });
    }

    return res.status(500).json({
      message: e.message || "Erreur serveur (invoiceOrder)",
    });
  }
}

/* ===================================================================
   PREPARATION / FULFILLMENT / CANCEL
   =================================================================== */

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

    assertTransition(order.status, "READY");

    if (!order.items || order.items.length === 0) {
      return res
        .status(400)
        .json({ message: "Impossible de préparer une commande vide." });
    }

    if (order.stockDeductedAt) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        message: "Le stock a déjà été décrémenté pour cette commande.",
      });
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const updatedStock = await tx.product.updateMany({
          where: {
            id: item.productId,
            countryId: order.countryId,
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
          preparedAt: order.preparedAt || now,
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
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("prepareOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (prepareOrder)" });
  }
}

async function fulfillOrder(req, res) {
  try {
    const { id } = req.params;
    const { deliveryTracking, note } = req.body || {};

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

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "FULFILLED",
          fulfilledAt: order.fulfilledAt || new Date(),
          deliveryTracking: deliveryTracking
            ? String(deliveryTracking).trim()
            : order.deliveryTracking,
          internalNote: note ? String(note).trim() : order.internalNote,
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
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("fulfillOrder error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (fulfillOrder)" });
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
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQty: { increment: item.qty },
            },
          });

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
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

/* ===================================================================
   PAIEMENTS MANUELS
   =================================================================== */

async function markManualPaymentPending(req, res) {
  try {
    const { id } = req.params;
    const { manualPaymentProofUrl, manualPaymentReference, note } =
      req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (
      ["PAYMENT_PENDING", "PAID", "READY", "FULFILLED"].includes(order.status)
    ) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "PAYMENT_PENDING");

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAYMENT_PENDING",
          paymentStatus: "PAYMENT_PENDING",
          paymentProvider: "MANUAL",
          manualPaymentProofUrl: manualPaymentProofUrl
            ? String(manualPaymentProofUrl).trim()
            : order.manualPaymentProofUrl,
          manualPaymentReference: manualPaymentReference
            ? String(manualPaymentReference).trim()
            : order.manualPaymentReference,
          manualPaymentProofNote: note
            ? String(note).trim()
            : order.manualPaymentProofNote,
          manualPaymentReceivedAt: order.manualPaymentReceivedAt || now,
          billingWorkStatus: "WAITING_PAYMENT",
          billingLastActivityAt: now,
        },
      });

      await addLogTx(
        tx,
        id,
        "RECEIVE_MANUAL_PAYMENT_PROOF",
        note || "Preuve manuelle enregistrée",
        {
          fromStatus: order.status,
          toStatus: "PAYMENT_PENDING",
          manualPaymentReference: saved.manualPaymentReference,
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("markManualPaymentPending error:", e);
    return res.status(e.statusCode || 500).json({
      message: e.message || "Erreur serveur (markManualPaymentPending)",
    });
  }
}

async function validateManualPayment(req, res) {
  try {
    const { id } = req.params;
    const { note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "PAID");

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          paymentProvider: order.paymentProvider || "MANUAL",
          manualPaymentValidatedAt: order.manualPaymentValidatedAt || now,
          manualPaymentValidatedById:
            order.manualPaymentValidatedById || req.user?.id || null,
          paidAt: order.paidAt || now,
          billingWorkStatus: "DONE",
          billingCompletedAt: order.billingCompletedAt || now,
          billingLastActivityAt: now,
          internalNote: note ? String(note).trim() : order.internalNote,
        },
      });

      await addLogTx(
        tx,
        id,
        "VALIDATE_MANUAL_PAYMENT",
        note || "Paiement manuel validé",
        {
          fromStatus: order.status,
          toStatus: "PAID",
        },
        req.user?.id || null,
      );

      await addLogTx(
        tx,
        id,
        "PAYMENT_CONFIRMED",
        "Paiement confirmé",
        {
          paymentProvider: saved.paymentProvider,
          paymentStatus: saved.paymentStatus,
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("validateManualPayment error:", e);
    return res.status(e.statusCode || 500).json({
      message: e.message || "Erreur serveur (validateManualPayment)",
    });
  }
}

async function markCashPayment(req, res) {
  try {
    const { id } = req.params;
    const { note, reference } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    const allowedFrom = ["SUBMITTED", "INVOICED", "PAYMENT_PENDING"];
    if (!allowedFrom.includes(order.status)) {
      return res.status(400).json({
        message: `Transition invalide ${order.status} -> PAID (manuel/cash)`,
      });
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          paymentProvider: "MANUAL",
          manualPaymentReference: reference
            ? String(reference).trim()
            : order.manualPaymentReference,
          manualPaymentValidatedAt: order.manualPaymentValidatedAt || now,
          manualPaymentValidatedById:
            order.manualPaymentValidatedById || req.user?.id || null,
          paidAt: order.paidAt || now,
          billingWorkStatus: "DONE",
          billingCompletedAt: order.billingCompletedAt || now,
          billingLastActivityAt: now,
          internalNote: note ? String(note).trim() : order.internalNote,
        },
      });

      await addLogTx(
        tx,
        id,
        "VALIDATE_MANUAL_PAYMENT",
        note || "Paiement manuel encaissé",
        {
          fromStatus: order.status,
          toStatus: "PAID",
          paymentProvider: "MANUAL",
          manualPaymentReference: saved.manualPaymentReference,
        },
        req.user?.id || null,
      );

      await addLogTx(
        tx,
        id,
        "PAYMENT_CONFIRMED",
        "Paiement confirmé",
        {
          paymentProvider: "MANUAL",
          paymentStatus: "PAID",
        },
        req.user?.id || null,
      );

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("markCashPayment error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (markCashPayment)" });
  }
}

/* ===================================================================
   MESSAGES
   =================================================================== */

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

module.exports = {
  listOrders,
  getOrderById,
  updateOrderStatus,
  invoiceOrder,

  markManualPaymentPending,
  validateManualPayment,
  markCashPayment,

  // alias compat éventuels
  markPaymentProof: markManualPaymentPending,
  verifyPayment: validateManualPayment,
  payOrder: markCashPayment,

  prepareOrder,
  fulfillOrder,
  cancelOrder,
  listOrderMessages,
};
