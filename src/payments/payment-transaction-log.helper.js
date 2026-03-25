// backend/src/payments/payment-transaction-log.helper.js
// Helper centralisé pour journaliser les événements transactionnels de paiement.

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

async function addPaymentTransactionLogTx(
  tx,
  {
    preorderId = null,
    paymentId = null,
    paymentAttemptId = null,
    provider = null,
    eventType,
    source = "SYSTEM",
    status = null,
    attemptStatus = null,
    providerStatus = null,
    providerSessionId = null,
    providerTransactionId = null,
    providerPayerPhone = null,
    amountFcfa = null,
    currencyCode = null,
    note = null,
    payloadJson = null,
    actorAdminId = null,
  } = {},
) {
  try {
    if (!eventType) {
      console.warn(
        "[payment-transaction-log] skipped: missing eventType",
      );
      return null;
    }

    return await tx.paymentTransactionLog.create({
      data: {
        preorderId: preorderId || null,
        paymentId: paymentId || null,
        paymentAttemptId: paymentAttemptId || null,
        provider: provider || null,
        eventType,
        source,
        status: status || null,
        attemptStatus: attemptStatus || null,
        providerStatus: normalizeText(providerStatus),
        providerSessionId: normalizeText(providerSessionId),
        providerTransactionId: normalizeText(providerTransactionId),
        providerPayerPhone: normalizeText(providerPayerPhone),
        amountFcfa:
          Number.isFinite(Number(amountFcfa)) && amountFcfa !== null
            ? Number(amountFcfa)
            : null,
        currencyCode: normalizeText(currencyCode),
        note: normalizeText(note),
        payloadJson: payloadJson || undefined,
        actorAdminId: actorAdminId || null,
      },
    });
  } catch (error) {
    console.warn("[payment-transaction-log] skipped:", {
      preorderId: preorderId || null,
      paymentId: paymentId || null,
      paymentAttemptId: paymentAttemptId || null,
      eventType: eventType || null,
      source: source || null,
      message: error?.message || String(error),
    });
    return null;
  }
}

module.exports = {
  addPaymentTransactionLogTx,
};

