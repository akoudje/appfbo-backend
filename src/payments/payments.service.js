// backend/src/payments/payments.service.js
// Service de gestion des paiements, notamment l'intégration avec le provider Wave (Mobile Money).

const crypto = require("crypto");
const prisma = require("../prisma");
const paymentOrchestrator = require("./payment-orchestrator.service");
const { mapWaveSessionToInternal } = require("./payment-status.mapper");
const { scopeWhere, pickCountryId } = require("../helpers/countryScope");

function isWaveSimulationEnabled() {
  return String(process.env.ENABLE_WAVE_SIMULATION || "false") === "true";
}

async function addLogTx(
  tx,
  preorderId,
  action,
  note,
  meta,
  actorAdminId = null,
) {
  try {
    await tx.preorderLog.create({
      data: {
        preorderId,
        action,
        note: note || null,
        meta: meta || undefined,
        actorAdminId: actorAdminId || null,
      },
    });
  } catch (error) {
    console.warn("addLogTx skipped:", {
      preorderId,
      action,
      message: error?.message || String(error),
    });
  }
}

function buildWaveUrls(preorderId) {
  const publicBaseUrl =
    process.env.APP_PUBLIC_BASE_URL ||
    process.env.ADMIN_APP_PUBLIC_URL ||
    process.env.FRONTEND_PUBLIC_URL ||
    "http://localhost:5173";

  return {
    successUrl: `${publicBaseUrl}/orders/${preorderId}?tab=payment&wave=success`,
    errorUrl: `${publicBaseUrl}/orders/${preorderId}?tab=payment&wave=error`,
  };
}

async function resolveWaveProviderAccount(countryId) {
  const account = await prisma.paymentProviderAccount.findFirst({
    where: {
      countryId,
      provider: "WAVE",
      status: "ACTIVE",
      supportsCheckout: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!account) {
    const err = new Error("Aucun compte provider Wave actif pour ce pays");
    err.statusCode = 400;
    throw err;
  }

  return account;
}

function buildSyntheticWebhookId(parsed) {
  if (parsed.providerEventId) return parsed.providerEventId;
  const base = JSON.stringify(parsed.body || {});
  const hash = crypto.createHash("sha256").update(base).digest("hex");
  return `hash:${hash}`;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function getNested(source, path) {
  return path.reduce(
    (acc, key) => (acc == null ? undefined : acc[key]),
    source,
  );
}

function normalizePhone(value) {
  const raw = firstNonEmptyString(value);
  if (!raw) return null;
  const compact = raw.replace(/[^\d+]/g, "");
  return compact || raw;
}

function extractWaveProviderMetadata(raw = {}) {
  const providerSessionId =
    firstNonEmptyString(
      raw?.id,
      raw?.data?.id,
      raw?.checkout_session?.id,
      raw?.session?.id,
    ) || null;

  const providerTransactionId =
    firstNonEmptyString(
      raw?.transaction_id,
      raw?.data?.transaction_id,
      raw?.checkout_session?.transaction_id,
      raw?.session?.transaction_id,
      raw?.payment_id,
      raw?.data?.payment_id,
    ) || null;

  const providerPayerPhone = normalizePhone(
    firstNonEmptyString(
      raw?.payerPhone,
      raw?.payer_phone,
      raw?.providerPayerPhone,
      raw?.customer_msisdn,
      raw?.phone_number,
      raw?.sender_phone,
      raw?.sender_msisdn,
      raw?.customer_phone,
      raw?.customerPhone,
      raw?.data?.payerPhone,
      raw?.data?.payer_phone,
      raw?.data?.customer_msisdn,
      raw?.data?.phone_number,
      raw?.data?.sender_phone,
      raw?.data?.customer_phone,
      raw?.checkout_session?.payerPhone,
      raw?.checkout_session?.payer_phone,
      raw?.checkout_session?.customer_msisdn,
      raw?.checkout_session?.phone_number,
      raw?.checkout_session?.sender_phone,
      getNested(raw, ["payment_method", "phone_number"]),
      getNested(raw, ["payment_method", "payer_phone"]),
      getNested(raw, ["payment_method", "customer_msisdn"]),
      getNested(raw, ["payment_method", "sender_phone"]),
      getNested(raw, ["data", "payment_method", "phone_number"]),
      getNested(raw, ["data", "payment_method", "payer_phone"]),
      getNested(raw, ["data", "payment_method", "customer_msisdn"]),
      getNested(raw, ["data", "payment_method", "sender_phone"]),
      getNested(raw, ["checkout_session", "payment_method", "phone_number"]),
      getNested(raw, ["checkout_session", "payment_method", "payer_phone"]),
      getNested(raw, ["checkout_session", "payment_method", "customer_msisdn"]),
      getNested(raw, ["checkout_session", "payment_method", "sender_phone"]),
    ),
  );

  const providerStatusLabel =
    firstNonEmptyString(
      raw?.payment_status_label,
      raw?.checkout_status_label,
      raw?.status_label,
      raw?.data?.payment_status_label,
      raw?.data?.checkout_status_label,
      raw?.data?.status_label,
      raw?.checkout_session?.payment_status_label,
      raw?.checkout_session?.checkout_status_label,
      raw?.checkout_session?.status_label,
      raw?.payment_status,
      raw?.checkout_status,
    ) || null;

  const completedAt =
    firstNonEmptyString(
      raw?.when_completed,
      raw?.completed_at,
      raw?.paid_at,
      raw?.data?.when_completed,
      raw?.data?.completed_at,
      raw?.data?.paid_at,
      raw?.checkout_session?.when_completed,
      raw?.checkout_session?.completed_at,
      raw?.checkout_session?.paid_at,
    ) || null;

  return {
    providerSessionId,
    providerTransactionId,
    providerPayerPhone,
    providerStatusLabel,
    completedAt,
  };
}

async function resolvePreorderFromWebhookPayload(parsed) {
  const body = parsed.body || {};

  const clientReference =
    body?.data?.client_reference ||
    body?.client_reference ||
    body?.checkout_session?.client_reference ||
    null;

  if (clientReference) {
    const preorder = await prisma.preorder.findUnique({
      where: { id: clientReference },
    });
    if (preorder) return preorder;
  }

  const providerSessionId =
    body?.data?.id || body?.id || body?.checkout_session?.id || null;

  if (providerSessionId) {
    const attempt = await prisma.paymentAttempt.findFirst({
      where: {
        provider: "WAVE",
        providerSessionId,
      },
      include: {
        payment: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (attempt?.payment?.preorderId) {
      return prisma.preorder.findUnique({
        where: { id: attempt.payment.preorderId },
      });
    }
  }

  const providerTransactionId =
    body?.data?.transaction_id ||
    body?.transaction_id ||
    body?.checkout_session?.transaction_id ||
    null;

  if (providerTransactionId) {
    const attempt = await prisma.paymentAttempt.findFirst({
      where: {
        provider: "WAVE",
        providerTransactionId,
      },
      include: {
        payment: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (attempt?.payment?.preorderId) {
      return prisma.preorder.findUnique({
        where: { id: attempt.payment.preorderId },
      });
    }
  }

  return null;
}

function buildSimulatedProviderResponse({ preorderId, successUrl }) {
  const syntheticSessionId = `wave_sim_${preorderId}_${Date.now()}`;

  return {
    provider: "WAVE",
    raw: {
      id: syntheticSessionId,
      transaction_id: null,
      client_reference: preorderId,
      checkout_status: "open",
      payment_status: "processing",
      payment_status_label: "processing",
      wave_launch_url: `${successUrl}&simulated=1`,
      simulated: true,
    },
    providerSessionId: syntheticSessionId,
    providerTransactionId: null,
    providerPayerPhone: null,
    providerStatusLabel: "processing",
    checkoutUrl: `${successUrl}&simulated=1`,
    providerLaunchUrl: `${successUrl}&simulated=1`,
    clientReference: preorderId,
    checkoutStatus: "open",
    paymentStatus: "processing",
  };
}

function isSimulatedAttempt(lastAttempt, payment) {
  const providerSessionId =
    lastAttempt?.providerSessionId || payment?.providerReference || "";
  const responsePayloadJson = lastAttempt?.responsePayloadJson || {};
  const normalizedPayloadJson = lastAttempt?.normalizedPayloadJson || {};

  return (
    isWaveSimulationEnabled() ||
    String(providerSessionId).startsWith("wave_sim_") ||
    responsePayloadJson?.simulated === true ||
    normalizedPayloadJson?.simulated === true
  );
}

function buildProviderStatusFromLocalAttempt(lastAttempt, payment, preorder) {
  const responsePayload = lastAttempt?.responsePayloadJson || {};
  const normalized = lastAttempt?.normalizedPayloadJson || {};
  const metadata = extractWaveProviderMetadata(responsePayload);

  return {
    provider: "WAVE",
    raw: {
      id:
        metadata.providerSessionId ||
        lastAttempt?.providerSessionId ||
        payment?.providerReference ||
        null,
      transaction_id:
        metadata.providerTransactionId ||
        lastAttempt?.providerTransactionId ||
        payment?.providerTxnId ||
        null,
      client_reference:
        responsePayload?.client_reference || preorder?.id || null,
      checkout_status:
        responsePayload?.checkout_status ||
        normalized?.checkoutStatus ||
        "open",
      payment_status:
        responsePayload?.payment_status ||
        normalized?.paymentStatus ||
        "processing",
      payment_status_label:
        responsePayload?.payment_status_label ||
        normalized?.providerStatusLabel ||
        normalized?.paymentStatus ||
        "processing",
      payer_phone:
        metadata.providerPayerPhone ||
        lastAttempt?.providerPayerPhone ||
        normalized?.providerPayerPhone ||
        null,
      wave_launch_url:
        responsePayload?.wave_launch_url ||
        lastAttempt?.providerLaunchUrl ||
        lastAttempt?.checkoutUrl ||
        null,
      when_completed:
        metadata.completedAt ||
        responsePayload?.when_completed ||
        normalized?.whenCompleted ||
        null,
      simulated: true,
    },
  };
}

async function applyWaveMappedStateTx({
  tx,
  preorder,
  payment,
  lastAttempt,
  providerStatusRaw,
  mapped,
  actorAdminId = null,
}) {
  const now = new Date();
  const metadata = extractWaveProviderMetadata(providerStatusRaw);
  const completedAtDate = metadata.completedAt
    ? new Date(metadata.completedAt)
    : null;
  const paidAtValue =
    mapped.markOrderPaid &&
    completedAtDate &&
    !Number.isNaN(completedAtDate.getTime())
      ? completedAtDate
      : now;

  let updatedAttempt = null;

  if (lastAttempt) {
    updatedAttempt = await tx.paymentAttempt.update({
      where: { id: lastAttempt.id },
      data: {
        status: mapped.attemptStatus,
        providerSessionId:
          metadata.providerSessionId || lastAttempt.providerSessionId,
        providerTransactionId:
          metadata.providerTransactionId || lastAttempt.providerTransactionId,
        providerPayerPhone:
          lastAttempt.providerPayerPhone || metadata.providerPayerPhone,
        providerStatusLabel:
          metadata.providerStatusLabel || lastAttempt.providerStatusLabel,
        responsePayloadJson: providerStatusRaw,
        normalizedPayloadJson: {
          checkoutStatus: providerStatusRaw?.checkout_status || null,
          paymentStatus: providerStatusRaw?.payment_status || null,
          transactionId:
            metadata.providerTransactionId ||
            providerStatusRaw?.transaction_id ||
            null,
          providerSessionId: metadata.providerSessionId || null,
          providerPayerPhone: metadata.providerPayerPhone || null,
          providerStatusLabel: metadata.providerStatusLabel || null,
          whenCompleted:
            metadata.completedAt || providerStatusRaw?.when_completed || null,
          simulated: providerStatusRaw?.simulated === true,
        },
        completedAt: mapped.isFinal
          ? completedAtDate && !Number.isNaN(completedAtDate.getTime())
            ? completedAtDate
            : now
          : lastAttempt.completedAt,
        failureCode: mapped.markExpired
          ? "WAVE_EXPIRED"
          : mapped.markCancelled
            ? "WAVE_CANCELLED"
            : mapped.markFailed
              ? "WAVE_FAILED"
              : null,
        failureMessage: mapped.markExpired
          ? "Session Wave expirée"
          : mapped.markCancelled
            ? "Paiement Wave annulé"
            : mapped.markFailed
              ? "Paiement Wave échoué"
              : null,
      },
    });
  }

  const paymentData = {
    status: mapped.paymentStatus,
    providerReference: metadata.providerSessionId || payment.providerReference,
    providerTxnId: metadata.providerTransactionId || payment.providerTxnId,
    providerPayerPhone:
      payment.providerPayerPhone || metadata.providerPayerPhone,
  };

  if (mapped.markOrderPaid) {
    paymentData.amountPaidFcfa = payment.amountExpectedFcfa;
    paymentData.paidAt = payment.paidAt || paidAtValue;
  }

  if (mapped.markExpired) {
    paymentData.expiredAt = payment.expiredAt || now;
  }

  if (mapped.markCancelled) {
    paymentData.cancelledAt = payment.cancelledAt || now;
  }

  if (mapped.markFailed) {
    paymentData.failedAt = payment.failedAt || now;
  }

  const updatedPayment = await tx.payment.update({
    where: { id: payment.id },
    data: paymentData,
  });

  const preorderData = {
    paymentStatus: mapped.orderPaymentStatus,
    billingLastActivityAt: now,
  };

  if (mapped.markOrderPaid) {
    preorderData.status = "PAID";
    preorderData.paidAt = preorder.paidAt || paidAtValue;
    preorderData.billingCompletedAt = preorder.billingCompletedAt || now;
    preorderData.paymentProvider = "WAVE";
  }

  const updatedPreorder = await tx.preorder.update({
    where: { id: preorder.id },
    data: preorderData,
    include: {
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
    },
  });

  await addLogTx(
    tx,
    preorder.id,
    "PAYMENT_UPDATED",
    "Synchronisation statut Wave",
    {
      paymentId: updatedPayment.id,
      paymentAttemptId: updatedAttempt?.id || null,
      mapped,
      providerStatus: providerStatusRaw,
      provider: "WAVE",
      providerSessionId: metadata.providerSessionId,
      providerTransactionId: metadata.providerTransactionId,
      providerPayerPhone: metadata.providerPayerPhone,
      providerStatusLabel: metadata.providerStatusLabel,
      simulated: providerStatusRaw?.simulated === true,
    },
    actorAdminId,
  );

  if (metadata.providerPayerPhone) {
    console.log("[payments][wave] payer phone captured", {
      preorderId: preorder.id,
      paymentId: payment.id,
      paymentAttemptId: updatedAttempt?.id || null,
      providerSessionId: metadata.providerSessionId,
      providerTransactionId: metadata.providerTransactionId,
      providerPayerPhone: metadata.providerPayerPhone,
    });
  }

  if (mapped.markOrderPaid) {
    await addLogTx(
      tx,
      preorder.id,
      "PAYMENT_UPDATED",
      "Paiement confirmé via Wave",
      {
        paymentProvider: "WAVE",
        paymentStatus: "PAID",
        paymentId: updatedPayment.id,
        simulated: providerStatusRaw?.simulated === true,
      },
      actorAdminId,
    );
  }

  return {
    payment: updatedPayment,
    paymentAttempt: updatedAttempt,
    preorder: updatedPreorder,
  };
}

async function initiateWavePayment({ req, preorderId, restrictPayerMobile }) {
  const countryId = pickCountryId(req);

  const preorder = await prisma.preorder.findFirst({
    where: scopeWhere(req, { id: preorderId }),
    include: {
      activePayment: true,
    },
  });

  if (!preorder) {
    const err = new Error("Commande introuvable");
    err.statusCode = 404;
    throw err;
  }

  if (!["INVOICED", "PAYMENT_PENDING"].includes(preorder.status)) {
    const err = new Error(
      `Impossible d'initier Wave depuis le statut ${preorder.status}`,
    );
    err.statusCode = 400;
    throw err;
  }

  const providerAccount = await resolveWaveProviderAccount(countryId);
  const { successUrl, errorUrl } = buildWaveUrls(preorder.id);

  const simulation = isWaveSimulationEnabled();

  let providerResponse;

  if (simulation) {
    providerResponse = buildSimulatedProviderResponse({
      preorderId: preorder.id,
      successUrl,
    });
  } else {
    providerResponse = await paymentOrchestrator.createCheckoutSession("WAVE", {
      amountFcfa: preorder.totalFcfa,
      successUrl,
      errorUrl,
      clientReference: preorder.id,
      restrictPayerMobile,
    });
  }

  const now = new Date();
  const providerMetadata = extractWaveProviderMetadata(providerResponse.raw);

  const result = await prisma.$transaction(async (tx) => {
    let payment = preorder.activePayment;

    if (
      !payment ||
      ["FAILED", "EXPIRED", "CANCELLED"].includes(payment.status)
    ) {
      payment = await tx.payment.create({
        data: {
          preorderId: preorder.id,
          countryId,
          provider: "WAVE",
          methodType: "MOBILE_MONEY",
          status: "PENDING_CUSTOMER_ACTION",
          amountExpectedFcfa: preorder.totalFcfa,
          amountPaidFcfa: 0,
          currencyCode: "XOF",
          providerAccountId: providerAccount.id,
          providerReference:
            providerMetadata.providerSessionId ||
            providerResponse.providerSessionId,
          providerTxnId:
            providerMetadata.providerTransactionId ||
            providerResponse.providerTransactionId,
          clientReference: preorder.id,
          initiatedAt: now,
        },
      });

      await tx.preorder.update({
        where: { id: preorder.id },
        data: { activePaymentId: payment.id },
      });
    } else {
      payment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          provider: "WAVE",
          methodType: "MOBILE_MONEY",
          status: "PENDING_CUSTOMER_ACTION",
          providerAccountId: providerAccount.id,
          providerReference:
            providerMetadata.providerSessionId ||
            providerResponse.providerSessionId,
          providerTxnId:
            providerMetadata.providerTransactionId ||
            providerResponse.providerTransactionId,
          clientReference: preorder.id,
        },
      });
    }

    const attempt = await tx.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        provider: "WAVE",
        status: providerResponse.checkoutUrl
          ? "REDIRECT_READY"
          : "PROVIDER_SESSION_CREATED",
        providerSessionId:
          providerMetadata.providerSessionId ||
          providerResponse.providerSessionId,
        providerTransactionId:
          providerMetadata.providerTransactionId ||
          providerResponse.providerTransactionId,
        providerPayerPhone:
          providerMetadata.providerPayerPhone ||
          providerResponse.providerPayerPhone,
        providerStatusLabel:
          providerMetadata.providerStatusLabel ||
          providerResponse.providerStatusLabel,
        checkoutUrl: providerResponse.checkoutUrl,
        providerLaunchUrl: providerResponse.providerLaunchUrl,
        requestPayloadJson: {
          preorderId: preorder.id,
          amountExpectedFcfa: preorder.totalFcfa,
          clientReference: preorder.id,
          restrictPayerMobile: restrictPayerMobile || null,
          simulated: simulation,
        },
        responsePayloadJson: providerResponse.raw,
        normalizedPayloadJson: {
          providerSessionId:
            providerMetadata.providerSessionId ||
            providerResponse.providerSessionId,
          providerTransactionId:
            providerMetadata.providerTransactionId ||
            providerResponse.providerTransactionId,
          providerPayerPhone:
            providerMetadata.providerPayerPhone ||
            providerResponse.providerPayerPhone,
          providerStatusLabel:
            providerMetadata.providerStatusLabel ||
            providerResponse.providerStatusLabel,
          checkoutUrl: providerResponse.checkoutUrl,
          providerLaunchUrl: providerResponse.providerLaunchUrl,
          clientReference: providerResponse.clientReference,
          checkoutStatus: providerResponse.checkoutStatus,
          paymentStatus: providerResponse.paymentStatus,
          simulated: simulation,
        },
      },
    });

    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: { lastAttemptId: attempt.id },
    });

    const updatedPreorder = await tx.preorder.update({
      where: { id: preorder.id },
      data: {
        status:
          preorder.status === "PAID" ? preorder.status : "PAYMENT_PENDING",
        paymentStatus: "PAYMENT_PENDING",
        paymentProvider: "WAVE",
        billingWorkStatus: "WAITING_PAYMENT",
        billingLastActivityAt: now,
      },
      include: {
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
          take: 5,
        },
      },
    });

    await addLogTx(
      tx,
      preorder.id,
      "PAYMENT_UPDATED",
      simulation ? "Paiement Wave initié (simulation)" : "Paiement Wave initié",
      {
        paymentId: updatedPayment.id,
        paymentAttemptId: attempt.id,
        provider: "WAVE",
        providerSessionId:
          providerMetadata.providerSessionId ||
          providerResponse.providerSessionId,
        providerTransactionId:
          providerMetadata.providerTransactionId ||
          providerResponse.providerTransactionId,
        providerPayerPhone:
          providerMetadata.providerPayerPhone ||
          providerResponse.providerPayerPhone,
        providerStatusLabel:
          providerMetadata.providerStatusLabel ||
          providerResponse.providerStatusLabel,
        checkoutUrl: providerResponse.checkoutUrl,
        simulated: simulation,
      },
      req.user?.id || null,
    );

    if (providerMetadata.providerPayerPhone) {
      console.log("[payments][wave] payer phone captured at initiation", {
        preorderId: preorder.id,
        paymentId: updatedPayment.id,
        paymentAttemptId: attempt.id,
        providerPayerPhone: providerMetadata.providerPayerPhone,
      });
    }

    return {
      payment: updatedPayment,
      paymentAttempt: attempt,
      preorder: updatedPreorder,
    };
  });

  return {
    ok: true,
    simulated: simulation,
    ...result,
    checkoutUrl: result.paymentAttempt.checkoutUrl,
  };
}

async function syncWavePaymentStatus({ req, preorderId }) {
  const preorder = await prisma.preorder.findFirst({
    where: scopeWhere(req, { id: preorderId }),
    include: {
      activePayment: {
        include: {
          attempts: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!preorder) {
    const err = new Error("Commande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const payment = preorder.activePayment;
  if (!payment) {
    const err = new Error("Aucun paiement actif trouvé pour cette commande");
    err.statusCode = 400;
    throw err;
  }

  if (payment.provider !== "WAVE") {
    const err = new Error("Le paiement actif n'est pas de type Wave");
    err.statusCode = 400;
    throw err;
  }

  const lastAttempt = payment.attempts?.[0];
  const providerSessionId =
    lastAttempt?.providerSessionId || payment.providerReference;

  if (!providerSessionId) {
    const err = new Error("providerSessionId introuvable");
    err.statusCode = 400;
    throw err;
  }

  let providerStatus;

  if (isSimulatedAttempt(lastAttempt, payment)) {
    providerStatus = buildProviderStatusFromLocalAttempt(
      lastAttempt,
      payment,
      preorder,
    );
  } else {
    providerStatus = await paymentOrchestrator.getCheckoutSession("WAVE", {
      providerSessionId,
    });
  }

  const mapped = mapWaveSessionToInternal(providerStatus.raw);

  const result = await prisma.$transaction(async (tx) => {
    return applyWaveMappedStateTx({
      tx,
      preorder,
      payment,
      lastAttempt,
      providerStatusRaw: providerStatus.raw,
      mapped,
      actorAdminId: req.user?.id || null,
    });
  });

  return {
    ok: true,
    simulated: providerStatus.raw?.simulated === true,
    ...result,
    mapped,
    providerStatus: providerStatus.raw,
  };
}

async function simulateWaveStatus({ req, preorderId, scenario }) {
  if (!isWaveSimulationEnabled()) {
    const err = new Error("Simulation Wave désactivée");
    err.statusCode = 403;
    throw err;
  }

  const allowed = new Set([
    "processing",
    "succeeded",
    "expired",
    "cancelled",
    "failed",
  ]);
  const normalizedScenario = String(scenario || "")
    .trim()
    .toLowerCase();

  if (!allowed.has(normalizedScenario)) {
    const err = new Error(
      "scenario invalide. Valeurs autorisées: processing, succeeded, expired, cancelled, failed",
    );
    err.statusCode = 400;
    throw err;
  }

  const preorder = await prisma.preorder.findFirst({
    where: scopeWhere(req, { id: preorderId }),
    include: {
      activePayment: {
        include: {
          attempts: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!preorder) {
    const err = new Error("Commande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const payment = preorder.activePayment;
  if (!payment || payment.provider !== "WAVE") {
    const err = new Error(
      "Aucun paiement Wave actif trouvé pour cette commande",
    );
    err.statusCode = 400;
    throw err;
  }

  const lastAttempt = payment.attempts?.[0];
  if (!lastAttempt) {
    const err = new Error("Aucune tentative Wave trouvée");
    err.statusCode = 400;
    throw err;
  }

  const fakeSession = {
    id: lastAttempt.providerSessionId || payment.providerReference,
    transaction_id:
      lastAttempt.providerTransactionId || payment.providerTxnId || null,
    payer_phone:
      lastAttempt.providerPayerPhone ||
      lastAttempt.normalizedPayloadJson?.providerPayerPhone ||
      null,
    client_reference: preorder.id,
    checkout_status:
      normalizedScenario === "succeeded"
        ? "complete"
        : normalizedScenario === "expired"
          ? "expired"
          : normalizedScenario === "failed"
            ? "failed"
            : "open",
    payment_status:
      normalizedScenario === "succeeded"
        ? "succeeded"
        : normalizedScenario === "cancelled"
          ? "cancelled"
          : normalizedScenario === "failed"
            ? "failed"
            : "processing",
    payment_status_label: normalizedScenario,
    wave_launch_url:
      lastAttempt.providerLaunchUrl || lastAttempt.checkoutUrl || null,
    when_completed:
      normalizedScenario === "succeeded" ? new Date().toISOString() : null,
    simulated: true,
  };

  const mapped = mapWaveSessionToInternal(fakeSession);

  const result = await prisma.$transaction(async (tx) => {
    return applyWaveMappedStateTx({
      tx,
      preorder,
      payment,
      lastAttempt,
      providerStatusRaw: fakeSession,
      mapped,
      actorAdminId: req.user?.id || null,
    });
  });

  return {
    ok: true,
    simulated: true,
    scenario: normalizedScenario,
    ...result,
    mapped,
    providerStatus: fakeSession,
  };
}

async function handleWaveWebhook({ req }) {
  
  const parsed = await paymentOrchestrator.parseWebhook("WAVE", { req });

  console.log("[wave webhook payload]", JSON.stringify(parsed.body, null, 2));
  
  const syntheticEventId = buildSyntheticWebhookId(parsed);

  let event = null;

  try {
    event = await prisma.paymentWebhookEvent.create({
      data: {
        provider: "WAVE",
        providerEventId: syntheticEventId,
        eventType: parsed.eventType || null,
        signatureValid: Boolean(parsed.signatureValid),
        processingStatus: "RECEIVED",
        requestHeadersJson: parsed.headers || {},
        payloadJson: parsed.body || {},
      },
    });
  } catch (_e) {
    return {
      ok: true,
      received: true,
      duplicate: true,
    };
  }

  try {
    if (!parsed.signatureValid) {
      await prisma.paymentWebhookEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: "FAILED",
          processedAt: new Date(),
          errorMessage:
            parsed.signatureReason || "Signature webhook Wave invalide",
        },
      });

      return {
        ok: true,
        received: true,
        processed: false,
        error: parsed.signatureReason || "Signature webhook invalide",
      };
    }

    const preorder = await resolvePreorderFromWebhookPayload(parsed);

    if (preorder) {
      console.log("[payments][wave] webhook received", {
        preorderId: preorder.id,
        providerEventId: syntheticEventId,
        eventType: parsed.eventType || null,
      });
      await syncWavePaymentStatus({
        req: {
          ...req,
          user: null,
          countryId: preorder.countryId,
          country: { id: preorder.countryId },
        },
        preorderId: preorder.id,
      });
    }

    await prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: "PROCESSED",
        processedAt: new Date(),
      },
    });

    return {
      ok: true,
      received: true,
      processed: true,
    };
  } catch (e) {
    await prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: "FAILED",
        processedAt: new Date(),
        errorMessage: e.message || "Erreur traitement webhook Wave",
      },
    });

    return {
      ok: true,
      received: true,
      processed: false,
      error: e.message,
    };
  }
}

module.exports = {
  initiateWavePayment,
  syncWavePaymentStatus,
  simulateWaveStatus,
  handleWaveWebhook,
};
