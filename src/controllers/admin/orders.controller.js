const prisma = require("../../prisma");

const {
  invoiceAndSendPreorder,
} = require("../../services/invoiceAndSendPreorder.service");

const {
  scopeWhere,
  safeFindUniqueScoped,
} = require("../../helpers/countryScope");

function parseIntSafe(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
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

function actorLabel(req) {
  return (
    req.user?.fullName ||
    req.user?.email ||
    req.user?.id ||
    req.user?.role ||
    "admin"
  );
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
      billingWorkStatus,
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

    const where = scopeWhere(req);
    const includeDrafts = String(req.query.includeDrafts) === "true";

    if (!status && !includeDrafts) {
      where.status = { not: "DRAFT" };
    }

    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (billingWorkStatus) where.billingWorkStatus = billingWorkStatus;

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

    const sortMap = {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      total: "totalFcfa",
      totalFcfa: "totalFcfa",
      billingSlaDeadlineAt: "billingSlaDeadlineAt",
      billingQueueEnteredAt: "billingQueueEnteredAt",
      billingPriority: "billingPriority",
      assignedAt: "assignedAt",
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

async function updateOrderStatus(req, res) {
  return res.status(400).json({
    message:
      "Endpoint générique désactivé. Utiliser les endpoints métier dédiés.",
  });
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
    const { factureReference, whatsappTo, note } = req.body || {};

    const actorName = actorLabel(req);
    const actorAdminId = req.user?.id || null;

    const result = await invoiceAndSendPreorder({
      req,
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

module.exports = {
  listOrders,
  getOrderById,
  listOrderMessages,
  updateOrderStatus,
  invoiceOrder,
  prepareOrder,
  fulfillOrder,
  cancelOrder,
};
