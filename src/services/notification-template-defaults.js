function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPaymentExpiryHours() {
  return readPositiveInt(process.env.PREINVOICED_AUTO_CANCEL_AFTER_HOURS, 2);
}

function buildDefaultNotificationTemplates() {
  const expiryHours = getPaymentExpiryHours();

  return {
    sms: {
      INVOICE:
        `Code paiement {{paymentCollectionCode}}. Montant final {{totalFcfaLabel}}. Paiement a effectuer sous ${expiryHours}H.`,
      INVOICE_WAVE:
        `Code paiement {{paymentCollectionCode}}. Montant final {{totalFcfaLabel}}. Reglez sous ${expiryHours}H via le lien Wave: {{paymentLink}}`,
      INVOICE_BANK_TRANSFER:
        `Code paiement {{paymentCollectionCode}}. Montant final {{totalFcfaLabel}}. Effectuez le virement puis deposez votre preuve sous ${expiryHours}H: {{bankProofUploadLink}}`,
      INVOICE_ECOBANK_PAY:
        `Code paiement {{paymentCollectionCode}}. Montant final {{totalFcfaLabel}}. Scannez le QR Ecobank Pay puis deposez votre preuve sous ${expiryHours}H: {{bankProofUploadLink}}`,
      INVOICE_PI_SPI:
        `Code paiement {{paymentCollectionCode}}. Montant final {{totalFcfaLabel}}. Scannez le QR PI SPI puis deposez votre preuve sous ${expiryHours}H: {{bankProofUploadLink}}`,
      INVOICE_CASH:
        `Code paiement {{paymentCollectionCode}}. Montant final {{totalFcfaLabel}}. Passez a la caisse FLP sous ${expiryHours}H. Passe ce delai, la commande sera annulee.`,
      PAYMENT_CONFIRMED:
        "Bonjour {{customerName}}, le paiement de votre précommande est confirmé pour {{totalFcfaLabel}}.",
    },
    email: {
      INVOICE: {
        subject: "FOREVER CI - Précommande {{preorderNumber}} disponible pour paiement",
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
      INVOICE_WAVE: {
        subject: "FOREVER CI - Lien de paiement Wave ({{preorderNumber}})",
        body: [
          "Bonjour {{customerName}},",
          "",
          "Votre précommande {{preorderNumber}} est disponible pour paiement.",
          "Code encaissement: {{paymentCollectionCode}}",
          "Montant à payer: {{totalFcfaLabel}}",
          "Lien de paiement sécurisé: {{paymentLink}}",
          "Cette préfacture reste payable pendant {{paymentExpiryHours}}h maximum après émission.",
          "",
          "Étapes recommandées:",
          "1. Vérifiez le montant et votre numéro de précommande.",
          "2. Ouvrez le lien sécurisé et finalisez le paiement.",
          "3. Conservez cette notification jusqu'à confirmation du paiement.",
          "",
          "Merci de votre confiance.",
          "Equipe FOREVER",
        ].join("\n"),
      },
      INVOICE_BANK_TRANSFER: {
        subject: "FOREVER CI - Dépôt de preuve bancaire ({{preorderNumber}})",
        body: [
          "Bonjour {{customerName}},",
          "",
          "Votre précommande {{preorderNumber}} attend votre preuve de virement.",
          "Code encaissement: {{paymentCollectionCode}}",
          "Montant à payer: {{totalFcfaLabel}}",
          "Lien sécurisé de dépôt de preuve: {{bankProofUploadLink}}",
          "Cette préfacture reste payable pendant {{paymentExpiryHours}}h maximum après émission.",
          "",
          "Étapes recommandées:",
          "1. Effectuez le virement bancaire.",
          "2. Ouvrez le lien sécurisé et joignez votre justificatif.",
          "3. Finalisez le dépôt dans un délai maximal de {{paymentExpiryHours}}h.",
          "",
          "Merci de votre confiance.",
          "Equipe FOREVER",
        ].join("\n"),
      },
      INVOICE_ECOBANK_PAY: {
        subject: "FOREVER CI - Dépôt de preuve Ecobank Pay ({{preorderNumber}})",
        body: [
          "Bonjour {{customerName}},",
          "",
          "Votre précommande {{preorderNumber}} est prête pour paiement via Ecobank Pay.",
          "Code encaissement: {{paymentCollectionCode}}",
          "Montant à payer: {{totalFcfaLabel}}",
          "Lien sécurisé de dépôt de preuve: {{bankProofUploadLink}}",
          "Cette préfacture reste payable pendant {{paymentExpiryHours}}h maximum après émission.",
          "",
          "Étapes recommandées:",
          "1. Scannez le QR code Ecobank Pay et payez le montant exact.",
          "2. Ouvrez le lien sécurisé et joignez votre justificatif de paiement.",
          "3. Finalisez le dépôt dans un délai maximal de {{paymentExpiryHours}}h.",
          "",
          "Merci de votre confiance.",
          "Equipe FOREVER",
        ].join("\n"),
      },
      INVOICE_PI_SPI: {
        subject: "FOREVER CI - Dépôt de preuve PI SPI ({{preorderNumber}})",
        body: [
          "Bonjour {{customerName}},",
          "",
          "Votre précommande {{preorderNumber}} est prête pour paiement via PI SPI.",
          "Code encaissement: {{paymentCollectionCode}}",
          "Montant à payer: {{totalFcfaLabel}}",
          "Lien sécurisé de dépôt de preuve: {{bankProofUploadLink}}",
          "Cette préfacture reste payable pendant {{paymentExpiryHours}}h maximum après émission.",
          "",
          "Étapes recommandées:",
          "1. Scannez le QR code PI SPI et vérifiez le bénéficiaire.",
          "2. Payez le montant exact.",
          "3. Ouvrez le lien sécurisé et joignez votre justificatif de paiement.",
          "",
          "Merci de votre confiance.",
          "Equipe FOREVER",
        ].join("\n"),
      },
      REMINDER_BANK_TRANSFER: {
        subject: "FOREVER CI - Rappel dépôt preuve bancaire ({{preorderNumber}})",
        body: [
          "Bonjour {{customerName}},",
          "",
          "Nous attendons toujours votre preuve de virement pour la précommande {{preorderNumber}}.",
          "Montant à payer: {{totalFcfaLabel}}",
          "Lien sécurisé de dépôt de preuve: {{bankProofUploadLink}}",
          "",
          "Merci de transmettre votre justificatif dès que possible.",
          "Equipe FOREVER",
        ].join("\n"),
      },
      PAYMENT_CONFIRMED: {
        subject: "FOREVER CI - Paiement confirmé ({{preorderNumber}})",
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
      version: "2026-04-payment-window-2h",
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
      INVOICE_WAVE: {
        ...(baseTemplates?.email?.INVOICE_WAVE || {}),
        ...(overrideTemplates?.email?.INVOICE_WAVE || {}),
      },
      INVOICE_BANK_TRANSFER: {
        ...(baseTemplates?.email?.INVOICE_BANK_TRANSFER || {}),
        ...(overrideTemplates?.email?.INVOICE_BANK_TRANSFER || {}),
      },
      INVOICE_ECOBANK_PAY: {
        ...(baseTemplates?.email?.INVOICE_ECOBANK_PAY || {}),
        ...(overrideTemplates?.email?.INVOICE_ECOBANK_PAY || {}),
      },
      INVOICE_PI_SPI: {
        ...(baseTemplates?.email?.INVOICE_PI_SPI || {}),
        ...(overrideTemplates?.email?.INVOICE_PI_SPI || {}),
      },
      REMINDER_BANK_TRANSFER: {
        ...(baseTemplates?.email?.REMINDER_BANK_TRANSFER || {}),
        ...(overrideTemplates?.email?.REMINDER_BANK_TRANSFER || {}),
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
