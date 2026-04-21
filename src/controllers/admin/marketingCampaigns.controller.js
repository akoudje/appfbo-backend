const multer = require("multer");
const prisma = require("../../prisma");
const { pickCountryId } = require("../../helpers/countryScope");
const { uploadBuffer } = require("../../services/cloudinary");

const MAX_SLIDES = 3;
const MAX_TITLE_LENGTH = 80;
const MAX_NOTE_LENGTH = 240;
const MAX_LINK_LENGTH = 500;
const MAX_IMAGE_LENGTH = 350_000;
const MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_PUBLISHING_ENVIRONMENTS = new Set(["preview", "production"]);
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

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

const DEFAULT_PUBLISHING_METADATA = {
  frontendTarget: "frontend",
  environment: "preview",
  lastUpdatedBy: "",
  releaseNote: "",
  draftSavedAt: null,
  publishedAt: null,
  publishedBy: "",
  hasUnpublishedChanges: false,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_UPLOAD_MIME_TYPES.has(String(file.mimetype || "").toLowerCase());
    cb(ok ? null : new Error("Format image non supporté (png/jpg/webp/gif)"), ok);
  },
});

function createValidationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function sanitizeSlug(value, fallback) {
  const normalized = String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function uploadMarketingAssetMiddleware(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Le fichier dépasse 5 MB." });
    }
    return res.status(400).json({ message: err.message || "Upload invalide" });
  });
}

function normalizeTrimmedString(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function normalizeTextField(value, { fallback = "", maxLength }) {
  const normalized = normalizeTrimmedString(value, fallback);
  return normalized.slice(0, maxLength);
}

function isAllowedLink(value) {
  if (!value) return true;
  if (value.startsWith("/")) return true;
  if (value.startsWith("#")) return true;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isAllowedImageSource(value) {
  if (!value) return true;
  if (value.startsWith("/")) return true;

  if (value.startsWith("data:")) {
    return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validateLink(value, fieldLabel) {
  if (!isAllowedLink(value)) {
    throw createValidationError(`${fieldLabel} invalide. Utilisez un chemin local ou une URL http(s).`);
  }
}

function validateImageSource(value, fieldLabel) {
  if (!isAllowedImageSource(value)) {
    throw createValidationError(
      `${fieldLabel} invalide. Utilisez une image locale, une URL http(s) ou une image data:image/*.`,
    );
  }

  if (value && value.length > MAX_IMAGE_LENGTH) {
    throw createValidationError(
      `${fieldLabel} trop volumineuse. Réduisez la taille du visuel avant enregistrement.`,
    );
  }
}

function normalizeSlide(rawSlide, defaultSlide, index) {
  const image = normalizeTrimmedString(rawSlide?.image, defaultSlide.image);
  const link = normalizeTrimmedString(rawSlide?.link, "");
  validateImageSource(image, `Image du slide ${index + 1}`);
  validateLink(link, `Lien du slide ${index + 1}`);

  return {
    id: defaultSlide.id,
    title: normalizeTextField(rawSlide?.title, {
      fallback: defaultSlide.title,
      maxLength: MAX_TITLE_LENGTH,
    }),
    image,
    link: link.slice(0, MAX_LINK_LENGTH),
    active: rawSlide?.active !== false,
    note: normalizeTextField(rawSlide?.note, {
      fallback: defaultSlide.note,
      maxLength: MAX_NOTE_LENGTH,
    }),
  };
}

function normalizePanel(rawPanel, defaultPanel, label) {
  const image = normalizeTrimmedString(rawPanel?.image, defaultPanel.image);
  const link = normalizeTrimmedString(rawPanel?.link, "");
  validateImageSource(image, `Image du ${label}`);
  validateLink(link, `Lien du ${label}`);

  return {
    title: normalizeTextField(rawPanel?.title, {
      fallback: defaultPanel.title,
      maxLength: MAX_TITLE_LENGTH,
    }),
    image,
    link: link.slice(0, MAX_LINK_LENGTH),
    active: Boolean(rawPanel?.active),
    note: normalizeTextField(rawPanel?.note, {
      fallback: defaultPanel.note,
      maxLength: MAX_NOTE_LENGTH,
    }),
  };
}

function normalizePublishing(rawPublishing = {}) {
  const environment = normalizeTrimmedString(
    rawPublishing.environment,
    DEFAULT_PAYLOAD.publishing.environment,
  ).toLowerCase();

  return {
    frontendTarget: normalizeTextField(rawPublishing.frontendTarget, {
      fallback: DEFAULT_PAYLOAD.publishing.frontendTarget,
      maxLength: 40,
    }),
    environment: ALLOWED_PUBLISHING_ENVIRONMENTS.has(environment)
      ? environment
      : DEFAULT_PAYLOAD.publishing.environment,
    lastUpdatedBy: normalizeTextField(rawPublishing.lastUpdatedBy, {
      fallback: "",
      maxLength: 120,
    }),
    releaseNote: normalizeTextField(rawPublishing.releaseNote, {
      fallback: "",
      maxLength: 500,
    }),
    draftSavedAt:
      typeof rawPublishing.draftSavedAt === "string" ? rawPublishing.draftSavedAt : null,
    publishedAt:
      typeof rawPublishing.publishedAt === "string" ? rawPublishing.publishedAt : null,
    publishedBy: normalizeTextField(rawPublishing.publishedBy, {
      fallback: "",
      maxLength: 120,
    }),
    hasUnpublishedChanges: Boolean(rawPublishing.hasUnpublishedChanges),
  };
}

function sanitizePayload(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const rawSlides = Array.isArray(payload.slides) ? payload.slides.slice(0, MAX_SLIDES) : [];

  const slides = DEFAULT_PAYLOAD.slides.map((defaultSlide, index) =>
    normalizeSlide(rawSlides[index] || {}, defaultSlide, index),
  );

  return {
    slides,
    sidePanels: {
      left: normalizePanel(
        payload.sidePanels?.left || {},
        DEFAULT_PAYLOAD.sidePanels.left,
        "panneau gauche",
      ),
      right: normalizePanel(
        payload.sidePanels?.right || {},
        DEFAULT_PAYLOAD.sidePanels.right,
        "panneau droit",
      ),
    },
    publishing: normalizePublishing(payload.publishing || {}),
  };
}

function readStoredMarketingContent(content) {
  const publishing = normalizePublishing(content?.publishingJson || {});
  const draftContent =
    publishing && typeof content?.publishingJson?.draftContent === "object"
      ? content.publishingJson.draftContent
      : null;

  const editorPayload = sanitizePayload({
    slides: draftContent?.slides || content?.slidesJson,
    sidePanels: draftContent?.sidePanels || content?.sidePanelsJson,
    publishing,
  });

  const publishedPayload = sanitizePayload({
    slides: content?.slidesJson,
    sidePanels: content?.sidePanelsJson,
    publishing,
  });

  return {
    editorPayload,
    publishedPayload,
    publishing,
  };
}

function buildPublishingRecord({
  currentPublishing,
  editorPayload,
  actorEmail,
  published = false,
}) {
  const nowIso = new Date().toISOString();
  return {
    ...DEFAULT_PUBLISHING_METADATA,
    ...currentPublishing,
    frontendTarget: editorPayload.publishing.frontendTarget,
    environment: editorPayload.publishing.environment,
    lastUpdatedBy: actorEmail || editorPayload.publishing.lastUpdatedBy || "",
    releaseNote: editorPayload.publishing.releaseNote,
    draftSavedAt: nowIso,
    publishedAt: published ? nowIso : currentPublishing?.publishedAt || null,
    publishedBy: published
      ? actorEmail || currentPublishing?.publishedBy || ""
      : currentPublishing?.publishedBy || "",
    hasUnpublishedChanges: !published,
    draftContent: {
      slides: editorPayload.slides,
      sidePanels: editorPayload.sidePanels,
    },
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
        publishedSlides: DEFAULT_PAYLOAD.slides,
        publishedSidePanels: DEFAULT_PAYLOAD.sidePanels,
        publishing: DEFAULT_PUBLISHING_METADATA,
        createdAt: null,
        updatedAt: null,
      });
    }

    const { editorPayload, publishedPayload, publishing } = readStoredMarketingContent(content);

    return res.json({
      id: content.id,
      countryId: content.countryId,
      ...editorPayload,
      publishedSlides: publishedPayload.slides,
      publishedSidePanels: publishedPayload.sidePanels,
      publishing,
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
    const actorEmail = String(req.user?.email || "").trim();
    const existing = await prisma.countryMarketingContent.findUnique({
      where: { countryId },
      select: {
        slidesJson: true,
        sidePanelsJson: true,
        publishingJson: true,
      },
    });
    const currentPublishing = normalizePublishing(existing?.publishingJson || {});
    const nextPublishing = buildPublishingRecord({
      currentPublishing,
      editorPayload: payload,
      actorEmail,
      published: false,
    });

    const updated = await prisma.countryMarketingContent.upsert({
      where: { countryId },
      update: {
        publishingJson: nextPublishing,
      },
      create: {
        countryId,
        slidesJson: DEFAULT_PAYLOAD.slides,
        sidePanelsJson: DEFAULT_PAYLOAD.sidePanels,
        publishingJson: nextPublishing,
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
      slides: payload.slides,
      sidePanels: payload.sidePanels,
      publishedSlides: updated.slidesJson,
      publishedSidePanels: updated.sidePanelsJson,
      publishing: nextPublishing,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (e) {
    console.error("updateMarketingCampaigns error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (updateMarketingCampaigns)" });
  }
}

async function publishMarketingCampaigns(req, res) {
  try {
    const countryId = pickCountryId(req);
    const actorEmail = String(req.user?.email || "").trim();
    const existing = await prisma.countryMarketingContent.findUnique({
      where: { countryId },
      select: {
        id: true,
        slidesJson: true,
        sidePanelsJson: true,
        publishingJson: true,
      },
    });

    const sourcePayload =
      req.body && Object.keys(req.body || {}).length > 0
        ? sanitizePayload(req.body)
        : readStoredMarketingContent(existing || {}).editorPayload;

    const currentPublishing = normalizePublishing(existing?.publishingJson || {});
    const nextPublishing = buildPublishingRecord({
      currentPublishing,
      editorPayload: sourcePayload,
      actorEmail,
      published: true,
    });
    nextPublishing.hasUnpublishedChanges = false;

    const published = await prisma.countryMarketingContent.upsert({
      where: { countryId },
      update: {
        slidesJson: sourcePayload.slides,
        sidePanelsJson: sourcePayload.sidePanels,
        publishingJson: nextPublishing,
      },
      create: {
        countryId,
        slidesJson: sourcePayload.slides,
        sidePanelsJson: sourcePayload.sidePanels,
        publishingJson: nextPublishing,
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
      id: published.id,
      countryId: published.countryId,
      slides: sourcePayload.slides,
      sidePanels: sourcePayload.sidePanels,
      publishedSlides: published.slidesJson,
      publishedSidePanels: published.sidePanelsJson,
      publishing: nextPublishing,
      createdAt: published.createdAt,
      updatedAt: published.updatedAt,
    });
  } catch (e) {
    console.error("publishMarketingCampaigns error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (publishMarketingCampaigns)" });
  }
}

async function uploadMarketingAsset(req, res) {
  try {
    const countryId = pickCountryId(req);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "Fichier requis" });
    }

    const slot = sanitizeSlug(req.body?.slot, "marketing-asset");
    const uploadResult = await uploadBuffer(file.buffer, {
      folder: `appfbo/marketing/${countryId}`,
      resource_type: "image",
      use_filename: true,
      unique_filename: true,
      filename_override: `${slot}-${Date.now()}`,
    });

    const url = uploadResult?.secure_url || uploadResult?.url || null;
    if (!url) {
      throw new Error("UPLOAD_MARKETING_ASSET_FAILED");
    }

    return res.status(201).json({
      ok: true,
      url,
      width: uploadResult?.width || null,
      height: uploadResult?.height || null,
      bytes: uploadResult?.bytes || file.size || null,
      format: uploadResult?.format || null,
    });
  } catch (e) {
    console.error("uploadMarketingAsset error:", e);
    return res.status(e.statusCode || 500).json({
      message: e.message || "Erreur serveur (uploadMarketingAsset)",
    });
  }
}

module.exports = {
  getMarketingCampaigns,
  updateMarketingCampaigns,
  publishMarketingCampaigns,
  uploadMarketingAssetMiddleware,
  uploadMarketingAsset,
};
