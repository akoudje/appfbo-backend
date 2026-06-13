const PICKUP_ONLY_PAYMENT_MODES = new Set([
  "ESPECES",
  "WAVE",
  "ORANGE_MONEY",
  "BANK_TRANSFER",
  "ECOBANK_PAY",
  "PI_SPI",
]);

const PAYMENT_MODE_LABELS = {
  ESPECES: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
  BANK_TRANSFER: "Virement bancaire",
  ECOBANK_PAY: "Ecobank Pay",
  PI_SPI: "PI SPI",
};

function normalizeOption(value) {
  return String(value || "").trim().toUpperCase();
}

function isPickupOnlyPaymentMode(mode) {
  return PICKUP_ONLY_PAYMENT_MODES.has(normalizeOption(mode));
}

function isPaymentModeEnabled(settings = {}, mode) {
  const normalized = normalizeOption(mode);
  if (!normalized) return true;

  if (normalized === "ESPECES") return settings?.enableCash !== false;
  if (normalized === "WAVE") return settings?.enableWave !== false;
  if (normalized === "ORANGE_MONEY") return settings?.enableOrangeMoney !== false;
  if (normalized === "BANK_TRANSFER") return settings?.enableBankTransfer !== false;
  if (normalized === "ECOBANK_PAY") return settings?.enableEcobankPay === true;
  if (normalized === "PI_SPI") return settings?.enableEcobankPay === true;

  return false;
}

function isDeliveryModeEnabled(settings = {}, mode) {
  const normalized = normalizeOption(mode);
  if (!normalized) return true;

  if (normalized === "RETRAIT_SITE_FLP") return settings?.enablePickup !== false;
  if (normalized === "LIVRAISON") return settings?.enableDelivery !== false;

  return false;
}

function resolveDeliveryModeForPayment(paymentMode, requestedDeliveryMode) {
  return isPickupOnlyPaymentMode(paymentMode)
    ? "RETRAIT_SITE_FLP"
    : normalizeOption(requestedDeliveryMode) || null;
}

function validateCountryOrderOptions({
  settings = {},
  paymentMode,
  deliveryMode,
  requirePaymentMode = false,
  requireDeliveryMode = false,
}) {
  const normalizedPaymentMode = normalizeOption(paymentMode) || null;
  const normalizedDeliveryMode = deliveryMode ? normalizeOption(deliveryMode) : null;

  if (requirePaymentMode && !normalizedPaymentMode) {
    return {
      ok: false,
      code: "PAYMENT_MODE_REQUIRED",
      message: "Le mode de paiement est obligatoire.",
    };
  }

  if (normalizedPaymentMode && !isPaymentModeEnabled(settings, normalizedPaymentMode)) {
    return {
      ok: false,
      code: "PAYMENT_MODE_DISABLED",
      message: `${PAYMENT_MODE_LABELS[normalizedPaymentMode] || normalizedPaymentMode} n'est pas activé pour ce pays.`,
    };
  }

  if (requireDeliveryMode && !normalizedDeliveryMode) {
    return {
      ok: false,
      code: "DELIVERY_MODE_REQUIRED",
      message: "Le mode de récupération est obligatoire.",
    };
  }

  if (normalizedDeliveryMode && !isDeliveryModeEnabled(settings, normalizedDeliveryMode)) {
    return {
      ok: false,
      code: "DELIVERY_MODE_DISABLED",
      message:
        normalizedDeliveryMode === "RETRAIT_SITE_FLP"
          ? "Le retrait au site FLP n'est pas activé pour ce pays."
          : "La livraison n'est pas activée pour ce pays.",
    };
  }

  return { ok: true };
}

module.exports = {
  isPaymentModeEnabled,
  isPickupOnlyPaymentMode,
  resolveDeliveryModeForPayment,
  validateCountryOrderOptions,
};
