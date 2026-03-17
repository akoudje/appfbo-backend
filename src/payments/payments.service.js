// src/payments/payments.service.js

const crypto = require("crypto");
const prisma = require("../prisma");
const paymentOrchestrator = require("./payment-orchestrator.service");
const { mapWaveSessionToInternal } = require("./payment-status.mapper");
const { scopeWhere, pickCountryId } = require("../helpers/countryScope");

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
    body?.data?.id ||
    body?.id ||
    body?.checkout_session?.id ||
    null;

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

  let updatedAttempt = null;

  if (lastAttempt) {
    updatedAttempt = await tx.paymentAttempt.update({
      where: { id: lastAttempt.id },
      data: {
        status: mapped.attemptStatus,
        responsePayloadJson: providerStatusRaw,
        normalizedPayloadJson: {
          checkoutStatus: providerStatusRaw?.checkout_status || null,
          paymentStatus: providerStatusRaw?.payment_status || null,
          transactionId: providerStatusRaw?.transaction_id || null,
          whenCompleted: providerStatusRaw?.when_completed || null,
        },
        completedAt: mapped.isFinal ? now : lastAttempt.completedAt,
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
    providerTxnId: providerStatusRaw?.transaction_id || payment.providerTxnId,
  };

  if (mapped.markOrderPaid) {
    paymentData.amountPaidFcfa = payment.amountExpectedFcfa;
    paymentData.paidAt = payment.paidAt || now;
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
    preorderData.paidAt = preorder.paidAt || now;
    preorderData.billingWorkStatus = "DONE";
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
    "WAVE_PAYMENT_SYNC",
    "Synchronisation statut Wave",
    {
      paymentId: updatedPayment.id,
      paymentAttemptId: updatedAttempt?.id || null,
      mapped,
      providerStatus: providerStatusRaw,
    },
    actorAdminId
  );

  if (mapped.markOrderPaid) {
    await addLogTx(
      tx,
      preorder.id,
      "PAYMENT_CONFIRMED",
      "Paiement confirmé via Wave",
      {
        paymentProvider: "WAVE",
        paymentStatus: "PAID",
        paymentId: updatedPayment.id,
      },
      actorAdminId
    );
  }

  return {
    payment: updatedPayment,
    paymentAttempt: updatedAttempt,
    preorder: updatedPreorder,
  };
}

async function initiateWavePayment({
  req,
  preorderId,
  restrictPayerMobile,
}) {
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
      `Impossible d'initier Wave depuis le statut ${preorder.status}`
    );
    err.statusCode = 400;
    throw err;
  }

  const providerAccount = await resolveWaveProviderAccount(countryId);
  const { successUrl, errorUrl } = buildWaveUrls(preorder.id);

  const isWaveSimulation =
    String(process.env.ENABLE_WAVE_SIMULATION || "false") === "true";

  let providerResponse;

  if (isWaveSimulation) {
    const syntheticSessionId = `wave_sim_${preorder.id}_${Date.now()}`;

    providerResponse = {
      provider: "WAVE",
      raw: {
        id: syntheticSessionId,
        transaction_id: null,
        client_reference: preorder.id,
        checkout_status: "open",
        payment_status: "processing",
        wave_launch_url: `${successUrl}&simulated=1`,
        simulated: true,
      },
      providerSessionId: syntheticSessionId,
      providerTransactionId: null,
      checkoutUrl: `${successUrl}&simulated=1`,
      providerLaunchUrl: `${successUrl}&simulated=1`,
      clientReference: preorder.id,
      checkoutStatus: "open",
      paymentStatus: "processing",
    };
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
          providerReference: providerResponse.providerSessionId,
          providerTxnId: providerResponse.providerTransactionId,
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
          providerReference: providerResponse.providerSessionId,
          providerTxnId: providerResponse.providerTransactionId,
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
        providerSessionId: providerResponse.providerSessionId,
        providerTransactionId: providerResponse.providerTransactionId,
        checkoutUrl: providerResponse.checkoutUrl,
        providerLaunchUrl: providerResponse.providerLaunchUrl,
        requestPayloadJson: {
          preorderId: preorder.id,
          amountExpectedFcfa: preorder.totalFcfa,
          clientReference: preorder.id,
          restrictPayerMobile: restrictPayerMobile || null,
          simulated: isWaveSimulation,
        },
        responsePayloadJson: providerResponse.raw,
        normalizedPayloadJson: {
          providerSessionId: providerResponse.providerSessionId,
          providerTransactionId: providerResponse.providerTransactionId,
          checkoutUrl: providerResponse.checkoutUrl,
          providerLaunchUrl: providerResponse.providerLaunchUrl,
          clientReference: providerResponse.clientReference,
          checkoutStatus: providerResponse.checkoutStatus,
          paymentStatus: providerResponse.paymentStatus,
          simulated: isWaveSimulation,
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
        status: preorder.status === "PAID" ? preorder.status : "PAYMENT_PENDING",
        paymentStatus: "PAYMENT_PENDING",
        paymentProvider: "WAVE",
        paymentLink: providerResponse.checkoutUrl || preorder.paymentLink,
        paymentRef: providerResponse.providerSessionId || preorder.paymentRef,
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
      "WAVE_PAYMENT_INITIATED",
      isWaveSimulation
        ? "Paiement Wave initié (simulation)"
        : "Paiement Wave initié",
      {
        paymentId: updatedPayment.id,
        paymentAttemptId: attempt.id,
        provider: "WAVE",
        providerSessionId: providerResponse.providerSessionId,
        providerTransactionId: providerResponse.providerTransactionId,
        checkoutUrl: providerResponse.checkoutUrl,
        simulated: isWaveSimulation,
      },
      req.user?.id || null
    );

    return {
      payment: updatedPayment,
      paymentAttempt: attempt,
      preorder: updatedPreorder,
    };
  });

  return {
    ok: true,
    simulated: isWaveSimulation,
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

  const providerStatus = await paymentOrchestrator.getCheckoutSession("WAVE", {
    providerSessionId,
  });

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
    ...result,
    mapped,
    providerStatus: providerStatus.raw,
  };
}

// ✅ simulation locale sans vraie API Wave
async function simulateWaveStatus({ req, preorderId, scenario }) {
  if (String(process.env.ENABLE_WAVE_SIMULATION || "false") !== "true") {
    const err = new Error("Simulation Wave désactivée");
    err.statusCode = 403;
    throw err;
  }

  const allowed = new Set(["processing", "succeeded", "expired", "cancelled"]);
  const normalizedScenario = String(scenario || "").trim().toLowerCase();

  if (!allowed.has(normalizedScenario)) {
    const err = new Error(
      "scenario invalide. Valeurs autorisées: processing, succeeded, expired, cancelled"
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
    const err = new Error("Aucun paiement Wave actif trouvé pour cette commande");
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
    client_reference: preorder.id,
    checkout_status:
      normalizedScenario === "succeeded"
        ? "complete"
        : normalizedScenario === "expired"
          ? "expired"
          : "open",
    payment_status:
      normalizedScenario === "succeeded"
        ? "succeeded"
        : normalizedScenario === "cancelled"
          ? "cancelled"
          : "processing",
    wave_launch_url: lastAttempt.providerLaunchUrl || lastAttempt.checkoutUrl || null,
    when_completed:
      normalizedScenario === "succeeded" ? new Date().toISOString() : null,
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
  } catch (e) {
    return {
      ok: true,
      received: true,
      duplicate: true,
    };
  }

  try {
    const preorder = await resolvePreorderFromWebhookPayload(parsed);

    if (preorder) {
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