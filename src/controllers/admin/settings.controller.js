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
        maxActiveBillingPerInvoicer: true,
        billingClaimTimeoutMin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!settings) {
      return res.status(404).json({ message: "Country settings introuvables" });
    }
    return res.json(settings);
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

    const updated = await prisma.countrySettings.upsert({
      where: { countryId },
      update: data,
      create: {
        countryId,
        minCartFcfa:
          data.minCartFcfa !== undefined ? data.minCartFcfa : 100,
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
