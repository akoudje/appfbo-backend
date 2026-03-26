const axios = require("axios");

const DEFAULT_TOKEN_URL = "https://api.orange.com/oauth/v3/token";

function digitsOnly(v = "") {
  return String(v || "").replace(/\D/g, "");
}

function normalizePhone(raw = "") {
  const d = digitsOnly(raw);
  if (!d) return "";

  if (d.startsWith("225") && d.length >= 11) {
    return `+${d}`;
  }

  if (d.startsWith("0") && d.length === 10) {
    return `+225${d}`;
  }

  if (d.length === 10) {
    return `+225${d}`;
  }

  if (d.startsWith("00") && d.length > 4) {
    return `+${d.slice(2)}`;
  }

  return `+${d}`;
}

function toOrangeAddress(phone = "") {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  return `tel:${normalized}`;
}

function buildPreorderSmsMessage({ preorder, totals }) {
  const number = preorder?.preorderNumber || "-";
  const customer = preorder?.fboNomComplet || "";
  const total = Number(totals?.totalFcfa ?? preorder?.totalFcfa ?? 0);
  const totalFmt = new Intl.NumberFormat("fr-FR").format(total);

  return [
    `Bonjour ${customer},`,
    `Votre précommande ${number} est bien enregistrée.`,
    `Montant estimé: ${totalFmt} FCFA.`,
    "Nous vous contacterons pour la suite.",
  ].join(" ");
}

function orangeConfigured() {
  return Boolean(
    process.env.ORANGE_CLIENT_ID &&
      process.env.ORANGE_CLIENT_SECRET &&
      process.env.ORANGE_SENDER_ADDRESS,
  );
}

async function getOrangeAccessToken() {
  const tokenUrl = process.env.ORANGE_TOKEN_URL || DEFAULT_TOKEN_URL;
  const clientId = process.env.ORANGE_CLIENT_ID;
  const clientSecret = process.env.ORANGE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("ORANGE_CREDENTIALS_MISSING");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await axios.post(tokenUrl, "grant_type=client_credentials", {
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    timeout: 15000,
  });

  const accessToken = res.data?.access_token;
  if (!accessToken) {
    throw new Error("ORANGE_TOKEN_MISSING");
  }

  return accessToken;
}

async function sendSms({ to, message }) {
  const toAddress = toOrangeAddress(to);
  const senderAddress = process.env.ORANGE_SENDER_ADDRESS;

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
    const token = await getOrangeAccessToken();
    const outboundPath = encodeURIComponent(senderAddress);
    const url = `https://api.orange.com/smsmessaging/v1/outbound/${outboundPath}/requests`;

    const payload = {
      outboundSMSMessageRequest: {
        address: toAddress,
        senderAddress,
        outboundSMSTextMessage: {
          message: String(message || "").slice(0, 600),
        },
      },
    };

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 20000,
    });

    const providerMessageId =
      res.data?.outboundSMSMessageRequest?.resourceURL ||
      res.data?.resourceURL ||
      null;

    return {
      accepted: true,
      provider: "ORANGE",
      providerMessageId,
      rawPayload: res.data || null,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    return {
      accepted: false,
      provider: "ORANGE",
      providerMessageId: null,
      rawPayload: err?.response?.data || null,
      errorCode:
        err?.response?.data?.requestError?.serviceException?.messageId ||
        err?.code ||
        "SMS_SEND_FAILED",
      errorMessage:
        err?.response?.data?.requestError?.serviceException?.text ||
        err?.response?.data?.message ||
        err?.message ||
        "Échec d'envoi SMS",
    };
  }
}

module.exports = {
  buildPreorderSmsMessage,
  normalizePhone,
  sendSms,
};
