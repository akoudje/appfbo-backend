// src/payments/payments.service.js
// Service de gestion des paiements, incluant l'initiation de paiements via Wave, 
// la synchronisation de leur statut et le traitement des webhooks. 
// Ce service utilise Prisma pour interagir avec la base de données et un orchestrateur de paiement pour gérer les interactions 
// avec les fournisseurs de paiement.

// Service métier des paiements : création Payment / PaymentAttempt,
// synchro statut provider, mise à jour de Preorder, traitement webhook.

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

  const providerResponse = await paymentOrchestrator.createCheckoutSession("WAVE", {
    amountFcfa: preorder.totalFcfa,
    successUrl,
    errorUrl,
    clientReference: preorder.id,
    restrictPayerMobile,
  });

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
        data: {
          activePaymentId: payment.id,
        },
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
        },
      },
    });

    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        lastAttemptId: attempt.id,
      },
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
          take: 5,
        },
      },
    });

    await addLogTx(
      tx,
      preorder.id,
      "WAVE_PAYMENT_INITIATED",
      "Paiement Wave initié",
      {
        paymentId: updatedPayment.id,
        paymentAttemptId: attempt.id,
        provider: "WAVE",
        providerSessionId: providerResponse.providerSessionId,
        providerTransactionId: providerResponse.providerTransactionId,
        checkoutUrl: providerResponse.checkoutUrl,
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
    ...result,
    checkoutUrl: result.paymentAttempt.checkoutUrl,
  };
}

async function syncWavePaymentStatus({
  req,
  preorderId,
}) {
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
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let updatedAttempt = null;

    if (lastAttempt) {
      updatedAttempt = await tx.paymentAttempt.update({
        where: { id: lastAttempt.id },
        data: {
          status: mapped.attemptStatus,
          providerTransactionId:
            providerStatus.providerTransactionId ||
            lastAttempt.providerTransactionId,
          responsePayloadJson: providerStatus.raw,
          normalizedPayloadJson: {
            providerSessionId: providerStatus.providerSessionId,
            providerTransactionId: providerStatus.providerTransactionId,
            checkoutStatus: providerStatus.checkoutStatus,
            paymentStatus: providerStatus.paymentStatus,
            completedAt: providerStatus.completedAt,
          },
          completedAt: mapped.isFinal ? now : lastAttempt.completedAt,
          failureCode: mapped.markExpired
            ? "WAVE_EXPIRED"
            : mapped.markCancelled
              ? "WAVE_CANCELLED"
              : null,
          failureMessage: mapped.markExpired
            ? "Session Wave expirée"
            : mapped.markCancelled
              ? "Paiement Wave annulé"
              : null,
        },
      });
    }

    const paymentData = {
      status: mapped.paymentStatus,
      providerTxnId:
        providerStatus.providerTransactionId || payment.providerTxnId,
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
        providerStatus: providerStatus.raw,
      },
      req.user?.id || null
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
        req.user?.id || null
      );
    }

    return {
      payment: updatedPayment,
      paymentAttempt: updatedAttempt,
      preorder: updatedPreorder,
    };
  });

  return {
    ok: true,
    ...result,
    mapped,
    providerStatus: providerStatus.raw,
  };
}

async function handleWaveWebhook({ req }) {
  const parsed = await paymentOrchestrator.parseWebhook("WAVE", { req });

  let event = null;

  try {
    event = await prisma.paymentWebhookEvent.create({
      data: {
        provider: "WAVE",
        providerEventId: parsed.providerEventId || null,
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
    const possibleClientReference =
      parsed.body?.data?.client_reference ||
      parsed.body?.client_reference ||
      parsed.body?.checkout_session?.client_reference ||
      null;

    if (possibleClientReference) {
      const preorder = await prisma.preorder.findUnique({
        where: { id: possibleClientReference },
      });

      if (preorder) {
        await syncWavePaymentStatus({
          req: {
            ...req,
            countryId: preorder.countryId,
            country: { id: preorder.countryId },
          },
          preorderId: preorder.id,
        });
      }
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
  handleWaveWebhook,
};
