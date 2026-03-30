const prisma = require("../../prisma");
const { pickCountryId } = require("../../helpers/countryScope");

const DEFAULT_PAYLOAD = {
  slides: [
    {
      id: "slide-1",
      title: "Slide 1",
      image: "/Slide1.png",
      link: "",
      active: true,
      note: "Slide principal du catalogue FBO.",
    },
    {
      id: "slide-2",
      title: "Slide 2",
      image: "/Slide2.png",
      link: "",
      active: true,
      note: "Slide secondaire du catalogue FBO.",
    },
    {
      id: "slide-3",
      title: "Slide 3",
      image: "/Slide3.png",
      link: "",
      active: true,
      note: "Slide tertiaire du catalogue FBO.",
    },
  ],
  sidePanels: {
    left: {
      title: "Panneau gauche",
      image: "",
      link: "",
      active: false,
      note: "Zone desktop pour future campagne.",
    },
    right: {
      title: "Panneau droit",
      image: "",
      link: "",
      active: false,
      note: "Zone desktop pour future campagne.",
    },
  },
  publishing: {
    frontendTarget: "frontend",
    environment: "preview",
    lastUpdatedBy: "",
    releaseNote: "",
  },
};

function sanitizePayload(raw) {
  const payload = raw || {};
  return {
    slides: Array.isArray(payload.slides) ? payload.slides : DEFAULT_PAYLOAD.slides,
    sidePanels: payload.sidePanels || DEFAULT_PAYLOAD.sidePanels,
    publishing: payload.publishing || DEFAULT_PAYLOAD.publishing,
  };
}

async function getMarketingCampaigns(req, res) {
  try {
    const countryId = pickCountryId(req);
    const content = await prisma.countryMarketingContent.findUnique({
      where: { countryId },
      select: {
        id: true,
        countryId: true,
        slidesJson: true,
        sidePanelsJson: true,
        publishingJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!content) {
      return res.json({
        countryId,
        ...DEFAULT_PAYLOAD,
        createdAt: null,
        updatedAt: null,
      });
    }

    const payload = sanitizePayload({
      slides: content.slidesJson,
      sidePanels: content.sidePanelsJson,
      publishing: content.publishingJson,
    });

    return res.json({
      id: content.id,
      countryId: content.countryId,
      ...payload,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
    });
  } catch (e) {
    console.error("getMarketingCampaigns error:", e);
    return res.status(500).json({ message: "Erreur serveur (getMarketingCampaigns)" });
  }
}

async function updateMarketingCampaigns(req, res) {
  try {
    const countryId = pickCountryId(req);
    const payload = sanitizePayload(req.body || {});

    const updated = await prisma.countryMarketingContent.upsert({
      where: { countryId },
      update: {
        slidesJson: payload.slides,
        sidePanelsJson: payload.sidePanels,
        publishingJson: payload.publishing,
      },
      create: {
        countryId,
        slidesJson: payload.slides,
        sidePanelsJson: payload.sidePanels,
        publishingJson: payload.publishing,
      },
      select: {
        id: true,
        countryId: true,
        slidesJson: true,
        sidePanelsJson: true,
        publishingJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      id: updated.id,
      countryId: updated.countryId,
      slides: updated.slidesJson,
      sidePanels: updated.sidePanelsJson,
      publishing: updated.publishingJson,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (e) {
    console.error("updateMarketingCampaigns error:", e);
    return res.status(500).json({ message: "Erreur serveur (updateMarketingCampaigns)" });
  }
}

module.exports = {
  getMarketingCampaigns,
  updateMarketingCampaigns,
};
