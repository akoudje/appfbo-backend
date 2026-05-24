// src/services/sms.service.js
// Couche de compatibilite pour les flux de precommande existants.

const axios = require("axios");

const { normalizeForCountry } = require("../utils/phone");
const {
  MAX_SMS_LENGTH,
  clampSmsContent,
  getAccessToken,
  getCountryOrangeConfig,
  sendText,
} = require("./sms.orange.service");

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveNotificationOrderRef(preorder = {}) {
  return compactText(
    preorder?.preorderNumber || preorder?.paymentCollectionCode || preorder?.id || "-",
  );
}

function prependNotificationPrefix(preorder = {}, message = "") {
  const normalized = compactText(message || "");
  const prefix = `FOREVER: ${resolveNotificationOrderRef(preorder)}.`;
  if (!normalized) return prefix;
  return compactText(`${prefix} ${normalized}`);
}

function normalizePhone(raw = "") {
  return normalizeForCountry(raw, "CIV");
}

function normalizePhoneForCountry(raw = "", countryCode = "CIV") {
  return normalizeForCountry(raw, countryCode);
}

function getOrangeEnvName(baseName, countryCode = "CIV") {
  const normalizedCountry = String(countryCode || "CIV").trim().toUpperCase();
  if (normalizedCountry === "CIV") return baseName;
  return `${baseName}_${normalizedCountry}`;
}

function buildPreorderSmsMessage({ preorder, totals }) {
  const total = Number(totals?.totalFcfa ?? preorder?.totalFcfa ?? 0);
  const totalFmt = new Intl.NumberFormat("fr-FR").format(total);
  const candidates = [
    `Précommande bien reçue. Nous préparons votre facture et revenons vers vous rapidement.`,
    `Précommande reçue. Facture en préparation.`,
    `Précommande reçue.`,
  ];

  for (const raw of candidates) {
    const text = prependNotificationPrefix(preorder, raw);
    if (text.length <= MAX_SMS_LENGTH) return text;
  }

  return prependNotificationPrefix(preorder, candidates[0]).slice(0, MAX_SMS_LENGTH);
}

function orangeConfigured(countryCode = "CIV") {
  const normalizedCountry = String(countryCode || "CIV").trim().toUpperCase();
  return Boolean(
    process.env[getOrangeEnvName("ORANGE_CLIENT_ID", normalizedCountry)] &&
      process.env[getOrangeEnvName("ORANGE_CLIENT_SECRET", normalizedCountry)] &&
      process.env[getOrangeEnvName("ORANGE_SENDER_ADDRESS", normalizedCountry)] &&
      process.env[getOrangeEnvName("ORANGE_SENDER_NUMBER", normalizedCountry)],
  );
}

function buildSafeClientCorrelator(callbackData = null) {
  if (!callbackData) return undefined;
  const safeData = String(callbackData || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 32);
  return `app${Date.now()}${safeData || "sms"}`.slice(0, 48);
}

async function sendSms({ to, message, callbackData = null, countryCode = "CIV" }) {
  const normalizedCountry = String(countryCode || "CIV").trim().toUpperCase();
  const toAddress = normalizePhoneForCountry(to, normalizedCountry);
  const normalizedMessage = clampSmsContent(message);
  const clientCorrelator = buildSafeClientCorrelator(callbackData);

  if (!toAddress) {
    return {
      accepted: false,
      provider: "ORANGE",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "INVALID_DESTINATION",
      errorMessage: "Numéro de destination SMS invalide.",
    };
  }

  if (!orangeConfigured(normalizedCountry)) {
    return {
      accepted: false,
      provider: "ORANGE",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "SMS_PROVIDER_NOT_CONFIGURED",
      errorMessage: `Provider SMS Orange non configuré pour ${normalizedCountry}.`,
    };
  }

  try {
    const orangeConfig = getCountryOrangeConfig(normalizedCountry);
    console.log("[sms][orange] send requested", {
      to: `tel:${toAddress}`,
      countryCode: normalizedCountry,
      senderAddress: orangeConfig.senderAddress,
      messageLength: normalizedMessage.length,
      maxLength: MAX_SMS_LENGTH,
      clientCorrelator: clientCorrelator || "(auto)",
    });

    const smsResult = await sendText({
      phone: toAddress,
      message: normalizedMessage,
      clientCorrelator,
      countryCode: normalizedCountry,
    });

    console.log("[sms][orange] send accepted", {
      to: `tel:${toAddress}`,
      providerMessageId: smsResult.trackingUrl,
    });

    return {
      accepted: true,
      provider: "ORANGE",
      providerMessageId: smsResult.trackingUrl,
      rawPayload: smsResult.raw,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    console.error("[sms][orange] send failed", {
      to: toAddress,
      errorCode:
        err?.data?.requestError?.serviceException?.messageId ||
        err?.response?.data?.requestError?.serviceException?.messageId ||
        err?.code ||
        "SMS_SEND_FAILED",
      errorMessage:
        err?.data?.requestError?.serviceException?.text ||
        err?.response?.data?.requestError?.serviceException?.text ||
        err?.data?.message ||
        err?.response?.data?.message ||
        err?.message ||
        "Échec d'envoi SMS",
      httpStatus: err?.status || err?.response?.status || null,
    });

    return {
      accepted: false,
      provider: "ORANGE",
      providerMessageId: null,
      rawPayload: err?.data || err?.response?.data || null,
      errorCode:
        err?.data?.requestError?.serviceException?.messageId ||
        err?.response?.data?.requestError?.serviceException?.messageId ||
        err?.code ||
        "SMS_SEND_FAILED",
      errorMessage:
        err?.data?.requestError?.serviceException?.text ||
        err?.response?.data?.requestError?.serviceException?.text ||
        err?.data?.message ||
        err?.response?.data?.message ||
        err?.message ||
        "Échec d'envoi SMS",
    };
  }
}

function mapOrangeDeliveryStatus(raw = "") {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";

  if (
    s.includes("deliveredtoterminal") ||
    s.includes("delivered") ||
    s.includes("successful")
  ) {
    return "delivered";
  }

  if (
    s.includes("failed") ||
    s.includes("rejected") ||
    s.includes("undeliverable") ||
    s.includes("expired")
  ) {
    return "failed";
  }

  if (
    s.includes("pending") ||
    s.includes("submitted") ||
    s.includes("sent") ||
    s.includes("accepted")
  ) {
    return "pending";
  }

  return "unknown";
}

async function fetchSmsStatus({ resourceUrl, countryCode = "CIV" }) {
  const normalizedCountry = String(countryCode || "CIV").trim().toUpperCase();
  if (!resourceUrl || typeof resourceUrl !== "string") {
    return {
      ok: false,
      provider: "ORANGE",
      deliveryStatus: "unknown",
      providerStatus: null,
      error: "RESOURCE_URL_MISSING",
      raw: null,
    };
  }

  if (!orangeConfigured(normalizedCountry)) {
    return {
      ok: false,
      provider: "ORANGE",
      deliveryStatus: "unknown",
      providerStatus: null,
      error: `SMS_PROVIDER_NOT_CONFIGURED_${normalizedCountry}`,
      raw: null,
    };
  }

  try {
    const token = await getAccessToken(normalizedCountry);
    const res = await axios.get(resourceUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const raw = res.data || {};
    const providerStatus =
      raw?.deliveryInfoList?.deliveryInfo?.[0]?.deliveryStatus ||
      raw?.outboundSMSMessageRequest?.deliveryInfoList?.deliveryInfo?.[0]
        ?.deliveryStatus ||
      raw?.deliveryStatus ||
      raw?.status ||
      null;

    return {
      ok: true,
      provider: "ORANGE",
      deliveryStatus: mapOrangeDeliveryStatus(providerStatus),
      providerStatus: providerStatus || null,
      error: null,
      raw,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "ORANGE",
      deliveryStatus: "unknown",
      providerStatus: null,
      error:
        err?.response?.data?.requestError?.serviceException?.text ||
        err?.response?.data?.message ||
        err?.message ||
        "SMS_STATUS_FETCH_FAILED",
      raw: err?.response?.data || null,
    };
  }
}

module.exports = {
  buildPreorderSmsMessage,
  normalizePhone,
  normalizePhoneForCountry,
  sendSms,
  fetchSmsStatus,
  mapOrangeDeliveryStatus,
};
