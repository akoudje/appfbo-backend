function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function getNested(source, path) {
  return path.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
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
      getNested(raw, ["payment_method", "phone_number"]),
      getNested(raw, ["payment_method", "payer_phone"]),
      getNested(raw, ["payment_method", "customer_msisdn"]),
      getNested(raw, ["payment_method", "sender_phone"]),
      getNested(raw, ["payment_method", "mobile"]),
      getNested(raw, ["data", "payerPhone"]),
      getNested(raw, ["data", "payer_phone"]),
      getNested(raw, ["data", "customer_msisdn"]),
      getNested(raw, ["data", "phone_number"]),
      getNested(raw, ["data", "sender_phone"]),
      getNested(raw, ["data", "customer_phone"]),
      getNested(raw, ["data", "payer", "phone_number"]),
      getNested(raw, ["data", "payer", "phone"]),
      getNested(raw, ["data", "client", "phone"]),
      getNested(raw, ["data", "customer", "phone"]),
      getNested(raw, ["data", "payment_method", "phone_number"]),
      getNested(raw, ["data", "payment_method", "payer_phone"]),
      getNested(raw, ["data", "payment_method", "customer_msisdn"]),
      getNested(raw, ["data", "payment_method", "sender_phone"]),
      getNested(raw, ["data", "payment_method", "mobile"]),
      getNested(raw, ["checkout_session", "payerPhone"]),
      getNested(raw, ["checkout_session", "payer_phone"]),
      getNested(raw, ["checkout_session", "customer_msisdn"]),
      getNested(raw, ["checkout_session", "phone_number"]),
      getNested(raw, ["checkout_session", "sender_phone"]),
      getNested(raw, ["checkout_session", "payer", "phone_number"]),
      getNested(raw, ["checkout_session", "payer", "phone"]),
      getNested(raw, ["checkout_session", "client", "phone"]),
      getNested(raw, ["checkout_session", "payment_method", "phone_number"]),
      getNested(raw, ["checkout_session", "payment_method", "payer_phone"]),
      getNested(raw, ["checkout_session", "payment_method", "customer_msisdn"]),
      getNested(raw, ["checkout_session", "payment_method", "sender_phone"]),
      getNested(raw, ["session", "payer", "phone_number"]),
      getNested(raw, ["session", "payer", "phone"]),
      getNested(raw, ["session", "client", "phone"]),
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
      raw?.payment_status,
      raw?.checkout_status,
      getNested(raw, ["data", "payment_status_label"]),
      getNested(raw, ["data", "checkout_status_label"]),
      getNested(raw, ["data", "status_label"]),
      getNested(raw, ["data", "status"]),
      getNested(raw, ["data", "payment_status"]),
      getNested(raw, ["data", "checkout_status"]),
      getNested(raw, ["checkout_session", "payment_status_label"]),
      getNested(raw, ["checkout_session", "checkout_status_label"]),
      getNested(raw, ["checkout_session", "status_label"]),
      getNested(raw, ["checkout_session", "payment_status"]),
      getNested(raw, ["checkout_session", "checkout_status"]),
      getNested(raw, ["session", "payment_status_label"]),
      getNested(raw, ["session", "checkout_status_label"]),
      getNested(raw, ["session", "status_label"]),
      getNested(raw, ["session", "payment_status"]),
      getNested(raw, ["session", "checkout_status"]),
    ) || null;

  const completedAt =
    firstNonEmptyString(
      raw?.when_completed,
      raw?.completed_at,
      raw?.paid_at,
      getNested(raw, ["data", "when_completed"]),
      getNested(raw, ["data", "completed_at"]),
      getNested(raw, ["data", "paid_at"]),
      getNested(raw, ["checkout_session", "when_completed"]),
      getNested(raw, ["checkout_session", "completed_at"]),
      getNested(raw, ["checkout_session", "paid_at"]),
      getNested(raw, ["session", "when_completed"]),
      getNested(raw, ["session", "completed_at"]),
      getNested(raw, ["session", "paid_at"]),
    ) || null;

  return {
    providerSessionId,
    providerTransactionId,
    providerPayerPhone,
    providerStatusLabel,
    completedAt,
  };
}

module.exports = {
  extractWaveProviderMetadata,
  firstNonEmptyString,
  getNested,
  normalizePhone,
};
