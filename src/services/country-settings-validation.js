function validateCountrySettings(patch, existing = {}) {
  const errors = {};
  const all = { ...existing, ...patch };
  const numbers = {
    minCartFcfa: [0, 2147483647],
    maxQtyPerProduct: [1, 999],
    packagingFeeFcfa: [0, 2147483647],
    bankPaymentDueHours: [1, 720],
    bankProofMaxFileSizeMb: [1, 8],
    maxActiveBillingPerInvoicer: [1, 1000],
    billingClaimTimeoutMin: [1, 1440],
    preinvoicedAutoCancelAfterHours: [1, 720],
    preinvoicedAutoReminderAfterHours: [1, 719],
    preinvoicedAutoCancelAfterMinutes: [1, 43200],
    preinvoicedAutoReminderAfterMinutes: [1, 43199],
  };
  for (const [key, [min, max]] of Object.entries(numbers))
    if (
      key in patch &&
      (typeof patch[key] !== "number" ||
        !Number.isInteger(patch[key]) ||
        patch[key] < min ||
        patch[key] > max)
    )
      errors[key] = "Saisissez un entier entre " + min + " et " + max + ".";
  const booleans = [
    "preorderSubmissionEnabled",
    "publicAnnouncementEnabled",
    "closedOnSaturday",
    "enableWave",
    "enableOrangeMoney",
    "enableCash",
    "enableBankTransfer",
    "enableEcobankPay",
    "enablePiSpi",
    "enableDelivery",
    "enablePickup",
    "themeSliderEnabled",
    "themeSidePanelsEnabled",
  ];
  for (const key of booleans)
    if (key in patch && typeof patch[key] !== "boolean")
      errors[key] = "Valeur activé/désactivé invalide.";
  if (
    "preinvoicedAutoCancelAfterMinutes" in patch ||
    "preinvoicedAutoReminderAfterMinutes" in patch
  ) {
    const cancel =
      all.preinvoicedAutoCancelAfterMinutes ??
      (all.preinvoicedAutoCancelAfterHours ?? 2) * 60;
    const reminder =
      all.preinvoicedAutoReminderAfterMinutes ??
      (all.preinvoicedAutoReminderAfterHours ?? 1) * 60;
    if (reminder >= cancel)
      errors.preinvoicedAutoReminderAfterMinutes =
        "Le rappel doit précéder l’annulation.";
  }
  for (const key of [
    "themePrimaryColor",
    "themeSecondaryColor",
    "themeDarkColor",
  ])
    if (patch[key] && !/^#[0-9a-f]{6}$/i.test(patch[key]))
      errors[key] = "Utilisez une couleur au format #RRGGBB.";
  for (const key of [
    "ecobankPayQrImageUrl",
    "piSpiQrImageUrl",
    "themeLogoPath",
  ])
    if (patch[key]) {
      const value = String(patch[key]);
      if (
        !/^https?:\/\//i.test(value) &&
        !(key === "themeLogoPath" && /^\/(?!\/)/.test(value))
      )
        errors[key] = "Utilisez une adresse HTTP(S) valide.";
      else if (/^https?:/i.test(value)) {
        try {
          new URL(value);
        } catch {
          errors[key] = "Adresse invalide.";
        }
      }
    }
  function requiredIfEnabled(enabled, keys, triggers = keys) {
    if (!triggers.some((key) => key in patch) && !(enabled in patch)) return;
    if (all[enabled])
      for (const key of keys)
        if (!String(all[key] || "").trim())
          errors[key] = "Ce champ est requis lorsque cette option est activée.";
  }
  requiredIfEnabled(
    "enableBankTransfer",
    ["bankName", "bankAccountHolder"],
    ["bankName", "bankAccountHolder", "bankAccountNumber", "bankIban"],
  );
  if (
    ["enableBankTransfer", "bankAccountNumber", "bankIban"].some(
      (key) => key in patch,
    ) &&
    all.enableBankTransfer &&
    !String(all.bankAccountNumber || all.bankIban || "").trim()
  )
    errors.bankAccountNumber = "Renseignez un numéro de compte ou un IBAN.";
  requiredIfEnabled("enableEcobankPay", [
    "ecobankPayMerchantName",
    "ecobankPayMerchantId",
    "ecobankPayQrImageUrl",
  ]);
  requiredIfEnabled("enablePiSpi", [
    "piSpiAlias",
    "piSpiMerchantName",
    "piSpiQrImageUrl",
  ]);
  requiredIfEnabled("publicAnnouncementEnabled", ["publicAnnouncementMessage"]);
  if (
    "preorderSubmissionEnabled" in patch &&
    !all.preorderSubmissionEnabled &&
    !String(all.preorderSubmissionDisabledMessage || "").trim()
  )
    errors.preorderSubmissionDisabledMessage =
      "Indiquez le message affiché aux clients.";
  if (
    ("enableDelivery" in patch || "enablePickup" in patch) &&
    !all.enableDelivery &&
    !all.enablePickup
  )
    errors.enablePickup = "Conservez au moins un mode de remise.";
  const modes = [
    "enableWave",
    "enableOrangeMoney",
    "enableCash",
    "enableBankTransfer",
    "enableEcobankPay",
    "enablePiSpi",
  ];
  if (
    modes.some((key) => key in patch) &&
    modes.every((key) => all[key] === false)
  )
    errors.enableCash = "Conservez au moins un moyen de paiement.";
  if (
    "notificationTemplates" in patch &&
    patch.notificationTemplates !== null
  ) {
    if (
      typeof patch.notificationTemplates !== "object" ||
      Array.isArray(patch.notificationTemplates)
    )
      errors.notificationTemplates = "Modèles de notification invalides.";
    else
      for (const [channel, templates] of Object.entries(
        patch.notificationTemplates,
      )) {
        if (
          !["sms", "email"].includes(channel) ||
          !templates ||
          typeof templates !== "object" ||
          Array.isArray(templates)
        ) {
          errors.notificationTemplates = "Canal de notification invalide.";
          continue;
        }
        for (const value of Object.values(templates)) {
          if (channel === "sms" && typeof value !== "string")
            errors.notificationTemplates = "Le SMS doit être un texte.";
          if (
            channel === "email" &&
            (!value ||
              typeof value !== "object" ||
              typeof value.subject !== "string" ||
              typeof value.body !== "string")
          )
            errors.notificationTemplates =
              "Le modèle email doit contenir un sujet et un corps.";
        }
      }
  }
  if (
    patch.notificationTemplates &&
    typeof patch.notificationTemplates === "object"
  ) {
    const variables = new Set([
      "customerName",
      "preorderNumber",
      "parcelNumber",
      "invoiceRef",
      "paymentCollectionCode",
      "totalFcfa",
      "totalFcfaLabel",
      "paymentLink",
      "bankProofUploadLink",
      "pickupCode",
      "supportPhone",
      "pickupAddress",
      "bankAccountLine",
      "bankAccountHolder",
      "bankAccountNumber",
      "paymentExpiryHours",
      "paymentFlow",
      "bankName",
      "bankIban",
      "bankAccountDetails",
    ]);
    for (const templates of Object.values(patch.notificationTemplates)) {
      if (!templates || typeof templates !== "object") continue;
      for (const value of Object.values(templates)) {
        const text =
          typeof value === "string"
            ? value
            : typeof value === "object" && value
              ? String(value.subject || "") + " " + String(value.body || "")
              : "";
        const unknown = [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
          .map((match) => match[1])
          .filter((key) => !variables.has(key));
        if (unknown.length)
          errors.notificationTemplates =
            "Variables de message non reconnues : " +
            [...new Set(unknown)].join(", ") +
            ".";
      }
    }
  }
  return errors;
}

module.exports = { validateCountrySettings };
