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
        supportPhone: true,
        pickupAddress: true,
        enableWave: true,
        enableOrangeMoney: true,
        enableCash: true,
        enableDelivery: true,
        enablePickup: true,
        currencyLabel: true,
        pricingDisclaimer: true,
        themePrimaryColor: true,
        themeSecondaryColor: true,
        themeDarkColor: true,
        themeLogoPath: true,
        themeSliderEnabled: true,
        themeSidePanelsEnabled: true,
        maxActiveBillingPerInvoicer: true,
        billingClaimTimeoutMin: true,
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
        supportPhone: null,
        pickupAddress: null,
        enableWave: true,
        enableOrangeMoney: true,
        enableCash: true,
        enableDelivery: true,
        enablePickup: true,
        currencyLabel: "FCFA",
        pricingDisclaimer: null,
        themePrimaryColor: null,
        themeSecondaryColor: null,
        themeDarkColor: null,
        themeLogoPath: null,
        themeSliderEnabled: true,
        themeSidePanelsEnabled: true,
        maxActiveBillingPerInvoicer: 5,
        billingClaimTimeoutMin: 15,
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
    const {
      minCartFcfa,
      supportPhone,
      pickupAddress,
      enableWave,
      enableOrangeMoney,
      enableCash,
      enableDelivery,
      enablePickup,
      currencyLabel,
      pricingDisclaimer,
      themePrimaryColor,
      themeSecondaryColor,
      themeDarkColor,
      themeLogoPath,
      themeSliderEnabled,
      themeSidePanelsEnabled,
      maxActiveBillingPerInvoicer,
      billingClaimTimeoutMin,
    } = req.body || {};

    const data = {};

    if (minCartFcfa !== undefined) {
      const parsed = Number.parseInt(minCartFcfa, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ message: "minCartFcfa invalide" });
      }
      data.minCartFcfa = parsed;
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

    if (supportPhone !== undefined) {
      data.supportPhone = supportPhone ? String(supportPhone).trim() : null;
    }

    if (pickupAddress !== undefined) {
      data.pickupAddress = pickupAddress ? String(pickupAddress).trim() : null;
    }

    if (enableWave !== undefined) data.enableWave = Boolean(enableWave);
    if (enableOrangeMoney !== undefined) data.enableOrangeMoney = Boolean(enableOrangeMoney);
    if (enableCash !== undefined) data.enableCash = Boolean(enableCash);
    if (enableDelivery !== undefined) data.enableDelivery = Boolean(enableDelivery);
    if (enablePickup !== undefined) data.enablePickup = Boolean(enablePickup);

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

    const updated = await prisma.countrySettings.upsert({
      where: { countryId },
      update: data,
        create: {
          countryId,
          minCartFcfa:
            data.minCartFcfa !== undefined ? data.minCartFcfa : 100,
          supportPhone: data.supportPhone ?? null,
          pickupAddress: data.pickupAddress ?? null,
          enableWave: data.enableWave !== undefined ? data.enableWave : true,
          enableOrangeMoney:
            data.enableOrangeMoney !== undefined ? data.enableOrangeMoney : true,
          enableCash: data.enableCash !== undefined ? data.enableCash : true,
          enableDelivery:
            data.enableDelivery !== undefined ? data.enableDelivery : true,
          enablePickup: data.enablePickup !== undefined ? data.enablePickup : true,
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
      },
      select: {
        id: true,
        countryId: true,
        minCartFcfa: true,
        supportPhone: true,
        pickupAddress: true,
        enableWave: true,
        enableOrangeMoney: true,
        enableCash: true,
        enableDelivery: true,
        enablePickup: true,
        currencyLabel: true,
        pricingDisclaimer: true,
        themePrimaryColor: true,
        themeSecondaryColor: true,
        themeDarkColor: true,
        themeLogoPath: true,
        themeSliderEnabled: true,
        themeSidePanelsEnabled: true,
        maxActiveBillingPerInvoicer: true,
        billingClaimTimeoutMin: true,
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
