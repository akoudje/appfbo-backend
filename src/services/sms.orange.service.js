const axios = require("axios");

const { normalizeCI } = require("../utils/phone");

const DEFAULT_TOKEN_URL = "https://api.orange.com/oauth/v3/token";
const ORANGE_SMS_API_BASE_URL = "https://api.orange.com/smsmessaging/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SMS_LENGTH = 160;

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
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

function buildClientCorrelator() {
  return `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildOrangeSmsUrl(senderAddress) {
  return `${ORANGE_SMS_API_BASE_URL}/outbound/${encodeURIComponent(senderAddress)}/requests`;
}

function clampSmsContent(message = "") {
  return String(message || "").slice(0, MAX_SMS_LENGTH);
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

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId = requireEnv("ORANGE_CLIENT_ID");
  const clientSecret = requireEnv("ORANGE_CLIENT_SECRET");
  const tokenUrl = requireEnv("ORANGE_TOKEN_URL", DEFAULT_TOKEN_URL);
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        timeout: REQUEST_TIMEOUT_MS,
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

    tokenCache = {
      accessToken,
      expiresAt: Date.now() + ttlMs,
    };

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
}) {
  const target = normalizeCI(phone);
  if (!target) {
    throw new OrangeApiError("Numero de destination invalide pour la Cote d'Ivoire", {
      code: "INVALID_DESTINATION",
    });
  }

  const senderAddress = requireEnv("ORANGE_SENDER_ADDRESS");
  const senderNumber = requireEnv("ORANGE_SENDER_NUMBER");
  const accessToken = await getAccessToken();
  const normalizedMessage = clampSmsContent(message);

  try {
    const response = await axios.post(
      buildOrangeSmsUrl(senderAddress),
      {
        outboundSMSMessageRequest: {
          address: [`tel:${target}`],
          senderAddress,
          senderName: senderNumber,
          outboundSMSTextMessage: {
            message: normalizedMessage,
          },
          clientCorrelator,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    return {
      response,
      target,
      clientCorrelator,
    };
  } catch (error) {
    throw buildOrangeError(error, "Echec d'envoi du SMS via Orange");
  }
}

async function send(dest, communique) {
  const target = normalizeCI(dest?.contact1 || dest?.phone);
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

async function sendText({ phone, message, clientCorrelator }) {
  const { response } = await postOrangeSms({
    phone,
    message,
    clientCorrelator,
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
  send,
  sendText,
};
