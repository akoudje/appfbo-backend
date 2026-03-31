// src/services/sms.service.js
// Couche de compatibilite pour les flux de precommande existants.

const axios = require("axios");

const { normalizeCI } = require("../utils/phone");
const {
  MAX_SMS_LENGTH,
  clampSmsContent,
  getAccessToken,
  sendText,
} = require("./sms.orange.service");

function normalizePhone(raw = "") {
  return normalizeCI(raw);
}

function buildPreorderSmsMessage({ preorder, totals }) {
  const number = preorder?.preorderNumber || "-";
  const customer = preorder?.fboNomComplet || "";
  const total = Number(totals?.totalFcfa ?? preorder?.totalFcfa ?? 0);
  const totalFmt = new Intl.NumberFormat("fr-FR").format(total);

  return [
    `Bonjour ${customer},`,
    `Votre précommande ${number} est bien enregistrée.`,
    `Montant indicatif actuel: ${totalFmt} FCFA.`,
    "Les prix affichés n'incluent pas les taxes.",
    "Le montant final de votre facture sera confirmé par le facturier selon les informations AS400.",
    "Nous vous contacterons pour la suite.",
  ].join(" ");
}

function orangeConfigured() {
  return Boolean(
    process.env.ORANGE_CLIENT_ID &&
      process.env.ORANGE_CLIENT_SECRET &&
      process.env.ORANGE_SENDER_ADDRESS &&
      process.env.ORANGE_SENDER_NUMBER,
  );
}

async function sendSms({ to, message, callbackData = null }) {
  const toAddress = normalizePhone(to);
  const normalizedMessage = clampSmsContent(message);

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

  if (!orangeConfigured()) {
    return {
      accepted: false,
      provider: "ORANGE",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "SMS_PROVIDER_NOT_CONFIGURED",
      errorMessage: "Provider SMS Orange non configuré.",
    };
  }

  try {
    console.log("[sms][orange] send requested", {
      to: `tel:${toAddress}`,
      senderAddress: process.env.ORANGE_SENDER_ADDRESS,
      messageLength: normalizedMessage.length,
      maxLength: MAX_SMS_LENGTH,
    });

    const smsResult = await sendText({
      phone: toAddress,
      message: normalizedMessage,
      clientCorrelator: callbackData
        ? `app_${Date.now()}_${String(callbackData).slice(0, 40)}`
        : undefined,
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

async function fetchSmsStatus({ resourceUrl }) {
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

  if (!orangeConfigured()) {
    return {
      ok: false,
      provider: "ORANGE",
      deliveryStatus: "unknown",
      providerStatus: null,
      error: "SMS_PROVIDER_NOT_CONFIGURED",
      raw: null,
    };
  }

  try {
    const token = await getAccessToken();
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
  sendSms,
  fetchSmsStatus,
  mapOrangeDeliveryStatus,
};
