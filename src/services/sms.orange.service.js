const axios = require("axios");

const { normalizeForCountry } = require("../utils/phone");

const DEFAULT_TOKEN_URL = "https://api.orange.com/oauth/v3/token";
const ORANGE_SMS_API_BASE_URL = "https://api.orange.com/smsmessaging/v1";
const MAX_SMS_LENGTH = 160;

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRequestTimeoutMs() {
  return readPositiveInt(process.env.ORANGE_SMS_TIMEOUT_MS, 20_000);
}

let tokenCache = {
  byCountry: new Map(),
};

class OrangeApiError extends Error {
  constructor(message, { status = null, data = null, code = null } = {}) {
    super(message);
    this.name = "OrangeApiError";
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

function getEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requireEnv(name, fallback = "") {
  const value = getEnv(name, fallback);
  if (!value) {
    throw new OrangeApiError(`Variable d'environnement manquante: ${name}`, {
      code: "ORANGE_CONFIG_MISSING",
    });
  }
  return value;
}

function normalizeCountryCode(countryCode = "CIV") {
  return String(countryCode || "CIV").trim().toUpperCase();
}

function envNameForCountry(baseName, countryCode) {
  const normalized = normalizeCountryCode(countryCode);
  if (normalized === "CIV") return baseName;
  return `${baseName}_${normalized}`;
}

function getCountryOrangeConfig(countryCode = "CIV") {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const suffix = normalizedCountryCode === "CIV" ? "" : `_${normalizedCountryCode}`;
  const label = normalizedCountryCode === "CIV" ? "CIV" : normalizedCountryCode;

  const clientId = requireEnv(envNameForCountry("ORANGE_CLIENT_ID", normalizedCountryCode));
  const clientSecret = requireEnv(envNameForCountry("ORANGE_CLIENT_SECRET", normalizedCountryCode));
  const tokenUrl = requireEnv(
    envNameForCountry("ORANGE_TOKEN_URL", normalizedCountryCode),
    DEFAULT_TOKEN_URL,
  );
  const senderAddress = requireEnv(envNameForCountry("ORANGE_SENDER_ADDRESS", normalizedCountryCode));
  const senderNumber = requireEnv(envNameForCountry("ORANGE_SENDER_NUMBER", normalizedCountryCode));

  return {
    countryCode: normalizedCountryCode,
    label,
    suffix,
    clientId,
    clientSecret,
    tokenUrl,
    senderAddress,
    senderNumber,
  };
}

function buildClientCorrelator() {
  return `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildOrangeSmsUrl(senderAddress) {
  return `${ORANGE_SMS_API_BASE_URL}/outbound/${encodeURIComponent(senderAddress)}/requests`;
}

function smsContainsLink(message = "") {
  const text = String(message || "").trim().toLowerCase();
  return (
    text.includes("http://") ||
    text.includes("https://") ||
    text.includes("www.") ||
    text.includes("forevercivstore.com")
  );
}

function clampSmsContent(message = "") {
  const normalized = String(message || "");
  if (smsContainsLink(normalized)) {
    return normalized;
  }
  return normalized.slice(0, MAX_SMS_LENGTH);
}

function buildOrangeError(error, fallbackMessage) {
  if (!error || !error.response) {
    return new OrangeApiError(error?.message || fallbackMessage, {
      code: error?.code || "ORANGE_REQUEST_FAILED",
    });
  }

  const status = error.response.status;
  const data = error.response.data || null;

  return new OrangeApiError(
    `${fallbackMessage} (Orange HTTP ${status})`,
    {
      status,
      data,
      code: error.code || "ORANGE_HTTP_ERROR",
    },
  );
}

async function getAccessToken(countryCode = "CIV") {
  const config = getCountryOrangeConfig(countryCode);
  const cached = tokenCache.byCountry.get(config.countryCode);
  if (cached?.accessToken && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  try {
    const response = await axios.post(
      config.tokenUrl,
      new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        timeout: getRequestTimeoutMs(),
      },
    );

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      throw new OrangeApiError("Token Orange absent de la reponse OAuth2", {
        status: response.status,
        data: response.data || null,
        code: "ORANGE_TOKEN_MISSING",
      });
    }

    const expiresInSeconds = Number(response.data?.expires_in || 0);
    const ttlMs = Math.max((expiresInSeconds - 120) * 1000, 0);

    tokenCache.byCountry.set(config.countryCode, {
      accessToken,
      expiresAt: Date.now() + ttlMs,
    });

    return accessToken;
  } catch (error) {
    if (error instanceof OrangeApiError) {
      throw error;
    }

    throw buildOrangeError(error, "Echec de recuperation du token OAuth2 Orange");
  }
}

async function postOrangeSms({
  phone,
  message,
  clientCorrelator = buildClientCorrelator(),
  countryCode = "CIV",
  receiptNotifyUrl = null,
  callbackData = null,
}) {
  const config = getCountryOrangeConfig(countryCode);
  const target = normalizeForCountry(phone, config.countryCode);
  if (!target) {
    throw new OrangeApiError(`Numero de destination invalide pour ${config.label}`, {
      code: "INVALID_DESTINATION",
    });
  }

  const accessToken = await getAccessToken(config.countryCode);
  const normalizedMessage = clampSmsContent(message);
  const receiptRequest =
    receiptNotifyUrl && callbackData
      ? {
          notifyURL: String(receiptNotifyUrl),
          callbackData: String(callbackData),
        }
      : undefined;

  try {
    const response = await axios.post(
      buildOrangeSmsUrl(config.senderAddress),
      {
        outboundSMSMessageRequest: {
          address: [`tel:${target}`],
          senderAddress: config.senderAddress,
          senderName: config.senderNumber,
          outboundSMSTextMessage: {
            message: normalizedMessage,
          },
          clientCorrelator,
          ...(receiptRequest ? { receiptRequest } : {}),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: getRequestTimeoutMs(),
      },
    );

    return {
      response,
      target,
      clientCorrelator,
      countryCode: config.countryCode,
      senderAddress: config.senderAddress,
    };
  } catch (error) {
    throw buildOrangeError(error, "Echec d'envoi du SMS via Orange");
  }
}

async function send(dest, communique) {
  const countryCode = normalizeCountryCode(dest?.countryCode || "CIV");
  const target = normalizeForCountry(dest?.contact1 || dest?.phone, countryCode);
  if (!target) {
    throw new OrangeApiError("Numero de destination invalide", {
      code: "INVALID_DESTINATION",
    });
  }

  const titre = String(communique?.titre || "").trim();
  if (!titre) {
    throw new OrangeApiError("Le titre du communique est obligatoire", {
      code: "INVALID_MESSAGE",
    });
  }

  const message = `${titre}\n\n${communique?.contenu || ""}`;
  const { response, clientCorrelator } = await postOrangeSms({
    phone: target,
    message,
    countryCode,
  });

  return {
    success: true,
    trackingUrl: response.data?.outboundSMSMessageRequest?.resourceURL || null,
    messageId:
      response.data?.outboundSMSMessageRequest?.clientCorrelator ||
      clientCorrelator,
    message: `SMS envoye a ${target}`,
  };
}

async function sendText({
  phone,
  message,
  clientCorrelator,
  countryCode = "CIV",
  receiptNotifyUrl = null,
  callbackData = null,
}) {
  const { response } = await postOrangeSms({
    phone,
    message,
    clientCorrelator,
    countryCode,
    receiptNotifyUrl,
    callbackData,
  });

  return {
    success: true,
    trackingUrl: response.data?.outboundSMSMessageRequest?.resourceURL || null,
    messageId:
      response.data?.outboundSMSMessageRequest?.clientCorrelator ||
      clientCorrelator ||
      null,
    raw: response.data || null,
  };
}

module.exports = {
  MAX_SMS_LENGTH,
  clampSmsContent,
  OrangeApiError,
  getAccessToken,
  getCountryOrangeConfig,
  send,
  sendText,
};
