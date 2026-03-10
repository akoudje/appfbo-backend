// src/services/cinetpay.service.js
const axios = require("axios");

const CINETPAY_URL = "https://api-checkout.cinetpay.com/v2/payment";
const CINETPAY_COUNTRY_ALPHA2_BY_ALPHA3 = {
  CIV: "CI",
  BFA: "BF",
  TGO: "TG",
  BEN: "BJ",
  NER: "NE",
};

function toCinetPayCountryCode(inputCode) {
  const normalized = String(inputCode || "").trim().toUpperCase();
  return CINETPAY_COUNTRY_ALPHA2_BY_ALPHA3[normalized] || normalized || "CI";
}

async function initCinetPayPayment({
  transactionId,
  amount,
  description,
  customerName,
  customerSurname,
  customerEmail,
  customerPhone,
  countryCode = "CIV",
  metadata = "",
}) {
  const cinetpayCountryCode = toCinetPayCountryCode(countryCode);

  const payload = {
    apikey: process.env.CINETPAY_APIKEY,
    site_id: process.env.CINETPAY_SITE_ID,
    transaction_id: transactionId,
    amount,
    currency: "XOF",
    description,
    notify_url: `${process.env.APP_BASE_URL}/api/payments/cinetpay/webhook`,
    return_url: `${process.env.ADMIN_RETURN_URL}/${transactionId}`,
    channels: "ALL",
    lang: "fr",

    customer_name: customerName || "Client",
    customer_surname: customerSurname || "FBO",
    customer_email: customerEmail || "no-reply@example.com",
    customer_phone_number: customerPhone || "+225000000000",
    customer_address: "N/A",
    customer_city: "N/A",
    customer_country: cinetpayCountryCode,
    customer_state: cinetpayCountryCode,
    customer_zip_code: "00000",

    metadata,
  };

  const { data } = await axios.post(`${CINETPAY_URL}`, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  if (data?.code !== "201" && data?.code !== 201) {
    throw new Error(data?.message || "CINETPAY_INIT_FAILED");
  }

  return {
    paymentUrl: data.data?.payment_url,
    paymentToken: data.data?.payment_token || null,
    raw: data,
  };
}

async function checkCinetPayPayment(transactionId) {
  const payload = {
    apikey: process.env.CINETPAY_APIKEY,
    site_id: process.env.CINETPAY_SITE_ID,
    transaction_id: transactionId,
  };

  const { data } = await axios.post(
    "https://api-checkout.cinetpay.com/v2/payment/check",
    payload,
    {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  return data;
}

module.exports = {
  initCinetPayPayment,
  checkCinetPayPayment,
};
