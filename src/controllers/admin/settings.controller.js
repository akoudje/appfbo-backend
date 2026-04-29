const prisma = require("../../prisma");
const { pickCountryId } = require("../../helpers/countryScope");

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
        maxActiveBillingPerInvoicer: true,
        billingClaimTimeoutMin: true,
        preinvoicedAutoCancelAfterHours: true,
        preinvoicedAutoReminderAfterHours: true,
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
        maxActiveBillingPerInvoicer: 5,
        billingClaimTimeoutMin: 15,
        preinvoicedAutoCancelAfterHours: 2,
        preinvoicedAutoReminderAfterHours: 1,
        createdAt: null,
        updatedAt: null,
      });
    }
    return res.json({
      ...settings,
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
      },
    });
    const {
      minCartFcfa,
      maxQtyPerProduct,
      preorderSubmissionEnabled,
      preorderSubmissionDisabledMessage,
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
      maxActiveBillingPerInvoicer,
      billingClaimTimeoutMin,
      preinvoicedAutoCancelAfterHours,
      preinvoicedAutoReminderAfterHours,
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
    }

    if (preinvoicedAutoReminderAfterHours !== undefined) {
      const parsed = Number.parseInt(preinvoicedAutoReminderAfterHours, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 719) {
        return res.status(400).json({
          message: "preinvoicedAutoReminderAfterHours invalide",
        });
      }
      data.preinvoicedAutoReminderAfterHours = parsed;
    }

    const effectiveCancelHours =
      data.preinvoicedAutoCancelAfterHours !== undefined
        ? data.preinvoicedAutoCancelAfterHours
        : existingSettings?.preinvoicedAutoCancelAfterHours ?? 2;
    const effectiveReminderHours =
      data.preinvoicedAutoReminderAfterHours !== undefined
        ? data.preinvoicedAutoReminderAfterHours
        : existingSettings?.preinvoicedAutoReminderAfterHours ?? 1;

    if (
      effectiveReminderHours >= effectiveCancelHours
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
      },
      select: {
        id: true,
        countryId: true,
        minCartFcfa: true,
        maxQtyPerProduct: true,
        preorderSubmissionEnabled: true,
        preorderSubmissionDisabledMessage: true,
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
        maxActiveBillingPerInvoicer: true,
        billingClaimTimeoutMin: true,
        preinvoicedAutoCancelAfterHours: true,
        preinvoicedAutoReminderAfterHours: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json(updated);
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
