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

function isCustomFboHelpTopicId(id) {
  return /^custom-[a-z0-9-]{6,80}$/.test(String(id || ""));
}

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
      label: String(item.label || "").trim() || "Aide",
      answer: String(item.answer || "").trim() || "",
    }));

  return [...systemTopics, ...customTopics];
}

async function getStorefrontConfig(req, res) {
  try {
    const countryId = pickCountryId(req);

    const [settings, marketing] = await Promise.all([
      prisma.countrySettings.findUnique({
        where: { countryId },
        select: {
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
          enableEcobankPay: true,
          ecobankPayMerchantName: true,
          ecobankPayMerchantId: true,
          ecobankPayTerminalName: true,
          ecobankPayTerminalId: true,
          ecobankPayQrImageUrl: true,
          ecobankPayInstructions: true,
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
          fboHelpTopics: true,
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
      maxQtyPerProduct: settings?.maxQtyPerProduct ?? 10,
      preorderSubmissionEnabled: settings?.preorderSubmissionEnabled ?? true,
      preorderSubmissionDisabledMessage:
        settings?.preorderSubmissionDisabledMessage ||
        "Les soumissions de précommandes sont temporairement suspendues. Vous pouvez continuer à consulter le catalogue et votre panier.",
      publicAnnouncement:
        settings?.publicAnnouncementEnabled && settings?.publicAnnouncementMessage
          ? {
              enabled: true,
              message: settings.publicAnnouncementMessage,
            }
          : {
              enabled: false,
              message: "",
            },
      closedOnSaturday: settings?.closedOnSaturday ?? false,
      supportPhone: settings?.supportPhone ?? null,
      pickupAddress: settings?.pickupAddress ?? null,
      payments: {
        wave: settings?.enableWave ?? true,
        orangeMoney: settings?.enableOrangeMoney ?? true,
        cash: settings?.enableCash ?? true,
        bankTransfer: settings?.enableBankTransfer ?? true,
        ecobankPay: settings?.enableEcobankPay ?? false,
      },
      ecobankPay: {
        merchantName: settings?.ecobankPayMerchantName || null,
        merchantId: settings?.ecobankPayMerchantId || null,
        terminalName: settings?.ecobankPayTerminalName || null,
        terminalId: settings?.ecobankPayTerminalId || null,
        qrImageUrl: settings?.ecobankPayQrImageUrl || null,
        instructions: settings?.ecobankPayInstructions || null,
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
      fboHelpTopics: normalizeFboHelpTopics(settings?.fboHelpTopics),
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
