const prisma = require("../prisma");
const { pickCountryId } = require("../helpers/countryScope");

const DEFAULT_MARKETING = {
  slides: [
    { id: "slide-1", image: "/Slide1.png", active: true, title: "Slide 1", link: "" },
    { id: "slide-2", image: "/Slide2.png", active: true, title: "Slide 2", link: "" },
    { id: "slide-3", image: "/Slide3.png", active: true, title: "Slide 3", link: "" },
  ],
  sidePanels: {
    left: { title: "Panneau gauche", image: "", link: "", active: false, note: "" },
    right: { title: "Panneau droit", image: "", link: "", active: false, note: "" },
  },
  publishing: {
    frontendTarget: "frontend",
    environment: "preview",
    lastUpdatedBy: "",
    releaseNote: "",
  },
};

async function getStorefrontConfig(req, res) {
  try {
    const countryId = pickCountryId(req);

    const [settings, marketing] = await Promise.all([
      prisma.countrySettings.findUnique({
        where: { countryId },
        select: {
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
        },
      }),
      prisma.countryMarketingContent.findUnique({
        where: { countryId },
        select: {
          slidesJson: true,
          sidePanelsJson: true,
          publishingJson: true,
        },
      }),
    ]);

    return res.json({
      countryCode: req.country?.code || null,
      minCartFcfa: settings?.minCartFcfa ?? 100,
      supportPhone: settings?.supportPhone ?? null,
      pickupAddress: settings?.pickupAddress ?? null,
      payments: {
        wave: settings?.enableWave ?? true,
        orangeMoney: settings?.enableOrangeMoney ?? true,
        cash: settings?.enableCash ?? true,
      },
      delivery: {
        delivery: settings?.enableDelivery ?? true,
        pickup: settings?.enablePickup ?? true,
      },
      currencyLabel: settings?.currencyLabel ?? "FCFA",
      pricingDisclaimer:
        settings?.pricingDisclaimer ||
        "Les prix affichés sont indicatifs. Le montant final est confirmé par le facturier à partir de l'AS400.",
      theme: {
        primaryColor: settings?.themePrimaryColor || "#FFC600",
        secondaryColor: settings?.themeSecondaryColor || "#74AA50",
        darkColor: settings?.themeDarkColor || "#000000",
        logoPath: settings?.themeLogoPath || "/logo-forever.png",
        sliderEnabled: settings?.themeSliderEnabled ?? true,
        sidePanelsEnabled: settings?.themeSidePanelsEnabled ?? true,
      },
      marketing: {
        slides: Array.isArray(marketing?.slidesJson)
          ? marketing.slidesJson
          : DEFAULT_MARKETING.slides,
        sidePanels: marketing?.sidePanelsJson || DEFAULT_MARKETING.sidePanels,
        publishing: marketing?.publishingJson || DEFAULT_MARKETING.publishing,
      },
    });
  } catch (e) {
    console.error("getStorefrontConfig error:", e);
    return res.status(500).json({ message: "Erreur serveur (getStorefrontConfig)" });
  }
}

module.exports = {
  getStorefrontConfig,
};
