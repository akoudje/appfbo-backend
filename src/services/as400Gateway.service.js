const prisma = require("../prisma");

const ACTIVE_STATUSES = ["PENDING", "RUNNING", "WAITING_HUMAN"];
const ALLOWED_MODES = new Set(["OBSERVATION", "ASSISTED", "AUTOMATIC"]);
const ALLOWED_ACTIONS = new Set(["CREATE_AND_VALIDATE_INVOICE", "CHECK_INVOICE_STATUS"]);

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function buildIdempotencyKey({ countryId, preorderId, action }) {
  return `${countryId}:${preorderId}:${action}`;
}

function buildRequestedPayload(order) {
  return {
    preorderId: order.id,
    preorderNumber: order.preorderNumber || null,
    fboNumero: order.fboNumero,
    fboNomComplet: order.fboNomComplet,
    billingGrade: order.billingGrade || order.fboGrade,
    paymentMode: order.preorderPaymentMode || null,
    deliveryMode: order.deliveryMode || null,
    totalFcfa: order.totalFcfa,
    indicativeTotalFcfa: order.indicativeTotalFcfa,
    computedGradeTotalFcfa: order.computedGradeTotalFcfa,
    as400InvoiceTotalFcfa: order.as400InvoiceTotalFcfa,
    factureReference: order.factureReference || null,
    items: (order.items || []).map((item) => ({
      productId: item.productId,
      sku: item.productSkuSnapshot || item.product?.sku || null,
      name: item.productNameSnapshot || item.product?.nom || null,
      qty: item.qty,
      unitPriceFcfa: Number(item.prixUnitaireFcfa || 0),
      lineTotalFcfa: item.lineTotalFcfa,
    })),
  };
}

function includeRequestDetails() {
  return {
    preorder: {
      select: {
        id: true,
        preorderNumber: true,
        status: true,
        paymentStatus: true,
        fboNumero: true,
        fboNomComplet: true,
        totalFcfa: true,
        factureReference: true,
        as400InvoiceTotalFcfa: true,
        billingWorkStatus: true,
        createdAt: true,
        submittedAt: true,
      },
    },
    createdBy: { select: { id: true, fullName: true, email: true, role: true } },
    updatedBy: { select: { id: true, fullName: true, email: true, role: true } },
    logs: {
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        actorAdmin: { select: { id: true, fullName: true, email: true, role: true } },
      },
    },
  };
}

async function addLog(tx, { requestId, level = "INFO", event, message, payload, actorAdminId }) {
  return tx.as400InvoiceRequestLog.create({
    data: {
      requestId,
      level,
      event,
      message,
      payload,
      actorAdminId,
    },
  });
}

async function listRequests({ countryId, status, preorderId, q, take = 50, skip = 0 }) {
  const where = { countryId };
  if (status) where.status = String(status).trim().toUpperCase();
  if (preorderId) where.preorderId = preorderId;
  if (q) {
    const value = String(q).trim();
    where.OR = [
      { as400InvoiceReference: { contains: value, mode: "insensitive" } },
      { as400OrderReference: { contains: value, mode: "insensitive" } },
      { preorder: { is: { preorderNumber: { contains: value, mode: "insensitive" } } } },
      { preorder: { is: { fboNumero: { contains: value, mode: "insensitive" } } } },
      { preorder: { is: { fboNomComplet: { contains: value, mode: "insensitive" } } } },
    ];
  }

  const safeTake = Math.min(Math.max(Number(take) || 50, 1), 100);
  const safeSkip = Math.max(Number(skip) || 0, 0);

  const [items, total] = await Promise.all([
    prisma.as400InvoiceRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: safeTake,
      skip: safeSkip,
      include: includeRequestDetails(),
    }),
    prisma.as400InvoiceRequest.count({ where }),
  ]);

  return { items, total, take: safeTake, skip: safeSkip };
}

async function getRequest({ countryId, id }) {
  return prisma.as400InvoiceRequest.findFirst({
    where: { id, countryId },
    include: includeRequestDetails(),
  });
}

async function enqueueInvoiceRequest({
  countryId,
  preorderId,
  actorAdminId,
  mode = "OBSERVATION",
  action = "CREATE_AND_VALIDATE_INVOICE",
  note,
}) {
  const normalizedMode = normalizeEnum(mode, ALLOWED_MODES, "OBSERVATION");
  const normalizedAction = normalizeEnum(action, ALLOWED_ACTIONS, "CREATE_AND_VALIDATE_INVOICE");

  return prisma.$transaction(async (tx) => {
    const order = await tx.preorder.findFirst({
      where: { id: preorderId, countryId },
      include: {
        items: {
          include: {
            product: { select: { id: true, sku: true, nom: true } },
          },
        },
      },
    });

    if (!order) {
      const err = new Error("Commande introuvable dans le pays courant");
      err.statusCode = 404;
      throw err;
    }

    const existing = await tx.as400InvoiceRequest.findFirst({
      where: {
        countryId,
        preorderId,
        action: normalizedAction,
        status: { in: ACTIVE_STATUSES },
      },
      include: includeRequestDetails(),
    });

    if (existing) {
      await addLog(tx, {
        requestId: existing.id,
        level: "INFO",
        event: "ENQUEUE_SKIPPED_ACTIVE_REQUEST_EXISTS",
        message: "Une demande AS400 active existe deja pour cette commande.",
        actorAdminId,
      });
      return { request: existing, created: false };
    }

    const idempotencyKey = buildIdempotencyKey({
      countryId,
      preorderId,
      action: normalizedAction,
    });

    const request = await tx.as400InvoiceRequest.upsert({
      where: { idempotencyKey },
      create: {
        countryId,
        preorderId,
        action: normalizedAction,
        mode: normalizedMode,
        status: "PENDING",
        idempotencyKey,
        requestedInvoiceReference: order.factureReference || null,
        requestedAmountFcfa: order.as400InvoiceTotalFcfa || order.totalFcfa || null,
        requestedPayload: buildRequestedPayload(order),
        createdById: actorAdminId || null,
        updatedById: actorAdminId || null,
      },
      update: {
        mode: normalizedMode,
        status: "PENDING",
        errorCode: null,
        errorMessage: null,
        humanReason: null,
        cancelledAt: null,
        failedAt: null,
        availableForProcessingAt: new Date(),
        updatedById: actorAdminId || null,
      },
      include: includeRequestDetails(),
    });

    await addLog(tx, {
      requestId: request.id,
      level: "INFO",
      event: "ENQUEUED",
      message: note || "Demande AS400 enregistree. Aucun automate n'a encore ete execute.",
      payload: { mode: normalizedMode, action: normalizedAction },
      actorAdminId,
    });

    return { request, created: true };
  });
}

async function markWaitingHuman({ countryId, id, actorAdminId, reason }) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.as400InvoiceRequest.updateMany({
      where: { id, countryId, status: { in: ACTIVE_STATUSES } },
      data: {
        status: "WAITING_HUMAN",
        humanReason: reason || "Traitement manuel requis",
        updatedById: actorAdminId || null,
      },
    });

    if (!request.count) {
      const err = new Error("Demande AS400 active introuvable");
      err.statusCode = 404;
      throw err;
    }

    await addLog(tx, {
      requestId: id,
      level: "WARN",
      event: "WAITING_HUMAN",
      message: reason || "Traitement manuel requis",
      actorAdminId,
    });

    return tx.as400InvoiceRequest.findFirst({
      where: { id, countryId },
      include: includeRequestDetails(),
    });
  });
}

async function cancelRequest({ countryId, id, actorAdminId, reason }) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.as400InvoiceRequest.updateMany({
      where: { id, countryId, status: { in: ACTIVE_STATUSES } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        humanReason: reason || null,
        updatedById: actorAdminId || null,
      },
    });

    if (!request.count) {
      const err = new Error("Demande AS400 active introuvable");
      err.statusCode = 404;
      throw err;
    }

    await addLog(tx, {
      requestId: id,
      level: "WARN",
      event: "CANCELLED",
      message: reason || "Demande AS400 annulee",
      actorAdminId,
    });

    return tx.as400InvoiceRequest.findFirst({
      where: { id, countryId },
      include: includeRequestDetails(),
    });
  });
}

module.exports = {
  listRequests,
  getRequest,
  enqueueInvoiceRequest,
  markWaitingHuman,
  cancelRequest,
};
