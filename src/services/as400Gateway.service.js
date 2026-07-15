const prisma = require("../prisma");

const ACTIVE_STATUSES = ["PENDING", "RUNNING", "WAITING_HUMAN"];
const ALLOWED_MODES = new Set(["OBSERVATION", "ASSISTED", "AUTOMATIC"]);
const ALLOWED_ACTIONS = new Set(["CREATE_AND_VALIDATE_INVOICE", "CHECK_INVOICE_STATUS"]);
const DEFAULT_CONFIG = {
  enabled: false,
  defaultMode: "OBSERVATION",
  allowObservation: true,
  allowAssisted: false,
  allowAutomatic: false,
  workerId: null,
  hllapiProfileName: null,
  sessionName: null,
  environmentLabel: null,
  maxAttempts: 1,
  lockTimeoutSeconds: 900,
  pollIntervalSeconds: 30,
  claimBatchSize: 1,
  settingsJson: null,
  lastHeartbeatAt: null,
};

function normalizeWorkerId(value) {
  const normalized = String(value || "").trim();
  return normalized || "admin-api";
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeOptionalAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount);
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isModeAllowed(config, mode) {
  if (mode === "OBSERVATION") return config.allowObservation !== false;
  if (mode === "ASSISTED") return Boolean(config.allowAssisted);
  if (mode === "AUTOMATIC") return Boolean(config.allowAutomatic);
  return false;
}

function serializeConfig(config, countryId) {
  return {
    ...DEFAULT_CONFIG,
    ...(config || {}),
    id: config?.id || null,
    countryId: config?.countryId || countryId,
  };
}

function normalizeConfigPayload(body = {}) {
  const defaultMode = normalizeEnum(body.defaultMode, ALLOWED_MODES, "OBSERVATION");
  const allowObservation =
    body.allowObservation === undefined ? true : Boolean(body.allowObservation);
  const allowAssisted = Boolean(body.allowAssisted);
  const allowAutomatic = Boolean(body.allowAutomatic);

  if (!isModeAllowed({ allowObservation, allowAssisted, allowAutomatic }, defaultMode)) {
    const err = new Error(`Le mode par défaut ${defaultMode} doit être autorisé`);
    err.statusCode = 400;
    throw err;
  }

  return {
    enabled: Boolean(body.enabled),
    defaultMode,
    allowObservation,
    allowAssisted,
    allowAutomatic,
    workerId: normalizeOptionalText(body.workerId),
    hllapiProfileName: normalizeOptionalText(body.hllapiProfileName),
    sessionName: normalizeOptionalText(body.sessionName),
    environmentLabel: normalizeOptionalText(body.environmentLabel),
    maxAttempts: clampInt(body.maxAttempts, 1, 1, 10),
    lockTimeoutSeconds: clampInt(body.lockTimeoutSeconds, 900, 60, 7200),
    pollIntervalSeconds: clampInt(body.pollIntervalSeconds, 30, 5, 3600),
    claimBatchSize: clampInt(body.claimBatchSize, 1, 1, 20),
    settingsJson:
      body.settingsJson && typeof body.settingsJson === "object"
        ? body.settingsJson
        : undefined,
  };
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

async function getConfig({ countryId }) {
  const config = await prisma.as400GatewayConfig.findUnique({
    where: { countryId },
  });
  return serializeConfig(config, countryId);
}

async function updateConfig({ countryId, actorAdminId, data }) {
  const payload = normalizeConfigPayload(data || {});
  const config = await prisma.as400GatewayConfig.upsert({
    where: { countryId },
    create: {
      countryId,
      ...payload,
    },
    update: payload,
  });

  return {
    config: serializeConfig(config, countryId),
    updatedById: actorAdminId || null,
  };
}

async function heartbeatConfig({ countryId, workerId }) {
  const config = await prisma.as400GatewayConfig.update({
    where: { countryId },
    data: {
      lastHeartbeatAt: new Date(),
      workerId: normalizeOptionalText(workerId) || undefined,
    },
  });

  return serializeConfig(config, countryId);
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

async function claimNextRequest({ countryId, actorAdminId, workerId, mode, action }) {
  const config = await getConfig({ countryId });
  if (!config.enabled) {
    const err = new Error("Gateway AS400 désactivé pour ce pays");
    err.statusCode = 409;
    throw err;
  }

  const normalizedMode = mode ? normalizeEnum(mode, ALLOWED_MODES, null) : null;
  const normalizedAction = action ? normalizeEnum(action, ALLOWED_ACTIONS, null) : null;
  const now = new Date();
  const lockedBy = normalizeWorkerId(workerId || actorAdminId);
  const modeForClaim = normalizedMode || config.defaultMode;

  if (!isModeAllowed(config, modeForClaim)) {
    const err = new Error(`Mode AS400 non autorisé: ${modeForClaim}`);
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const where = {
      countryId,
      status: "PENDING",
      availableForProcessingAt: { lte: now },
    };

    where.mode = modeForClaim;
    if (normalizedAction) where.action = normalizedAction;

    const candidates = await tx.as400InvoiceRequest.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: config.claimBatchSize || 1,
      select: { id: true, attempts: true, maxAttempts: true },
    });

    for (const candidate of candidates) {
      if (candidate.attempts >= candidate.maxAttempts) continue;

      const claimed = await tx.as400InvoiceRequest.updateMany({
        where: { id: candidate.id, countryId, status: "PENDING" },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          lockedAt: now,
          lockedBy,
          startedAt: now,
          errorCode: null,
          errorMessage: null,
          updatedById: actorAdminId || null,
        },
      });

      if (!claimed.count) continue;

      await addLog(tx, {
        requestId: candidate.id,
        level: "INFO",
        event: "CLAIMED",
        message: `Demande AS400 prise en charge par ${lockedBy}.`,
        payload: { workerId: lockedBy },
        actorAdminId,
      });

      return tx.as400InvoiceRequest.findFirst({
        where: { id: candidate.id, countryId },
        include: includeRequestDetails(),
      });
    }

    return null;
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
  const config = await getConfig({ countryId });
  const normalizedMode = normalizeEnum(mode, ALLOWED_MODES, config.defaultMode || "OBSERVATION");
  const normalizedAction = normalizeEnum(action, ALLOWED_ACTIONS, "CREATE_AND_VALIDATE_INVOICE");

  if (!isModeAllowed(config, normalizedMode)) {
    const err = new Error(`Mode AS400 non autorisé: ${normalizedMode}`);
    err.statusCode = 400;
    throw err;
  }

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
        maxAttempts: config.maxAttempts || 1,
        requestedInvoiceReference: order.factureReference || null,
        requestedAmountFcfa: order.as400InvoiceTotalFcfa || order.totalFcfa || null,
        requestedPayload: buildRequestedPayload(order),
        createdById: actorAdminId || null,
        updatedById: actorAdminId || null,
      },
      update: {
        mode: normalizedMode,
        status: "PENDING",
        maxAttempts: config.maxAttempts || 1,
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

async function completeRequest({
  countryId,
  id,
  actorAdminId,
  workerId,
  as400InvoiceReference,
  as400OrderReference,
  as400AmountFcfa,
  as400Validated,
  spoolFilePath,
  screenSnapshotPath,
  resultPayload,
  message,
}) {
  const now = new Date();
  const lockedBy = normalizeWorkerId(workerId || actorAdminId);
  const invoiceReference = normalizeOptionalText(as400InvoiceReference);
  const orderReference = normalizeOptionalText(as400OrderReference);
  const amount = normalizeOptionalAmount(as400AmountFcfa);
  const validated = as400Validated === undefined ? true : Boolean(as400Validated);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.as400InvoiceRequest.updateMany({
      where: { id, countryId, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        as400InvoiceReference: invoiceReference,
        as400OrderReference: orderReference,
        as400AmountFcfa: amount,
        as400Validated: validated,
        as400ValidatedAt: validated ? now : null,
        spoolFilePath: normalizeOptionalText(spoolFilePath),
        screenSnapshotPath: normalizeOptionalText(screenSnapshotPath),
        resultPayload: resultPayload || undefined,
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        errorCode: null,
        errorMessage: null,
        updatedById: actorAdminId || null,
      },
    });

    if (!updated.count) {
      const err = new Error("Demande AS400 RUNNING introuvable");
      err.statusCode = 404;
      throw err;
    }

    await addLog(tx, {
      requestId: id,
      level: "INFO",
      event: "COMPLETED",
      message: message || `Demande AS400 terminee par ${lockedBy}.`,
      payload: {
        workerId: lockedBy,
        as400InvoiceReference: invoiceReference,
        as400OrderReference: orderReference,
        as400AmountFcfa: amount,
        as400Validated: validated,
      },
      actorAdminId,
    });

    return tx.as400InvoiceRequest.findFirst({
      where: { id, countryId },
      include: includeRequestDetails(),
    });
  });
}

async function failRequest({
  countryId,
  id,
  actorAdminId,
  workerId,
  errorCode,
  errorMessage,
  retry = false,
  retryDelaySeconds = 300,
  screenSnapshotPath,
  resultPayload,
}) {
  const now = new Date();
  const lockedBy = normalizeWorkerId(workerId || actorAdminId);

  return prisma.$transaction(async (tx) => {
    const request = await tx.as400InvoiceRequest.findFirst({
      where: { id, countryId, status: "RUNNING" },
      select: { id: true, attempts: true, maxAttempts: true },
    });

    if (!request) {
      const err = new Error("Demande AS400 RUNNING introuvable");
      err.statusCode = 404;
      throw err;
    }

    const canRetry = Boolean(retry) && request.attempts < request.maxAttempts;
    const retryDelayMs = Math.max(Number(retryDelaySeconds) || 300, 0) * 1000;
    const nextAvailableAt = new Date(now.getTime() + retryDelayMs);

    await tx.as400InvoiceRequest.update({
      where: { id },
      data: {
        status: canRetry ? "PENDING" : "FAILED",
        errorCode: normalizeOptionalText(errorCode),
        errorMessage: normalizeOptionalText(errorMessage) || "Erreur automate AS400",
        screenSnapshotPath: normalizeOptionalText(screenSnapshotPath),
        resultPayload: resultPayload || undefined,
        availableForProcessingAt: canRetry ? nextAvailableAt : now,
        failedAt: canRetry ? null : now,
        lockedAt: null,
        lockedBy: null,
        updatedById: actorAdminId || null,
      },
    });

    await addLog(tx, {
      requestId: id,
      level: "ERROR",
      event: canRetry ? "FAILED_RETRY_SCHEDULED" : "FAILED",
      message:
        normalizeOptionalText(errorMessage) ||
        (canRetry ? "Erreur AS400, nouvelle tentative programmee." : "Erreur AS400 definitive."),
      payload: {
        workerId: lockedBy,
        errorCode: normalizeOptionalText(errorCode),
        retry: canRetry,
        retryDelaySeconds: canRetry ? retryDelaySeconds : null,
      },
      actorAdminId,
    });

    return tx.as400InvoiceRequest.findFirst({
      where: { id, countryId },
      include: includeRequestDetails(),
    });
  });
}

module.exports = {
  getConfig,
  updateConfig,
  heartbeatConfig,
  listRequests,
  getRequest,
  claimNextRequest,
  enqueueInvoiceRequest,
  markWaitingHuman,
  cancelRequest,
  completeRequest,
  failRequest,
};
