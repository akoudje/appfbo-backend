// backend/src/payments/payments.service.js
// Service de gestion des paiements, notamment l'intégration avec le provider Wave (Mobile Money).

const crypto = require("crypto");
const prisma = require("../prisma");
const paymentOrchestrator = require("./payment-orchestrator.service");
const { mapWaveSessionToInternal } = require("./payment-status.mapper");
const { scopeWhere, pickCountryId } = require("../helpers/countryScope");
const {
  addPaymentTransactionLogTx,
} = require("./payment-transaction-log.helper");

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

function mergeObjectLike(base, extra) {
  if (!base || typeof base !== "object") return extra;
  if (!extra || typeof extra !== "object") return base;
  return { ...base, ...extra };
}

function extractWaveProviderMetadata(raw = {}) {
  const providerSessionId =
    firstNonEmptyString(
      raw?.id,
      raw?.data?.id,
      raw?.checkout_session?.id,
      raw?.session?.id,
      raw?.providerSessionId,
      getNested(raw, ["payment", "checkout_session_id"]),
      getNested(raw, ["data", "payment", "checkout_session_id"]),
    ) || null;

  const providerTransactionId =
    firstNonEmptyString(
      raw?.transaction_id,
      raw?.data?.transaction_id,
      raw?.checkout_session?.transaction_id,
      raw?.session?.transaction_id,
      raw?.payment_id,
      raw?.data?.payment_id,
      raw?.providerTransactionId,
      raw?.payment?.id,
      raw?.data?.payment?.id,
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
      raw?.mobile,
      raw?.senderPhone,
      raw?.customer_phone,
      raw?.customerPhone,
      raw?.client_phone,
      raw?.clientPhone,
      raw?.phone,
      getNested(raw, ["payer", "phone_number"]),
      getNested(raw, ["payer", "phone"]),
      getNested(raw, ["client", "phone"]),
      getNested(raw, ["customer", "phone"]),
      getNested(raw, ["customer", "mobile"]),
      raw?.data?.payerPhone,
      raw?.data?.payer_phone,
      raw?.data?.customer_msisdn,
      raw?.data?.phone_number,
      raw?.data?.sender_phone,
      raw?.data?.customer_phone,
      getNested(raw, ["data", "payer", "phone_number"]),
      getNested(raw, ["data", "payer", "phone"]),
      getNested(raw, ["data", "client", "phone"]),
      getNested(raw, ["data", "customer", "phone"]),
      raw?.checkout_session?.payerPhone,
      raw?.checkout_session?.payer_phone,
      raw?.checkout_session?.customer_msisdn,
      raw?.checkout_session?.phone_number,
      raw?.checkout_session?.sender_phone,
      getNested(raw, ["checkout_session", "payer", "phone_number"]),
      getNested(raw, ["checkout_session", "payer", "phone"]),
      getNested(raw, ["checkout_session", "client", "phone"]),
      getNested(raw, ["session", "payer", "phone_number"]),
      getNested(raw, ["session", "payer", "phone"]),
      getNested(raw, ["session", "client", "phone"]),
      getNested(raw, ["payment_method", "phone_number"]),
      getNested(raw, ["payment_method", "payer_phone"]),
      getNested(raw, ["payment_method", "customer_msisdn"]),
      getNested(raw, ["payment_method", "sender_phone"]),
      getNested(raw, ["payment_method", "mobile"]),
      getNested(raw, ["data", "payment_method", "phone_number"]),
      getNested(raw, ["data", "payment_method", "payer_phone"]),
      getNested(raw, ["data", "payment_method", "customer_msisdn"]),
      getNested(raw, ["data", "payment_method", "sender_phone"]),
      getNested(raw, ["data", "payment_method", "mobile"]),
      getNested(raw, ["checkout_session", "payment_method", "phone_number"]),
      getNested(raw, ["checkout_session", "payment_method", "payer_phone"]),
      getNested(raw, ["checkout_session", "payment_method", "customer_msisdn"]),
      getNested(raw, ["checkout_session", "payment_method", "sender_phone"]),
      getNested(raw, ["session", "payment_method", "phone_number"]),
      getNested(raw, ["session", "payment_method", "payer_phone"]),
      getNested(raw, ["session", "payment_method", "customer_msisdn"]),
      getNested(raw, ["session", "payment_method", "sender_phone"]),
    ),
  );

  const providerStatusLabel =
    firstNonEmptyString(
      raw?.payment_status_label,
      raw?.checkout_status_label,
      raw?.status_label,
      raw?.status,
      raw?.data?.payment_status_label,
      raw?.data?.checkout_status_label,
      raw?.data?.status_label,
      raw?.data?.status,
      raw?.checkout_session?.payment_status_label,
      raw?.checkout_session?.checkout_status_label,
      raw?.checkout_session?.status_label,
      raw?.session?.payment_status_label,
      raw?.session?.checkout_status_label,
      raw?.session?.status_label,
      raw?.payment_status,
      raw?.checkout_status,
      raw?.data?.payment_status,
      raw?.data?.checkout_status,
      raw?.session?.payment_status,
      raw?.session?.checkout_status,
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
      raw?.session?.when_completed,
      raw?.session?.completed_at,
      raw?.session?.paid_at,
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

  const customFields =
    body?.data?.custom_fields ||
    body?.custom_fields ||
    body?.checkout_session?.custom_fields ||
    null;

  const clientReference =
    body?.data?.client_reference ||
    body?.client_reference ||
    body?.checkout_session?.client_reference ||
    customFields?.client_reference ||
    customFields?.clientReference ||
    null;

  if (clientReference) {
    const preorder = await prisma.preorder.findUnique({
      where: { id: clientReference },
    });
    if (preorder) return preorder;
  }

  const invoiceRefHint =
    customFields?.["numero-facture"] ||
    customFields?.numero_facture ||
    customFields?.invoice_ref ||
    customFields?.invoice_reference ||
    null;

  if (invoiceRefHint) {
    const preorderByInvoice = await prisma.preorder.findFirst({
      where: {
        OR: [
          { factureReference: String(invoiceRefHint).trim() },
          { preorderNumber: String(invoiceRefHint).trim() },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (preorderByInvoice) return preorderByInvoice;
  }

  const providerSessionId =
    body?.data?.checkout_session_id ||
    body?.checkout_session?.id ||
    body?.session?.id ||
    body?.id ||
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
    body?.data?.id ||
    body?.transaction_id ||
    body?.id ||
    body?.checkout_session?.transaction_id ||
    body?.session?.transaction_id ||
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

    const payment = await prisma.payment.findFirst({
      where: {
        provider: "WAVE",
        OR: [
          { providerTxnId: providerTransactionId },
          { providerReference: providerTransactionId },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (payment?.preorderId) {
      return prisma.preorder.findUnique({
        where: { id: payment.preorderId },
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

async function fetchWaveCheckoutDetails({
  preorderId,
  paymentId,
  paymentAttemptId,
  providerSessionId,
  providerTransactionId,
}) {
  const lookupSessionId = firstNonEmptyString(providerSessionId) || null;
  const lookupTransactionId =
    firstNonEmptyString(providerTransactionId) || null;

  if (!lookupSessionId && !lookupTransactionId) {
    console.log("[payments][wave] details enrichment skipped (missing ids)", {
      preorderId: preorderId || null,
      paymentId: paymentId || null,
      paymentAttemptId: paymentAttemptId || null,
    });
    return null;
  }

  console.log("[payments][wave] details enrichment start", {
    preorderId: preorderId || null,
    paymentId: paymentId || null,
    paymentAttemptId: paymentAttemptId || null,
    providerSessionId: lookupSessionId,
    providerTransactionId: lookupTransactionId,
  });

  try {
    const details = await paymentOrchestrator.getCheckoutSessionDetails("WAVE", {
      providerSessionId: lookupSessionId,
      providerTransactionId: lookupTransactionId,
    });
    const metadata = extractWaveProviderMetadata(details?.raw || {});

    console.log("[payments][wave] details enrichment success", {
      preorderId: preorderId || null,
      paymentId: paymentId || null,
      paymentAttemptId: paymentAttemptId || null,
      providerSessionId: metadata.providerSessionId || lookupSessionId || null,
      providerTransactionId:
        metadata.providerTransactionId || lookupTransactionId || null,
      payerPhoneFound: Boolean(metadata.providerPayerPhone),
      providerPayerPhone: metadata.providerPayerPhone || null,
    });

    return {
      raw: details?.raw || null,
      providerSessionId: metadata.providerSessionId || lookupSessionId || null,
      providerTransactionId:
        metadata.providerTransactionId || lookupTransactionId || null,
      providerPayerPhone: metadata.providerPayerPhone || null,
      providerStatusLabel: metadata.providerStatusLabel || null,
      completedAt: metadata.completedAt || null,
    };
  } catch (error) {
    console.warn("[payments][wave] details enrichment failed", {
      preorderId: preorderId || null,
      paymentId: paymentId || null,
      paymentAttemptId: paymentAttemptId || null,
      providerSessionId: lookupSessionId,
      providerTransactionId: lookupTransactionId,
      message: error?.message || String(error),
    });
    return null;
  }
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
    const existingNormalized = lastAttempt.normalizedPayloadJson || {};
    const resolvedProviderSessionId =
      metadata.providerSessionId ||
      lastAttempt.providerSessionId ||
      existingNormalized?.providerSessionId ||
      null;
    const resolvedProviderTransactionId =
      metadata.providerTransactionId ||
      lastAttempt.providerTransactionId ||
      existingNormalized?.providerTransactionId ||
      existingNormalized?.transactionId ||
      null;
    const resolvedProviderPayerPhone =
      lastAttempt.providerPayerPhone ||
      metadata.providerPayerPhone ||
      existingNormalized?.providerPayerPhone ||
      null;
    const resolvedProviderStatusLabel =
      metadata.providerStatusLabel ||
      lastAttempt.providerStatusLabel ||
      existingNormalized?.providerStatusLabel ||
      null;

    updatedAttempt = await tx.paymentAttempt.update({
      where: { id: lastAttempt.id },
      data: {
        status: mapped.attemptStatus,
        providerSessionId: resolvedProviderSessionId,
        providerTransactionId: resolvedProviderTransactionId,
        providerPayerPhone: resolvedProviderPayerPhone,
        providerStatusLabel: resolvedProviderStatusLabel,
        responsePayloadJson: providerStatusRaw,
        normalizedPayloadJson: {
          ...existingNormalized,
          checkoutStatus:
            providerStatusRaw?.checkout_status ||
            existingNormalized?.checkoutStatus ||
            null,
          paymentStatus:
            providerStatusRaw?.payment_status ||
            existingNormalized?.paymentStatus ||
            null,
          transactionId:
            resolvedProviderTransactionId ||
            providerStatusRaw?.transaction_id ||
            existingNormalized?.transactionId ||
            null,
          providerTransactionId: resolvedProviderTransactionId,
          providerSessionId: resolvedProviderSessionId,
          providerPayerPhone: resolvedProviderPayerPhone,
          providerStatusLabel: resolvedProviderStatusLabel,
          whenCompleted:
            metadata.completedAt ||
            providerStatusRaw?.when_completed ||
            existingNormalized?.whenCompleted ||
            null,
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
    preorderData.billingWorkStatus = "COMPLETED";
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

  const transactionLogSource =
    providerStatusRaw?.simulated === true ? "SIMULATION" : "SYNC";

  await addPaymentTransactionLogTx(tx, {
    preorderId: preorder.id,
    paymentId: updatedPayment.id,
    paymentAttemptId: updatedAttempt?.id || lastAttempt?.id || null,
    provider: "WAVE",
    eventType: "STATUS_SYNCED",
    source: transactionLogSource,
    status: mapped.paymentStatus,
    attemptStatus: mapped.attemptStatus,
    providerStatus:
      providerStatusRaw?.payment_status ||
      providerStatusRaw?.checkout_status ||
      metadata.providerStatusLabel ||
      null,
    providerSessionId:
      metadata.providerSessionId ||
      updatedAttempt?.providerSessionId ||
      payment.providerReference ||
      null,
    providerTransactionId:
      metadata.providerTransactionId ||
      updatedAttempt?.providerTransactionId ||
      payment.providerTxnId ||
      null,
    providerPayerPhone:
      updatedAttempt?.providerPayerPhone || metadata.providerPayerPhone || null,
    amountFcfa: payment.amountExpectedFcfa,
    currencyCode: payment.currencyCode,
    note: "Statut de paiement synchronisé et appliqué",
    payloadJson: {
      mapped,
      providerStatusRaw,
    },
    actorAdminId,
  });

  if (
    metadata.providerTransactionId ||
    updatedAttempt?.providerTransactionId ||
    payment.providerTxnId
  ) {
    await addPaymentTransactionLogTx(tx, {
      preorderId: preorder.id,
      paymentId: updatedPayment.id,
      paymentAttemptId: updatedAttempt?.id || lastAttempt?.id || null,
      provider: "WAVE",
      eventType: "TRANSACTION_CAPTURED",
      source: transactionLogSource,
      status: mapped.paymentStatus,
      attemptStatus: mapped.attemptStatus,
      providerStatus: metadata.providerStatusLabel || null,
      providerSessionId:
        metadata.providerSessionId ||
        updatedAttempt?.providerSessionId ||
        payment.providerReference ||
        null,
      providerTransactionId:
        metadata.providerTransactionId ||
        updatedAttempt?.providerTransactionId ||
        payment.providerTxnId ||
        null,
      amountFcfa: payment.amountExpectedFcfa,
      currencyCode: payment.currencyCode,
      note: "Identifiant transaction provider capturé",
      payloadJson: {
        providerStatusRaw,
      },
      actorAdminId,
    });
  }

  if (providerStatusRaw?._wave?.detailsPayload) {
    await addPaymentTransactionLogTx(tx, {
      preorderId: preorder.id,
      paymentId: updatedPayment.id,
      paymentAttemptId: updatedAttempt?.id || lastAttempt?.id || null,
      provider: "WAVE",
      eventType: "DETAILS_ENRICHED",
      source: "ENRICHMENT",
      status: mapped.paymentStatus,
      attemptStatus: mapped.attemptStatus,
      providerStatus: metadata.providerStatusLabel || null,
      providerSessionId:
        metadata.providerSessionId ||
        updatedAttempt?.providerSessionId ||
        payment.providerReference ||
        null,
      providerTransactionId:
        metadata.providerTransactionId ||
        updatedAttempt?.providerTransactionId ||
        payment.providerTxnId ||
        null,
      providerPayerPhone:
        updatedAttempt?.providerPayerPhone || metadata.providerPayerPhone || null,
      amountFcfa: payment.amountExpectedFcfa,
      currencyCode: payment.currencyCode,
      note: "Enrichissement provider détaillé appliqué",
      payloadJson: {
        detailsPayload: providerStatusRaw?._wave?.detailsPayload || null,
        statusPayload: providerStatusRaw?._wave?.statusPayload || null,
      },
      actorAdminId,
    });
  }

  if (updatedAttempt?.providerPayerPhone || metadata.providerPayerPhone) {
    await addPaymentTransactionLogTx(tx, {
      preorderId: preorder.id,
      paymentId: updatedPayment.id,
      paymentAttemptId: updatedAttempt?.id || lastAttempt?.id || null,
      provider: "WAVE",
      eventType: "PAYER_PHONE_CAPTURED",
      source: transactionLogSource,
      status: mapped.paymentStatus,
      attemptStatus: mapped.attemptStatus,
      providerStatus: metadata.providerStatusLabel || null,
      providerSessionId:
        metadata.providerSessionId ||
        updatedAttempt?.providerSessionId ||
        payment.providerReference ||
        null,
      providerTransactionId:
        metadata.providerTransactionId ||
        updatedAttempt?.providerTransactionId ||
        payment.providerTxnId ||
        null,
      providerPayerPhone:
        updatedAttempt?.providerPayerPhone || metadata.providerPayerPhone || null,
      amountFcfa: payment.amountExpectedFcfa,
      currencyCode: payment.currencyCode,
      note: "Numéro payeur capturé",
      payloadJson: {
        providerStatusRaw,
      },
      actorAdminId,
    });
  }

  let finalEventType = null;
  if (mapped.markOrderPaid) finalEventType = "PAYMENT_CONFIRMED";
  if (mapped.markExpired) finalEventType = "PAYMENT_EXPIRED";
  if (mapped.markCancelled) finalEventType = "PAYMENT_CANCELLED";
  if (mapped.markFailed) finalEventType = "PAYMENT_FAILED";

  if (finalEventType) {
    await addPaymentTransactionLogTx(tx, {
      preorderId: preorder.id,
      paymentId: updatedPayment.id,
      paymentAttemptId: updatedAttempt?.id || lastAttempt?.id || null,
      provider: "WAVE",
      eventType: finalEventType,
      source: transactionLogSource,
      status: mapped.paymentStatus,
      attemptStatus: mapped.attemptStatus,
      providerStatus: metadata.providerStatusLabel || null,
      providerSessionId:
        metadata.providerSessionId ||
        updatedAttempt?.providerSessionId ||
        payment.providerReference ||
        null,
      providerTransactionId:
        metadata.providerTransactionId ||
        updatedAttempt?.providerTransactionId ||
        payment.providerTxnId ||
        null,
      providerPayerPhone:
        updatedAttempt?.providerPayerPhone || metadata.providerPayerPhone || null,
      amountFcfa: payment.amountExpectedFcfa,
      currencyCode: payment.currencyCode,
      note:
        finalEventType === "PAYMENT_CONFIRMED"
          ? "Paiement confirmé"
          : finalEventType === "PAYMENT_EXPIRED"
            ? "Paiement expiré"
            : finalEventType === "PAYMENT_CANCELLED"
              ? "Paiement annulé"
              : "Paiement échoué",
      payloadJson: {
        mapped,
        providerStatusRaw,
      },
      actorAdminId,
    });
  }

  await addLogTx(
    tx,
    preorder.id,
    "PAYMENT_PENDING",
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
      "PAYMENT_CONFIRMED",
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

    const logSource = simulation ? "SIMULATION" : "INITIATE";

    await addPaymentTransactionLogTx(tx, {
      preorderId: preorder.id,
      paymentId: updatedPayment.id,
      paymentAttemptId: attempt.id,
      provider: "WAVE",
      eventType: "PAYMENT_INITIATED",
      source: logSource,
      status: updatedPayment.status,
      attemptStatus: attempt.status,
      providerStatus:
        attempt.providerStatusLabel ||
        providerResponse.paymentStatus ||
        providerResponse.checkoutStatus ||
        null,
      providerSessionId: attempt.providerSessionId || null,
      providerTransactionId: attempt.providerTransactionId || null,
      providerPayerPhone: attempt.providerPayerPhone || null,
      amountFcfa: updatedPayment.amountExpectedFcfa,
      currencyCode: updatedPayment.currencyCode,
      note: simulation
        ? "Paiement Wave initié en mode simulation"
        : "Paiement Wave initié",
      payloadJson: {
        providerRequest: attempt.requestPayloadJson || null,
        providerResponse: providerResponse.raw || null,
      },
      actorAdminId: req.user?.id || null,
    });

    await addPaymentTransactionLogTx(tx, {
      preorderId: preorder.id,
      paymentId: updatedPayment.id,
      paymentAttemptId: attempt.id,
      provider: "WAVE",
      eventType: "PROVIDER_SESSION_CREATED",
      source: logSource,
      status: updatedPayment.status,
      attemptStatus: attempt.status,
      providerStatus: attempt.providerStatusLabel || null,
      providerSessionId: attempt.providerSessionId || null,
      providerTransactionId: attempt.providerTransactionId || null,
      providerPayerPhone: attempt.providerPayerPhone || null,
      amountFcfa: updatedPayment.amountExpectedFcfa,
      currencyCode: updatedPayment.currencyCode,
      note: "Session provider Wave créée",
      payloadJson: {
        responsePayload: providerResponse.raw || null,
        normalizedPayload: attempt.normalizedPayloadJson || null,
      },
      actorAdminId: req.user?.id || null,
    });

    if (attempt.checkoutUrl || attempt.providerLaunchUrl) {
      await addPaymentTransactionLogTx(tx, {
        preorderId: preorder.id,
        paymentId: updatedPayment.id,
        paymentAttemptId: attempt.id,
        provider: "WAVE",
        eventType: "CHECKOUT_LINK_READY",
        source: logSource,
        status: updatedPayment.status,
        attemptStatus: attempt.status,
        providerStatus: attempt.providerStatusLabel || null,
        providerSessionId: attempt.providerSessionId || null,
        providerTransactionId: attempt.providerTransactionId || null,
        providerPayerPhone: attempt.providerPayerPhone || null,
        amountFcfa: updatedPayment.amountExpectedFcfa,
        currencyCode: updatedPayment.currencyCode,
        note: "Lien checkout Wave généré",
        payloadJson: {
          checkoutUrl: attempt.checkoutUrl || null,
          providerLaunchUrl: attempt.providerLaunchUrl || null,
        },
        actorAdminId: req.user?.id || null,
      });
    }

    await addLogTx(
      tx,
      preorder.id,
      "GENERATE_PAYMENT",
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

  await addPaymentTransactionLogTx(prisma, {
    preorderId: preorder.id,
    paymentId: payment.id,
    paymentAttemptId: lastAttempt?.id || null,
    provider: "WAVE",
    eventType: "STATUS_SYNCED",
    source: "SYNC",
    status: payment.status,
    attemptStatus: lastAttempt?.status || null,
    providerStatus: "sync_requested",
    providerSessionId:
      lastAttempt?.providerSessionId || payment.providerReference || null,
    providerTransactionId:
      lastAttempt?.providerTransactionId || payment.providerTxnId || null,
    providerPayerPhone: lastAttempt?.providerPayerPhone || null,
    amountFcfa: payment.amountExpectedFcfa,
    currencyCode: payment.currencyCode,
    note: "Synchronisation statut Wave déclenchée",
    payloadJson: {
      simulated: isSimulatedAttempt(lastAttempt, payment),
    },
    actorAdminId: req.user?.id || null,
  });

  let providerStatus;
  let providerDetails = null;

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
  let providerStatusRawForPersist = providerStatus.raw;
  const syncMetadata = extractWaveProviderMetadata(providerStatus.raw || {});

  await addPaymentTransactionLogTx(prisma, {
    preorderId: preorder.id,
    paymentId: payment.id,
    paymentAttemptId: lastAttempt?.id || null,
    provider: "WAVE",
    eventType: "STATUS_SYNCED",
    source: providerStatus.raw?.simulated ? "SIMULATION" : "SYNC",
    status: mapped.paymentStatus,
    attemptStatus: mapped.attemptStatus,
    providerStatus:
      providerStatus.raw?.payment_status ||
      providerStatus.raw?.checkout_status ||
      null,
    providerSessionId:
      syncMetadata.providerSessionId ||
      lastAttempt?.providerSessionId ||
      payment.providerReference ||
      null,
    providerTransactionId:
      syncMetadata.providerTransactionId ||
      lastAttempt?.providerTransactionId ||
      payment.providerTxnId ||
      null,
    providerPayerPhone:
      syncMetadata.providerPayerPhone ||
      lastAttempt?.providerPayerPhone ||
      null,
    amountFcfa: payment.amountExpectedFcfa,
    currencyCode: payment.currencyCode,
    note: "Statut provider reçu depuis Wave",
    payloadJson: {
      providerStatus: providerStatus.raw,
      mapped,
    },
    actorAdminId: req.user?.id || null,
  });

  if (!providerStatus.raw?.simulated && mapped.isFinal) {
    const initialMetadata = syncMetadata;
    providerDetails = await fetchWaveCheckoutDetails({
      preorderId: preorder.id,
      paymentId: payment.id,
      paymentAttemptId: lastAttempt?.id || null,
      providerSessionId:
        initialMetadata.providerSessionId ||
        providerSessionId ||
        lastAttempt?.providerSessionId ||
        payment.providerReference ||
        null,
      providerTransactionId:
        initialMetadata.providerTransactionId ||
        lastAttempt?.providerTransactionId ||
        payment.providerTxnId ||
        null,
    });

    if (providerDetails?.raw) {
      await addPaymentTransactionLogTx(prisma, {
        preorderId: preorder.id,
        paymentId: payment.id,
        paymentAttemptId: lastAttempt?.id || null,
        provider: "WAVE",
        eventType: "DETAILS_ENRICHED",
        source: "ENRICHMENT",
        status: mapped.paymentStatus,
        attemptStatus: mapped.attemptStatus,
        providerStatus:
          providerDetails.providerStatusLabel ||
          providerStatus.raw?.payment_status ||
          providerStatus.raw?.checkout_status ||
          null,
        providerSessionId:
          providerDetails.providerSessionId ||
          initialMetadata.providerSessionId ||
          null,
        providerTransactionId:
          providerDetails.providerTransactionId ||
          initialMetadata.providerTransactionId ||
          null,
        providerPayerPhone: providerDetails.providerPayerPhone || null,
        amountFcfa: payment.amountExpectedFcfa,
        currencyCode: payment.currencyCode,
        note: "Payload provider détaillé récupéré et prêt à persister",
        payloadJson: {
          details: providerDetails.raw,
        },
        actorAdminId: req.user?.id || null,
      });

      providerStatusRawForPersist = mergeObjectLike(
        providerStatus.raw,
        providerDetails.raw,
      );
      providerStatusRawForPersist = {
        ...providerStatusRawForPersist,
        _wave: {
          statusPayload: providerStatus.raw,
          detailsPayload: providerDetails.raw,
          detailsFetchedAt: new Date().toISOString(),
        },
      };

      console.log("[payments][wave] details payload attached to provider status", {
        preorderId: preorder.id,
        paymentId: payment.id,
        paymentAttemptId: lastAttempt?.id || null,
        providerSessionId:
          providerDetails.providerSessionId ||
          initialMetadata.providerSessionId ||
          null,
        providerTransactionId:
          providerDetails.providerTransactionId ||
          initialMetadata.providerTransactionId ||
          null,
        providerPayerPhone: providerDetails.providerPayerPhone || null,
      });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    return applyWaveMappedStateTx({
      tx,
      preorder,
      payment,
      lastAttempt,
      providerStatusRaw: providerStatusRawForPersist,
      mapped,
      actorAdminId: req.user?.id || null,
    });
  });

  return {
    ok: true,
    simulated: providerStatus.raw?.simulated === true,
    ...result,
    mapped,
    providerStatus: providerStatusRawForPersist,
    providerDetails,
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

  await addPaymentTransactionLogTx(prisma, {
    preorderId: preorder.id,
    paymentId: payment.id,
    paymentAttemptId: lastAttempt.id,
    provider: "WAVE",
    eventType: "SIMULATION_TRIGGERED",
    source: "SIMULATION",
    status: payment.status,
    attemptStatus: lastAttempt.status,
    providerStatus: normalizedScenario,
    providerSessionId: fakeSession.id || null,
    providerTransactionId: fakeSession.transaction_id || null,
    providerPayerPhone: fakeSession.payer_phone || null,
    amountFcfa: payment.amountExpectedFcfa,
    currencyCode: payment.currencyCode,
    note: "Simulation Wave déclenchée",
    payloadJson: {
      scenario: normalizedScenario,
      providerStatus: fakeSession,
    },
    actorAdminId: req.user?.id || null,
  });

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

  await addPaymentTransactionLogTx(prisma, {
    preorderId: preorder.id,
    paymentId: payment.id,
    paymentAttemptId: lastAttempt.id,
    provider: "WAVE",
    eventType: "SIMULATION_RESULT_APPLIED",
    source: "SIMULATION",
    status: mapped.paymentStatus,
    attemptStatus: mapped.attemptStatus,
    providerStatus:
      fakeSession.payment_status || fakeSession.checkout_status || null,
    providerSessionId: fakeSession.id || null,
    providerTransactionId: fakeSession.transaction_id || null,
    providerPayerPhone: fakeSession.payer_phone || null,
    amountFcfa: payment.amountExpectedFcfa,
    currencyCode: payment.currencyCode,
    note: "Simulation Wave appliquée au paiement",
    payloadJson: {
      scenario: normalizedScenario,
      mapped,
      providerStatus: fakeSession,
    },
    actorAdminId: req.user?.id || null,
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
  const webhookPreorderHint =
    parsed.body?.data?.client_reference ||
    parsed.body?.client_reference ||
    parsed.body?.checkout_session?.client_reference ||
    null;

  console.log("[payments][wave] webhook parsed", {
    providerEventId: parsed.providerEventId || null,
    syntheticEventId,
    eventType: parsed.eventType || null,
    signatureValid: Boolean(parsed.signatureValid),
    signatureMode: parsed.signatureMode || null,
    signatureReason: parsed.signatureReason || null,
  });
  console.log("[wave webhook payload]", JSON.stringify(parsed.body, null, 2));

  await addPaymentTransactionLogTx(prisma, {
    preorderId: null,
    provider: "WAVE",
    eventType: "WEBHOOK_RECEIVED",
    source: "WEBHOOK",
    providerStatus: parsed.eventType || null,
    providerSessionId:
      parsed.body?.data?.id ||
      parsed.body?.id ||
      parsed.body?.checkout_session?.id ||
      null,
    providerTransactionId:
      parsed.body?.data?.transaction_id ||
      parsed.body?.transaction_id ||
      parsed.body?.checkout_session?.transaction_id ||
      null,
    note: "Webhook Wave reçu",
    payloadJson: {
      providerEventId: parsed.providerEventId || null,
      syntheticEventId,
      eventType: parsed.eventType || null,
      signatureValid: Boolean(parsed.signatureValid),
      signatureMode: parsed.signatureMode || null,
      signatureReason: parsed.signatureReason || null,
      body: parsed.body || null,
      headers: parsed.headers || null,
      preorderHint: webhookPreorderHint,
    },
    actorAdminId: null,
  });

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
    console.warn("[payments][wave] duplicate webhook event ignored", {
      providerEventId: parsed.providerEventId || null,
      syntheticEventId,
      eventType: parsed.eventType || null,
    });
    return {
      ok: true,
      received: true,
      duplicate: true,
    };
  }

  try {
    if (!parsed.signatureValid) {
      console.warn("[payments][wave] invalid webhook signature", {
        providerEventId: parsed.providerEventId || null,
        syntheticEventId,
        eventType: parsed.eventType || null,
        signatureMode: parsed.signatureMode || null,
        signatureReason: parsed.signatureReason || null,
      });

      await addPaymentTransactionLogTx(prisma, {
        preorderId: null,
        provider: "WAVE",
        eventType: "WEBHOOK_INVALID_SIGNATURE",
        source: "WEBHOOK",
        providerStatus: parsed.eventType || null,
        providerSessionId:
          parsed.body?.data?.id ||
          parsed.body?.id ||
          parsed.body?.checkout_session?.id ||
          null,
        providerTransactionId:
          parsed.body?.data?.transaction_id ||
          parsed.body?.transaction_id ||
          parsed.body?.checkout_session?.transaction_id ||
          null,
        note: parsed.signatureReason || "Signature webhook Wave invalide",
        payloadJson: {
          providerEventId: parsed.providerEventId || null,
          syntheticEventId,
          eventType: parsed.eventType || null,
          signatureMode: parsed.signatureMode || null,
          signatureReason: parsed.signatureReason || null,
          preorderHint: webhookPreorderHint,
        },
      });

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
      console.log("[payments][wave] preorder resolved from webhook", {
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

      await addPaymentTransactionLogTx(prisma, {
        preorderId: preorder.id,
        provider: "WAVE",
        eventType: "WEBHOOK_PROCESSED",
        source: "WEBHOOK",
        providerStatus: parsed.eventType || null,
        providerSessionId:
          parsed.body?.data?.id ||
          parsed.body?.id ||
          parsed.body?.checkout_session?.id ||
          null,
        providerTransactionId:
          parsed.body?.data?.transaction_id ||
          parsed.body?.transaction_id ||
          parsed.body?.checkout_session?.transaction_id ||
          null,
        note: "Webhook Wave traité et synchronisation lancée",
        payloadJson: {
          providerEventId: parsed.providerEventId || null,
          syntheticEventId,
          eventType: parsed.eventType || null,
        },
      });
    } else {
      console.info("[payments][wave] webhook ignored (preorder unresolved)", {
        providerEventId: parsed.providerEventId || null,
        syntheticEventId,
        eventType: parsed.eventType || null,
        hint:
          parsed.body?.data?.client_reference ||
          parsed.body?.client_reference ||
          parsed.body?.checkout_session?.client_reference ||
          parsed.body?.data?.custom_fields?.["numero-facture"] ||
          null,
      });

      await addPaymentTransactionLogTx(prisma, {
        preorderId: null,
        provider: "WAVE",
        eventType: "WEBHOOK_PREORDER_UNRESOLVED",
        source: "WEBHOOK",
        providerStatus: parsed.eventType || null,
        providerSessionId:
          parsed.body?.data?.id ||
          parsed.body?.id ||
          parsed.body?.checkout_session?.id ||
          null,
        providerTransactionId:
          parsed.body?.data?.transaction_id ||
          parsed.body?.transaction_id ||
          parsed.body?.checkout_session?.transaction_id ||
          null,
        note: "Webhook reçu mais précommande non résolue",
        payloadJson: {
          providerEventId: parsed.providerEventId || null,
          syntheticEventId,
          eventType: parsed.eventType || null,
          preorderHint: webhookPreorderHint,
        },
      });
    }

    await prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: "PROCESSED",
        processedAt: new Date(),
      },
    });
    console.log("[payments][wave] webhook event marked PROCESSED", {
      eventId: event.id,
      providerEventId: parsed.providerEventId || null,
      syntheticEventId,
      eventType: parsed.eventType || null,
    });

    return {
      ok: true,
      received: true,
      processed: true,
    };
  } catch (e) {
    console.error("[payments][wave] webhook processing error", {
      eventId: event?.id || null,
      providerEventId: parsed.providerEventId || null,
      syntheticEventId,
      eventType: parsed.eventType || null,
      message: e?.message || String(e),
    });

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

async function listPaymentTransactionLogs({ req, preorderId, take = 200 }) {
  const preorder = await prisma.preorder.findFirst({
    where: scopeWhere(req, { id: preorderId }),
    select: { id: true },
  });

  if (!preorder) {
    const err = new Error("Commande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const normalizedTake = Math.max(1, Math.min(500, Number(take) || 200));

  const data = await prisma.paymentTransactionLog.findMany({
    where: { preorderId: preorder.id },
    include: {
      actorAdmin: {
        select: { id: true, fullName: true, email: true, role: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: normalizedTake,
  });

  return {
    ok: true,
    preorderId: preorder.id,
    count: data.length,
    data,
  };
}

module.exports = {
  initiateWavePayment,
  syncWavePaymentStatus,
  simulateWaveStatus,
  handleWaveWebhook,
  listPaymentTransactionLogs,
};
