// src/services/paydunya.service.js

const axios = require("axios");

function getBaseUrl() {
  const mode = String(process.env.PAYDUNYA_MODE || "test").toLowerCase();
  return mode === "live" || mode === "prod" || mode === "production"
    ? "https://app.paydunya.com/api/v1"
    : "https://app.paydunya.com/sandbox-api/v1";
}

function getHeaders() {
  return {
    "Content-Type": "application/json",
    "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY,
    "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY,
    "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN,
  };
}

function assertEnv() {
  const missing = [
    "PAYDUNYA_MASTER_KEY",
    "PAYDUNYA_PRIVATE_KEY",
    "PAYDUNYA_TOKEN",
    "APP_BASE_URL",
    "ADMIN_URL",
  ].filter((k) => !process.env[k]);

  if (missing.length) {
    throw new Error(`PAYDUNYA_ENV_MISSING: ${missing.join(", ")}`);
  }
}

async function createPaydunyaPayment({
  orderId,
  amount,
  description,
  customerName,
  customerPhone,
  customerEmail,
  customData,
}) {
  assertEnv();

  const baseUrl = getBaseUrl();

  const payload = {
    invoice: {
      total_amount: Number(amount),
      description: String(description || `Précommande ${orderId}`),
    },

    store: {
      name: "FOREVER PRECOMMANDE",
    },

    actions: {
      callback_url: `${process.env.APP_BASE_URL}/api/payments/paydunya/webhook`,
      return_url: `${process.env.ADMIN_URL}/orders/${orderId}`,
      cancel_url: `${process.env.ADMIN_URL}/orders/${orderId}`,
    },

    custom_data: {
      preorderId: orderId,
      ...(customData || {}),
    },
  };

  if (customerName || customerPhone || customerEmail) {
    payload.customer = {
      name: customerName || "Client",
      phone: customerPhone || undefined,
      email: customerEmail || undefined,
    };
  }

  const { data } = await axios.post(
    `${baseUrl}/checkout-invoice/create`,
    payload,
    {
      headers: getHeaders(),
      timeout: 15000,
    }
  );

  if (String(data?.response_code) !== "00") {
    throw new Error(data?.response_text || "PAYDUNYA_CREATE_FAILED");
  }

  return {
    paymentUrl: data.response_text,
    token: data.token,
    raw: data,
  };
}

// Vérification par token
async function confirmPaydunyaPayment(token) {
  assertEnv();

  const baseUrl = getBaseUrl();

  const { data } = await axios.get(
    `${baseUrl}/checkout-invoice/confirm/${encodeURIComponent(String(token))}`,
    {
      headers: getHeaders(),
      timeout: 15000,
    }
  );

  // On retourne un format simplifié + la réponse brute
  return {
    status: data?.status || data?.response_text || "unknown",
    data,
  };
}

module.exports = {
  createPaydunyaPayment,
  confirmPaydunyaPayment,
};