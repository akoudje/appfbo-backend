const MOBILE_MONEY_SERVICE_FEE_RATES = {
  WAVE: 1,
  ORANGE_MONEY: 0,
};

function normalizePaymentMode(value) {
  return String(value || "").trim().toUpperCase();
}

function computePaymentPricing({ preorderPaymentMode, orderTotalFcfa }) {
  const normalizedMode = normalizePaymentMode(preorderPaymentMode);
  const baseTotalFcfa = Math.max(0, Number(orderTotalFcfa || 0));
  const serviceFeeRatePercent =
    MOBILE_MONEY_SERVICE_FEE_RATES[normalizedMode] || 0;
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
  computePaymentPricing,
};
