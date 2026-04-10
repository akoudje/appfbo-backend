const MOBILE_MONEY_SERVICE_FEE_RATES = {
  WAVE: 1,
  ORANGE_MONEY: 0,
  BANK_TRANSFER: 0,
};

function normalizePaymentMode(value) {
  return String(value || "").trim().toUpperCase();
}

function resolvePaymentModeForPricing(input = {}) {
  const directMode = normalizePaymentMode(input.preorderPaymentMode);
  if (directMode) return directMode;

  const fallbackMode = normalizePaymentMode(input.paymentMode);
  if (fallbackMode) return fallbackMode;

  const providerMode = normalizePaymentMode(input.paymentProvider);
  if (providerMode) return providerMode;

  return "";
}

function resolveServiceFeeRatePercent(mode) {
  const normalized = normalizePaymentMode(mode);
  if (!normalized) return 0;

  if (normalized === "WAVE" || normalized.includes("WAVE")) {
    return MOBILE_MONEY_SERVICE_FEE_RATES.WAVE;
  }

  if (normalized === "ORANGE_MONEY" || normalized.includes("ORANGE")) {
    return MOBILE_MONEY_SERVICE_FEE_RATES.ORANGE_MONEY;
  }

  if (normalized === "BANK_TRANSFER" || normalized.includes("BANK")) {
    return MOBILE_MONEY_SERVICE_FEE_RATES.BANK_TRANSFER;
  }

  return 0;
}

function computePaymentPricing({
  preorderPaymentMode,
  paymentMode,
  paymentProvider,
  orderTotalFcfa,
}) {
  const normalizedMode = resolvePaymentModeForPricing({
    preorderPaymentMode,
    paymentMode,
    paymentProvider,
  });
  const baseTotalFcfa = Math.max(0, Number(orderTotalFcfa || 0));
  const serviceFeeRatePercent = resolveServiceFeeRatePercent(normalizedMode);
  const paymentServiceFeeFcfa =
    serviceFeeRatePercent > 0
      ? Math.ceil(baseTotalFcfa * (serviceFeeRatePercent / 100))
      : 0;

  return {
    paymentMode: normalizedMode || null,
    baseTotalFcfa,
    serviceFeeRatePercent,
    paymentServiceFeeFcfa,
    amountToPayFcfa: baseTotalFcfa + paymentServiceFeeFcfa,
  };
}

module.exports = {
  MOBILE_MONEY_SERVICE_FEE_RATES,
  normalizePaymentMode,
  resolvePaymentModeForPricing,
  resolveServiceFeeRatePercent,
  computePaymentPricing,
};
