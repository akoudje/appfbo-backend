function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPaymentExpiryHours() {
  return readPositiveInt(process.env.PREINVOICED_AUTO_CANCEL_AFTER_HOURS, 3);
}

function buildDefaultNotificationTemplates() {
  const expiryHours = getPaymentExpiryHours();

  return {
    sms: {
      INVOICE:
        `FOREVER: Code {{paymentCollectionCode}}. Montant {{totalFcfaLabel}}. Paiement a effectuer sous ${expiryHours}H pour la precommande {{preorderNumber}}.`,
      INVOICE_WAVE:
        `FOREVER: Code {{paymentCollectionCode}}. Montant {{totalFcfaLabel}}. Paiement Wave sous ${expiryHours}H: {{paymentLink}}`,
      INVOICE_BANK_TRANSFER:
        `FOREVER: Code {{paymentCollectionCode}}. Montant {{totalFcfaLabel}}. Virement a effectuer sous ${expiryHours}H. Voir email ou espace client.`,
      INVOICE_CASH:
        `FOREVER: Code {{paymentCollectionCode}}. Montant {{totalFcfaLabel}}. Paiement a la caisse FLP sous ${expiryHours}H.`,
      PAYMENT_CONFIRMED:
        "FOREVER: Bonjour {{customerName}}, le paiement de votre precommande {{preorderNumber}} est confirme pour {{totalFcfaLabel}}.",
    },
    email: {
      INVOICE: {
        subject: "FOREVER - Précommande {{preorderNumber}} disponible pour paiement",
        body: [
          "Bonjour {{customerName}},",
          "",
          "Votre précommande {{preorderNumber}} est disponible pour paiement.",
          "Code encaissement: {{paymentCollectionCode}}",
          "Montant à payer: {{totalFcfaLabel}}",
          "Cette préfacture reste payable pendant {{paymentExpiryHours}}h maximum après émission.",
          "",
          "Étapes recommandées:",
          "1. Vérifiez le montant et votre numéro de précommande.",
          "2. Finalisez le paiement dans un délai maximal de {{paymentExpiryHours}}h.",
          "3. Conservez cette notification jusqu'à confirmation du paiement.",
          "",
          "Merci de votre confiance.",
          "Equipe FOREVER",
        ].join("\n"),
      },
      PAYMENT_CONFIRMED: {
        subject: "FOREVER - Paiement confirmé ({{preorderNumber}})",
        body: [
          "Bonjour {{customerName}},",
          "",
          "Votre paiement pour la commande {{preorderNumber}} a été confirmé.",
          "Montant confirmé: {{totalFcfaLabel}}",
          "Votre commande suit désormais son traitement normal.",
          "Vous recevrez une nouvelle notification dès le lancement de la préparation.",
          "",
          "Merci pour votre confiance.",
          "Equipe FOREVER",
        ].join("\n"),
      },
    },
    meta: {
      version: "2026-04-payment-window-3h",
      paymentExpiryHours: expiryHours,
    },
  };
}

function mergeNotificationTemplates(baseTemplates = {}, overrideTemplates = {}) {
  return {
    ...baseTemplates,
    ...overrideTemplates,
    sms: {
      ...(baseTemplates?.sms || {}),
      ...(overrideTemplates?.sms || {}),
    },
    email: {
      ...(baseTemplates?.email || {}),
      ...(overrideTemplates?.email || {}),
      INVOICE: {
        ...(baseTemplates?.email?.INVOICE || {}),
        ...(overrideTemplates?.email?.INVOICE || {}),
      },
      PAYMENT_CONFIRMED: {
        ...(baseTemplates?.email?.PAYMENT_CONFIRMED || {}),
        ...(overrideTemplates?.email?.PAYMENT_CONFIRMED || {}),
      },
    },
    meta: {
      ...(baseTemplates?.meta || {}),
      ...(overrideTemplates?.meta || {}),
    },
  };
}

module.exports = {
  getPaymentExpiryHours,
  buildDefaultNotificationTemplates,
  mergeNotificationTemplates,
};
