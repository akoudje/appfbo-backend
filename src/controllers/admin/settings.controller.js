const prisma = require("../../prisma");
const { pickCountryId } = require("../../helpers/countryScope");

const FBO_HELP_TOPIC_IDS = new Set([
  "country",
  "new-order",
  "cache",
  "payment",
  "payment-link-missing",
  "pickup-code-missing",
  "status",
  "pickup",
  "support",
]);

function isCustomFboHelpTopicId(id) {
  return /^custom-[a-z0-9-]{6,80}$/.test(String(id || ""));
}

const DEFAULT_FBO_HELP_TOPICS = [
  {
    id: "country",
    enabled: true,
    label: "Quel catalogue est affiché ?",
    answer:
      "Le catalogue dépend du pays choisi à l'étape 1. Les produits, prix, stocks et moyens de paiement sont chargés pour ce pays.",
  },
  {
    id: "new-order",
    enabled: true,
    label: "Faire une nouvelle précommande",
    answer:
      "Pour refaire une précommande, revenez à l'étape 1. Si l'ancien panier reste affiché, utilisez Nouvelle précommande.",
  },
  {
    id: "cache",
    enabled: true,
    label: "Anciennes informations affichées",
    answer:
      "Si le téléphone affiche encore les anciennes informations, réinitialisez la précommande en cours puis recommencez depuis l'étape 1.",
  },
  {
    id: "payment",
    enabled: false,
    label: "Paiement et lien reçu",
    answer:
      "Après traitement, vous recevez une notification avec les instructions de paiement.",
  },
  {
    id: "payment-link-missing",
    enabled: true,
    label: "Je n'ai pas reçu mon lien de paiement",
    answer:
      "Renseignez les informations de votre commande. L'équipe vérifiera votre demande avant de renvoyer le lien.",
  },
  {
    id: "status",
    enabled: false,
    label: "Voir mes commandes",
    answer:
      "Ouvrez l'espace client avec votre téléphone pour consulter vos commandes et leur statut.",
  },
  {
    id: "pickup",
    enabled: false,
    label: "Retrait de commande",
    answer:
      "Le retrait se fait selon les informations confirmées après paiement.",
  },
  {
    id: "pickup-code-missing",
    enabled: true,
    label: "Je n'ai pas reçu mon code de retrait",
    answer:
      "Renseignez les informations de votre commande. Si le colis est prêt, le code sera renvoyé automatiquement sur le numéro de commande.",
  },
  {
    id: "support",
    enabled: false,
    label: "Contacter le support",
    answer:
      "Si vous êtes bloqué, contactez le support avec votre numéro FBO et votre code de précommande.",
  },
];

function normalizeFboHelpTopics(raw) {
  const custom = Array.isArray(raw) ? raw : [];
  const systemTopics = DEFAULT_FBO_HELP_TOPICS.map((topic) => {
    const override = custom.find((item) => item?.id === topic.id) || {};
    return {
      ...topic,
      type: "system",
      enabled:
        typeof override.enabled === "boolean" ? override.enabled : topic.enabled,
      label:
        typeof override.label === "string" && override.label.trim()
          ? override.label.trim()
          : topic.label,
      answer:
        typeof override.answer === "string" && override.answer.trim()
          ? override.answer.trim()
          : topic.answer,
    };
  });

  const customTopics = custom
    .filter((item) => isCustomFboHelpTopicId(item?.id))
    .map((item) => ({
      id: String(item.id).trim(),
      type: "custom",
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      label: String(item.label || "").trim() || "Nouvelle rubrique",
      answer: String(item.answer || "").trim() || "Réponse à compléter.",
    }));

  return [...systemTopics, ...customTopics];
}

function sanitizeFboHelpTopics(raw) {
  if (!Array.isArray(raw)) return DEFAULT_FBO_HELP_TOPICS;
  const valid = raw
    .filter(
      (item) => FBO_HELP_TOPIC_IDS.has(item?.id) || isCustomFboHelpTopicId(item?.id),
    )
    .map((item) => ({
      id: String(item.id || "").trim(),
      enabled: Boolean(item.enabled),
      label: String(item.label || "").trim(),
      answer: String(item.answer || "").trim(),
    }));
  return normalizeFboHelpTopics(valid);
}

async function getCountrySettings(req, res) {
  try {
    const countryId = pickCountryId(req);
    const settings = await prisma.countrySettings.findUnique({
      where: { countryId },
      select: {
        id: true,
        countryId: true,
        minCartFcfa: true,
        maxQtyPerProduct: true,
        preorderSubmissionEnabled: true,
        preorderSubmissionDisabledMessage: true,
        publicAnnouncementEnabled: true,
        publicAnnouncementMessage: true,
        closedOnSaturday: true,
        supportPhone: true,
        pickupAddress: true,
        enableWave: true,
        enableOrangeMoney: true,
        enableCash: true,
        enableBankTransfer: true,
        enableDelivery: true,
        enablePickup: true,
        bankAccountLabel: true,
        bankName: true,
        bankAccountNumber: true,
        bankIban: true,
        bankSwift: true,
        bankAccountHolder: true,
        bankPaymentDueHours: true,
        bankProofMaxFileSizeMb: true,
        currencyLabel: true,
        pricingDisclaimer: true,
        themePrimaryColor: true,
        themeSecondaryColor: true,
        themeDarkColor: true,
        themeLogoPath: true,
        themeSliderEnabled: true,
        themeSidePanelsEnabled: true,
        notificationTemplates: true,
        fboHelpTopics: true,
        maxActiveBillingPerInvoicer: true,
        billingClaimTimeoutMin: true,
        preinvoicedAutoCancelAfterHours: true,
        preinvoicedAutoReminderAfterHours: true,
        preinvoicedAutoCancelAfterMinutes: true,
        preinvoicedAutoReminderAfterMinutes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!settings) {
      return res.json({
        id: null,
        countryId,
        countryCode: req.country?.code || null,
        minCartFcfa: 100,
        maxQtyPerProduct: 10,
        preorderSubmissionEnabled: true,
        preorderSubmissionDisabledMessage: null,
        publicAnnouncementEnabled: false,
        publicAnnouncementMessage: null,
        closedOnSaturday: false,
        supportPhone: null,
        pickupAddress: null,
        enableWave: true,
        enableOrangeMoney: true,
        enableCash: true,
        enableBankTransfer: true,
        enableDelivery: true,
        enablePickup: true,
        bankAccountLabel: null,
        bankName: null,
        bankAccountNumber: null,
        bankIban: null,
        bankSwift: null,
        bankAccountHolder: null,
        bankPaymentDueHours: 72,
        bankProofMaxFileSizeMb: 8,
        currencyLabel: "FCFA",
        pricingDisclaimer: null,
        themePrimaryColor: null,
        themeSecondaryColor: null,
        themeDarkColor: null,
        themeLogoPath: null,
        themeSliderEnabled: true,
        themeSidePanelsEnabled: true,
        notificationTemplates: null,
        fboHelpTopics: DEFAULT_FBO_HELP_TOPICS,
        maxActiveBillingPerInvoicer: 10,
        billingClaimTimeoutMin: 30,
        preinvoicedAutoCancelAfterHours: 2,
        preinvoicedAutoReminderAfterHours: 1,
        preinvoicedAutoCancelAfterMinutes: 120,
        preinvoicedAutoReminderAfterMinutes: 60,
        createdAt: null,
        updatedAt: null,
      });
    }
    return res.json({
      ...settings,
      fboHelpTopics: normalizeFboHelpTopics(settings.fboHelpTopics),
      countryCode: req.country?.code || null,
    });
  } catch (e) {
    console.error("getCountrySettings error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (getCountrySettings)" });
  }
}

async function updateCountrySettings(req, res) {
  try {
    const countryId = pickCountryId(req);
    const existingSettings = await prisma.countrySettings.findUnique({
      where: { countryId },
      select: {
        preinvoicedAutoCancelAfterHours: true,
        preinvoicedAutoReminderAfterHours: true,
        preinvoicedAutoCancelAfterMinutes: true,
        preinvoicedAutoReminderAfterMinutes: true,
      },
    });
    const {
      minCartFcfa,
      maxQtyPerProduct,
      preorderSubmissionEnabled,
      preorderSubmissionDisabledMessage,
      publicAnnouncementEnabled,
      publicAnnouncementMessage,
      closedOnSaturday,
      supportPhone,
      pickupAddress,
      enableWave,
      enableOrangeMoney,
      enableCash,
      enableBankTransfer,
      enableDelivery,
      enablePickup,
      bankAccountLabel,
      bankName,
      bankAccountNumber,
      bankIban,
      bankSwift,
      bankAccountHolder,
      bankPaymentDueHours,
      bankProofMaxFileSizeMb,
      currencyLabel,
      pricingDisclaimer,
      themePrimaryColor,
      themeSecondaryColor,
      themeDarkColor,
      themeLogoPath,
      themeSliderEnabled,
      themeSidePanelsEnabled,
      notificationTemplates,
      fboHelpTopics,
      maxActiveBillingPerInvoicer,
      billingClaimTimeoutMin,
      preinvoicedAutoCancelAfterHours,
      preinvoicedAutoReminderAfterHours,
      preinvoicedAutoCancelAfterMinutes,
      preinvoicedAutoReminderAfterMinutes,
    } = req.body || {};

    const data = {};

    if (minCartFcfa !== undefined) {
      const parsed = Number.parseInt(minCartFcfa, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ message: "minCartFcfa invalide" });
      }
      data.minCartFcfa = parsed;
    }

    if (maxQtyPerProduct !== undefined) {
      const parsed = Number.parseInt(maxQtyPerProduct, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 999) {
        return res.status(400).json({ message: "maxQtyPerProduct invalide" });
      }
      data.maxQtyPerProduct = parsed;
    }

    if (preorderSubmissionEnabled !== undefined) {
      data.preorderSubmissionEnabled = Boolean(preorderSubmissionEnabled);
    }

    if (preorderSubmissionDisabledMessage !== undefined) {
      data.preorderSubmissionDisabledMessage = preorderSubmissionDisabledMessage
        ? String(preorderSubmissionDisabledMessage).trim()
        : null;
    }

    if (publicAnnouncementEnabled !== undefined) {
      data.publicAnnouncementEnabled = Boolean(publicAnnouncementEnabled);
    }

    if (publicAnnouncementMessage !== undefined) {
      data.publicAnnouncementMessage = publicAnnouncementMessage
        ? String(publicAnnouncementMessage).trim()
        : null;
    }

    if (closedOnSaturday !== undefined) {
      data.closedOnSaturday = Boolean(closedOnSaturday);
    }

    if (maxActiveBillingPerInvoicer !== undefined) {
      const parsed = Number.parseInt(maxActiveBillingPerInvoicer, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return res.status(400).json({
          message: "maxActiveBillingPerInvoicer invalide",
        });
      }
      data.maxActiveBillingPerInvoicer = parsed;
    }

    if (billingClaimTimeoutMin !== undefined) {
      const parsed = Number.parseInt(billingClaimTimeoutMin, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return res.status(400).json({
          message: "billingClaimTimeoutMin invalide",
        });
      }
      data.billingClaimTimeoutMin = parsed;
    }

    if (preinvoicedAutoCancelAfterHours !== undefined) {
      const parsed = Number.parseInt(preinvoicedAutoCancelAfterHours, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 720) {
        return res.status(400).json({
          message: "preinvoicedAutoCancelAfterHours invalide",
        });
      }
      data.preinvoicedAutoCancelAfterHours = parsed;
      if (preinvoicedAutoCancelAfterMinutes === undefined) {
        data.preinvoicedAutoCancelAfterMinutes = parsed * 60;
      }
    }

    if (preinvoicedAutoReminderAfterHours !== undefined) {
      const parsed = Number.parseInt(preinvoicedAutoReminderAfterHours, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 719) {
        return res.status(400).json({
          message: "preinvoicedAutoReminderAfterHours invalide",
        });
      }
      data.preinvoicedAutoReminderAfterHours = parsed;
      if (preinvoicedAutoReminderAfterMinutes === undefined) {
        data.preinvoicedAutoReminderAfterMinutes = parsed * 60;
      }
    }

    if (preinvoicedAutoCancelAfterMinutes !== undefined) {
      const parsed = Number.parseInt(preinvoicedAutoCancelAfterMinutes, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 43200) {
        return res.status(400).json({
          message: "preinvoicedAutoCancelAfterMinutes invalide",
        });
      }
      data.preinvoicedAutoCancelAfterMinutes = parsed;
      data.preinvoicedAutoCancelAfterHours = Math.max(1, Math.ceil(parsed / 60));
    }

    if (preinvoicedAutoReminderAfterMinutes !== undefined) {
      const parsed = Number.parseInt(preinvoicedAutoReminderAfterMinutes, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 43199) {
        return res.status(400).json({
          message: "preinvoicedAutoReminderAfterMinutes invalide",
        });
      }
      data.preinvoicedAutoReminderAfterMinutes = parsed;
      data.preinvoicedAutoReminderAfterHours = Math.max(1, Math.ceil(parsed / 60));
    }

    const effectiveCancelMinutes =
      data.preinvoicedAutoCancelAfterMinutes !== undefined
        ? data.preinvoicedAutoCancelAfterMinutes
        : existingSettings?.preinvoicedAutoCancelAfterMinutes ??
          (existingSettings?.preinvoicedAutoCancelAfterHours ?? 2) * 60;
    const effectiveReminderMinutes =
      data.preinvoicedAutoReminderAfterMinutes !== undefined
        ? data.preinvoicedAutoReminderAfterMinutes
        : existingSettings?.preinvoicedAutoReminderAfterMinutes ??
          (existingSettings?.preinvoicedAutoReminderAfterHours ?? 1) * 60;

    if (
      effectiveReminderMinutes >= effectiveCancelMinutes
    ) {
      return res.status(400).json({
        message:
          "Le délai de rappel doit être strictement inférieur au délai d'annulation.",
      });
    }

    if (bankPaymentDueHours !== undefined) {
      const parsed = Number.parseInt(bankPaymentDueHours, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 720) {
        return res.status(400).json({ message: "bankPaymentDueHours invalide" });
      }
      data.bankPaymentDueHours = parsed;
    }

    if (bankProofMaxFileSizeMb !== undefined) {
      const parsed = Number.parseInt(bankProofMaxFileSizeMb, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) {
        return res.status(400).json({ message: "bankProofMaxFileSizeMb invalide" });
      }
      data.bankProofMaxFileSizeMb = parsed;
    }

    if (supportPhone !== undefined) {
      data.supportPhone = supportPhone ? String(supportPhone).trim() : null;
    }

    if (pickupAddress !== undefined) {
      data.pickupAddress = pickupAddress ? String(pickupAddress).trim() : null;
    }

    if (enableWave !== undefined) data.enableWave = Boolean(enableWave);
    if (enableOrangeMoney !== undefined) data.enableOrangeMoney = Boolean(enableOrangeMoney);
    if (enableCash !== undefined) data.enableCash = Boolean(enableCash);
    if (enableBankTransfer !== undefined) data.enableBankTransfer = Boolean(enableBankTransfer);
    if (enableDelivery !== undefined) data.enableDelivery = Boolean(enableDelivery);
    if (enablePickup !== undefined) data.enablePickup = Boolean(enablePickup);

    if (bankAccountLabel !== undefined) {
      data.bankAccountLabel = bankAccountLabel ? String(bankAccountLabel).trim() : null;
    }
    if (bankName !== undefined) {
      data.bankName = bankName ? String(bankName).trim() : null;
    }
    if (bankAccountNumber !== undefined) {
      data.bankAccountNumber = bankAccountNumber ? String(bankAccountNumber).trim() : null;
    }
    if (bankIban !== undefined) {
      data.bankIban = bankIban ? String(bankIban).trim() : null;
    }
    if (bankSwift !== undefined) {
      data.bankSwift = bankSwift ? String(bankSwift).trim() : null;
    }
    if (bankAccountHolder !== undefined) {
      data.bankAccountHolder = bankAccountHolder ? String(bankAccountHolder).trim() : null;
    }

    if (currencyLabel !== undefined) {
      data.currencyLabel = currencyLabel ? String(currencyLabel).trim() : null;
    }

    if (pricingDisclaimer !== undefined) {
      data.pricingDisclaimer = pricingDisclaimer
        ? String(pricingDisclaimer).trim()
        : null;
    }

    if (themePrimaryColor !== undefined) {
      data.themePrimaryColor = themePrimaryColor
        ? String(themePrimaryColor).trim()
        : null;
    }
    if (themeSecondaryColor !== undefined) {
      data.themeSecondaryColor = themeSecondaryColor
        ? String(themeSecondaryColor).trim()
        : null;
    }
    if (themeDarkColor !== undefined) {
      data.themeDarkColor = themeDarkColor ? String(themeDarkColor).trim() : null;
    }
    if (themeLogoPath !== undefined) {
      data.themeLogoPath = themeLogoPath ? String(themeLogoPath).trim() : null;
    }
    if (themeSliderEnabled !== undefined) {
      data.themeSliderEnabled = Boolean(themeSliderEnabled);
    }
    if (themeSidePanelsEnabled !== undefined) {
      data.themeSidePanelsEnabled = Boolean(themeSidePanelsEnabled);
    }
    if (notificationTemplates !== undefined) {
      if (
        notificationTemplates !== null &&
        (typeof notificationTemplates !== "object" ||
          Array.isArray(notificationTemplates))
      ) {
        return res
          .status(400)
          .json({ message: "notificationTemplates invalide" });
      }
      data.notificationTemplates = notificationTemplates;
    }

    if (fboHelpTopics !== undefined) {
      data.fboHelpTopics = sanitizeFboHelpTopics(fboHelpTopics);
    }

    const updated = await prisma.countrySettings.upsert({
      where: { countryId },
      update: data,
        create: {
          countryId,
          minCartFcfa:
            data.minCartFcfa !== undefined ? data.minCartFcfa : 100,
          maxQtyPerProduct:
            data.maxQtyPerProduct !== undefined ? data.maxQtyPerProduct : 10,
          preorderSubmissionEnabled:
            data.preorderSubmissionEnabled !== undefined
              ? data.preorderSubmissionEnabled
              : true,
          preorderSubmissionDisabledMessage:
            data.preorderSubmissionDisabledMessage ?? null,
          publicAnnouncementEnabled:
            data.publicAnnouncementEnabled !== undefined
              ? data.publicAnnouncementEnabled
              : false,
          publicAnnouncementMessage:
            data.publicAnnouncementMessage ?? null,
          closedOnSaturday:
            data.closedOnSaturday !== undefined ? data.closedOnSaturday : false,
          supportPhone: data.supportPhone ?? null,
          pickupAddress: data.pickupAddress ?? null,
          enableWave: data.enableWave !== undefined ? data.enableWave : true,
          enableOrangeMoney:
            data.enableOrangeMoney !== undefined ? data.enableOrangeMoney : true,
          enableCash: data.enableCash !== undefined ? data.enableCash : true,
          enableBankTransfer:
            data.enableBankTransfer !== undefined ? data.enableBankTransfer : true,
          enableDelivery:
            data.enableDelivery !== undefined ? data.enableDelivery : true,
          enablePickup: data.enablePickup !== undefined ? data.enablePickup : true,
          bankAccountLabel: data.bankAccountLabel ?? null,
          bankName: data.bankName ?? null,
          bankAccountNumber: data.bankAccountNumber ?? null,
          bankIban: data.bankIban ?? null,
          bankSwift: data.bankSwift ?? null,
          bankAccountHolder: data.bankAccountHolder ?? null,
          bankPaymentDueHours:
            data.bankPaymentDueHours !== undefined ? data.bankPaymentDueHours : 72,
          bankProofMaxFileSizeMb:
            data.bankProofMaxFileSizeMb !== undefined
              ? data.bankProofMaxFileSizeMb
              : 8,
          currencyLabel: data.currencyLabel ?? "FCFA",
          pricingDisclaimer: data.pricingDisclaimer ?? null,
          themePrimaryColor: data.themePrimaryColor ?? null,
          themeSecondaryColor: data.themeSecondaryColor ?? null,
          themeDarkColor: data.themeDarkColor ?? null,
          themeLogoPath: data.themeLogoPath ?? null,
          themeSliderEnabled:
            data.themeSliderEnabled !== undefined ? data.themeSliderEnabled : true,
          themeSidePanelsEnabled:
            data.themeSidePanelsEnabled !== undefined
              ? data.themeSidePanelsEnabled
              : true,
          fboHelpTopics: data.fboHelpTopics ?? DEFAULT_FBO_HELP_TOPICS,
          maxActiveBillingPerInvoicer:
            data.maxActiveBillingPerInvoicer !== undefined
            ? data.maxActiveBillingPerInvoicer
            : 5,
          billingClaimTimeoutMin:
            data.billingClaimTimeoutMin !== undefined
              ? data.billingClaimTimeoutMin
              : 15,
          preinvoicedAutoCancelAfterHours:
            data.preinvoicedAutoCancelAfterHours !== undefined
              ? data.preinvoicedAutoCancelAfterHours
              : 2,
          preinvoicedAutoReminderAfterHours:
            data.preinvoicedAutoReminderAfterHours !== undefined
              ? data.preinvoicedAutoReminderAfterHours
              : 1,
          preinvoicedAutoCancelAfterMinutes:
            data.preinvoicedAutoCancelAfterMinutes !== undefined
              ? data.preinvoicedAutoCancelAfterMinutes
              : 120,
          preinvoicedAutoReminderAfterMinutes:
            data.preinvoicedAutoReminderAfterMinutes !== undefined
              ? data.preinvoicedAutoReminderAfterMinutes
              : 60,
      },
      select: {
        id: true,
        countryId: true,
        minCartFcfa: true,
        maxQtyPerProduct: true,
        preorderSubmissionEnabled: true,
        preorderSubmissionDisabledMessage: true,
        publicAnnouncementEnabled: true,
        publicAnnouncementMessage: true,
        closedOnSaturday: true,
        supportPhone: true,
        pickupAddress: true,
        enableWave: true,
        enableOrangeMoney: true,
        enableCash: true,
        enableBankTransfer: true,
        enableDelivery: true,
        enablePickup: true,
        bankAccountLabel: true,
        bankName: true,
        bankAccountNumber: true,
        bankIban: true,
        bankSwift: true,
        bankAccountHolder: true,
        bankPaymentDueHours: true,
        bankProofMaxFileSizeMb: true,
        currencyLabel: true,
        pricingDisclaimer: true,
        themePrimaryColor: true,
        themeSecondaryColor: true,
        themeDarkColor: true,
        themeLogoPath: true,
        themeSliderEnabled: true,
        themeSidePanelsEnabled: true,
        notificationTemplates: true,
        fboHelpTopics: true,
        maxActiveBillingPerInvoicer: true,
        billingClaimTimeoutMin: true,
        preinvoicedAutoCancelAfterHours: true,
        preinvoicedAutoReminderAfterHours: true,
        preinvoicedAutoCancelAfterMinutes: true,
        preinvoicedAutoReminderAfterMinutes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ...updated,
      fboHelpTopics: normalizeFboHelpTopics(updated.fboHelpTopics),
    });
  } catch (e) {
    console.error("updateCountrySettings error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (updateCountrySettings)" });
  }
}

module.exports = {
  getCountrySettings,
  updateCountrySettings,
};
