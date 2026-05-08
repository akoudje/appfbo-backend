const crypto = require("crypto");
const multer = require("multer");
const prisma = require("../../prisma");
const { pickCountryId } = require("../../helpers/countryScope");
const { uploadBuffer } = require("../../services/cloudinary");
const { normalizePhone, sendSms } = require("../../services/sms.service");

const MARKETING_SMS_DELAY_MS = Math.max(
  0,
  parseInt(process.env.MARKETING_SMS_DELAY_MS || "300", 10),
);

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

const MAX_SLIDES = 3;
const MAX_SMS_CAMPAIGNS = 12;
const MAX_SMS_RECIPIENTS = 1000;
const MAX_MARKETING_SMS_LENGTH = 160;
const MAX_TITLE_LENGTH = 80;
const MAX_NOTE_LENGTH = 240;
const MAX_LINK_LENGTH = 500;
const MAX_SMS_MESSAGE_LENGTH = MAX_MARKETING_SMS_LENGTH;
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
  smsCampaigns: [],
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

function normalizeCampaignStatus(value = "") {
  const status = String(value || "").trim().toUpperCase();
  if (["DRAFT", "READY", "SENDING", "SENT", "PARTIAL", "FAILED", "CANCELLED"].includes(status)) {
    return status;
  }
  return "DRAFT";
}

function normalizeRecipientStatus(value = "") {
  const status = String(value || "").trim().toUpperCase();
  if (
    ["PENDING", "READY", "SENT", "FAILED", "SKIPPED", "INVALID", "CONFIRMED", "DECLINED"].includes(
      status,
    )
  ) {
    return status;
  }
  return "PENDING";
}

function normalizeMarketingPhone(value = "") {
  const normalized = normalizePhone(value);
  return /^\+225\d{10}$/.test(normalized) ? normalized : "";
}

function cryptoRandomToken() {
  return crypto.randomBytes(16).toString("hex");
}

function normalizeSmsRecipient(rawRecipient = {}, index = 0) {
  const phoneRaw = normalizeTextField(rawRecipient.phoneRaw || rawRecipient.phone, {
    fallback: "",
    maxLength: 40,
  });
  const phoneNormalized =
    normalizeMarketingPhone(rawRecipient.phoneNormalized || phoneRaw || rawRecipient.phone || "") || "";

  return {
    id: normalizeTextField(rawRecipient.id, {
      fallback: `recipient-${index + 1}`,
      maxLength: 80,
    }),
    nom: normalizeTextField(rawRecipient.nom || rawRecipient.name, {
      fallback: "",
      maxLength: 120,
    }),
    numeroFbo: normalizeTextField(rawRecipient.numeroFbo, {
      fallback: "",
      maxLength: 40,
    }),
    phoneRaw,
    phoneNormalized,
    ville: normalizeTextField(rawRecipient.ville || rawRecipient.city, {
      fallback: "",
      maxLength: 80,
    }),
    grade: normalizeTextField(rawRecipient.grade, {
      fallback: "",
      maxLength: 80,
    }),
    status: phoneNormalized ? normalizeRecipientStatus(rawRecipient.status || "READY") : "INVALID",
    providerMessageId: normalizeTextField(rawRecipient.providerMessageId, {
      fallback: "",
      maxLength: 700,
    }),
    rsvpToken: normalizeTextField(rawRecipient.rsvpToken, {
      fallback: cryptoRandomToken(),
      maxLength: 80,
    }),
    lastError: normalizeTextField(rawRecipient.lastError, {
      fallback: "",
      maxLength: 300,
    }),
    sentAt: typeof rawRecipient.sentAt === "string" ? rawRecipient.sentAt : null,
    respondedAt: typeof rawRecipient.respondedAt === "string" ? rawRecipient.respondedAt : null,
  };
}

function normalizeSmsCampaign(rawCampaign = {}, index = 0) {
  const nowIso = new Date().toISOString();
  const recipients = Array.isArray(rawCampaign.recipients)
    ? rawCampaign.recipients.slice(0, MAX_SMS_RECIPIENTS)
    : [];

  return {
    id: normalizeTextField(rawCampaign.id, {
      fallback: `sms-${Date.now()}-${index + 1}`,
      maxLength: 80,
    }),
    name: normalizeTextField(rawCampaign.name, {
      fallback: `Campagne SMS ${index + 1}`,
      maxLength: 120,
    }),
    type: normalizeTextField(rawCampaign.type, {
      fallback: "EVENT_INVITATION",
      maxLength: 60,
    }),
    eventName: normalizeTextField(rawCampaign.eventName, {
      fallback: "",
      maxLength: 160,
    }),
    eventDate: normalizeTextField(rawCampaign.eventDate, {
      fallback: "",
      maxLength: 40,
    }),
    location: normalizeTextField(rawCampaign.location, {
      fallback: "",
      maxLength: 160,
    }),
    confirmationLink: normalizeTextField(rawCampaign.confirmationLink, {
      fallback: "",
      maxLength: MAX_LINK_LENGTH,
    }),
    message: normalizeTextField(rawCampaign.message, {
      fallback:
        "FOREVER: Bonjour {{nom}}, invitation {{eventDate}} a {{location}}.",
      maxLength: MAX_SMS_MESSAGE_LENGTH,
    }),
    status: normalizeCampaignStatus(rawCampaign.status),
    testPhone: normalizeTextField(rawCampaign.testPhone, {
      fallback: "",
      maxLength: 40,
    }),
    recipients: recipients.map(normalizeSmsRecipient),
    createdAt: typeof rawCampaign.createdAt === "string" ? rawCampaign.createdAt : nowIso,
    updatedAt: typeof rawCampaign.updatedAt === "string" ? rawCampaign.updatedAt : nowIso,
    lastSentAt: typeof rawCampaign.lastSentAt === "string" ? rawCampaign.lastSentAt : null,
    lastTestAt: typeof rawCampaign.lastTestAt === "string" ? rawCampaign.lastTestAt : null,
  };
}

function normalizeSmsCampaigns(rawCampaigns = []) {
  if (!Array.isArray(rawCampaigns)) return [];
  return rawCampaigns.slice(0, MAX_SMS_CAMPAIGNS).map(normalizeSmsCampaign);
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
    smsCampaigns: normalizeSmsCampaigns(payload.smsCampaigns || []),
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
    smsCampaigns: draftContent?.smsCampaigns || content?.publishingJson?.smsCampaigns || [],
    publishing,
  });

  const publishedPayload = sanitizePayload({
    slides: content?.slidesJson,
    sidePanels: content?.sidePanelsJson,
    smsCampaigns: content?.publishingJson?.smsCampaigns || [],
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
      smsCampaigns: editorPayload.smsCampaigns,
    },
    smsCampaigns: editorPayload.smsCampaigns,
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
        smsCampaigns: DEFAULT_PAYLOAD.smsCampaigns,
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
      smsCampaigns: editorPayload.smsCampaigns,
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
      smsCampaigns: payload.smsCampaigns,
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
      smsCampaigns: sourcePayload.smsCampaigns,
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

function renderSmsTemplate(template = "", campaign = {}, recipient = {}) {
  const frontendBaseUrl = normalizePublicBaseUrl(
    process.env.FRONTEND_PUBLIC_URL ||
      process.env.APP_PUBLIC_BASE_URL ||
      process.env.APP_BASE_URL ||
      process.env.FRONTEND_URL ||
      "https://forevercivstore.com",
  );
  const rsvpLink = campaign.confirmationLink || buildShortRsvpLink(frontendBaseUrl, recipient);
  const replacements = {
    nom: recipient.nom || "FBO",
    numeroFbo: recipient.numeroFbo || "",
    eventName: campaign.eventName || campaign.name || "",
    eventDate: campaign.eventDate || "",
    location: campaign.location || "",
    link: rsvpLink,
  };

  const rendered = Object.entries(replacements).reduce(
    (message, [key, value]) =>
      message.replace(new RegExp(`{{\\s*${key}\\s*}}`, "gi"), String(value || "")),
    String(template || ""),
  );

  return compactMarketingSms(rendered, {
    recipient,
    campaign,
    link: rsvpLink,
  });
}

function normalizePublicBaseUrl(value = "") {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "https://forevercivstore.com";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch (_) {
    return "https://forevercivstore.com";
  }
}

function buildShortRsvpLink(frontendBaseUrl, recipient = {}) {
  return `${frontendBaseUrl}/e/${encodeURIComponent(recipient.rsvpToken || "")}`;
}

function compactSmsText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function compactMarketingSms(rendered = "", _options = {}) {
  const normalized = compactSmsText(rendered);
  return normalized.slice(0, MAX_MARKETING_SMS_LENGTH);
}

function buildMarketingSmsFallback({ recipient = {}, campaign = {}, includeLink = false } = {}) {
  const name = compactSmsText(recipient.nom || "FBO").slice(0, 24);
  const eventDate = compactSmsText(campaign.eventDate || "").slice(0, 28);
  const location = compactSmsText(campaign.location || "").slice(0, 28);
  const eventName = compactSmsText(campaign.eventName || campaign.name || "evenement").slice(0, 32);
  const link = includeLink
    ? buildShortRsvpLink(
        normalizePublicBaseUrl(
          process.env.FRONTEND_PUBLIC_URL ||
            process.env.APP_PUBLIC_BASE_URL ||
            process.env.APP_BASE_URL ||
            "https://forevercivstore.com",
        ),
        recipient,
      )
    : "";

  const candidates = [
    `FOREVER: ${name}, invitation ${eventName} ${eventDate} ${location}.${link ? ` Confirmez: ${link}` : ""}`,
    `FOREVER: Invitation ${eventName} ${eventDate} ${location}.${link ? ` Confirmez: ${link}` : ""}`,
    `FOREVER: Invitation evenement ${eventDate} ${location}.`,
    "FOREVER: Vous etes invite(e) a un evenement. Merci de vous rapprocher de votre responsable.",
  ].map(compactSmsText);

  return (
    candidates.find((candidate) => candidate.length <= MAX_MARKETING_SMS_LENGTH) ||
    candidates[candidates.length - 1].slice(0, MAX_MARKETING_SMS_LENGTH)
  );
}

async function sendMarketingSmsWithFallback({ to, campaign, recipient, callbackData }) {
  const primaryMessage = renderSmsTemplate(campaign.message, campaign, recipient);
  const messageDiagnostics = buildSmsMessageDiagnostics(primaryMessage);
  const primaryResult = await sendSms({
    to,
    message: primaryMessage,
    callbackData,
  });

  return {
    ...primaryResult,
    fallbackUsed: false,
    sentMessageLength: primaryMessage.length,
    messageDiagnostics,
  };
}

function buildSmsMessageDiagnostics(message = "") {
  const text = String(message || "");
  return {
    length: text.length,
    preview: text.slice(0, 120),
    nonAsciiChars: Array.from(new Set(text.match(/[^\x20-\x7E]/g) || [])).slice(0, 12),
  };
}

async function loadEditorPayload(countryId) {
  const existing = await prisma.countryMarketingContent.findUnique({
    where: { countryId },
    select: {
      slidesJson: true,
      sidePanelsJson: true,
      publishingJson: true,
    },
  });

  return {
    existing,
    payload: existing
      ? readStoredMarketingContent(existing).editorPayload
      : sanitizePayload(DEFAULT_PAYLOAD),
  };
}

async function saveEditorPayload({ countryId, payload, existing, actorEmail }) {
  const currentPublishing = normalizePublishing(existing?.publishingJson || {});
  const nextPublishing = buildPublishingRecord({
    currentPublishing,
    editorPayload: payload,
    actorEmail,
    published: false,
  });

  await prisma.countryMarketingContent.upsert({
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
  });

  return nextPublishing;
}

async function sendSmsCampaignTest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const campaignId = String(req.params.campaignId || "").trim();
    const actorEmail = String(req.user?.email || "").trim();
    const { existing, payload } = await loadEditorPayload(countryId);
    const campaignIndex = payload.smsCampaigns.findIndex((campaign) => campaign.id === campaignId);

    if (campaignIndex < 0) {
      return res.status(404).json({ message: "Campagne SMS introuvable." });
    }

    const campaign = payload.smsCampaigns[campaignIndex];
    const testPhone = normalizeMarketingPhone(req.body?.phone || campaign.testPhone || "");
    if (!testPhone) {
      return res.status(400).json({ message: "Numero de test invalide." });
    }

    const sampleRecipient = campaign.recipients.find((recipient) => recipient.phoneNormalized) || {};
    const result = await sendMarketingSmsWithFallback({
      to: testPhone,
      campaign,
      recipient: sampleRecipient,
      callbackData: `marketing_test_${campaign.id}`,
    });

    const updatedCampaign = {
      ...campaign,
      testPhone,
      lastTestAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    payload.smsCampaigns[campaignIndex] = normalizeSmsCampaign(updatedCampaign, campaignIndex);
    await saveEditorPayload({ countryId, payload, existing, actorEmail });

    return res.json({
      ok: Boolean(result.accepted),
      result,
      campaign: payload.smsCampaigns[campaignIndex],
    });
  } catch (e) {
    console.error("sendSmsCampaignTest error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (sendSmsCampaignTest)" });
  }
}

async function processCampaignSends({ countryId, campaignId, actorEmail, failedOnly }) {
  try {
    const { existing, payload } = await loadEditorPayload(countryId);
    const campaignIndex = payload.smsCampaigns.findIndex((c) => c.id === campaignId);
    if (campaignIndex < 0) {
      console.error("[campaign][sms] campaign not found during background processing", { campaignId });
      return;
    }

    const campaign = payload.smsCampaigns[campaignIndex];
    const sentAt = new Date().toISOString();
    const nextRecipients = [];
    let sentCount = 0;
    let failedCount = 0;
    let sendIndex = 0;

    for (const recipient of campaign.recipients) {
      if (!recipient.phoneNormalized) {
        nextRecipients.push({ ...recipient, status: "INVALID", lastError: "Numero invalide" });
        continue;
      }

      const recipientStatus = String(recipient.status || "").toUpperCase();

      if (failedOnly && recipientStatus !== "FAILED") {
        nextRecipients.push(recipient);
        continue;
      }

      if (["SENT", "SKIPPED"].includes(recipientStatus)) {
        nextRecipients.push(recipient);
        continue;
      }

      if (MARKETING_SMS_DELAY_MS > 0 && sendIndex > 0) {
        await sleep(MARKETING_SMS_DELAY_MS);
      }
      sendIndex += 1;

      const result = await sendMarketingSmsWithFallback({
        to: recipient.phoneNormalized,
        campaign,
        recipient,
        callbackData: `marketing_${campaign.id}_${recipient.id}`,
      });

      console.log("[campaign][sms] recipient result", {
        campaignId,
        recipientId: recipient.id,
        phone: recipient.phoneNormalized,
        accepted: result.accepted,
        message: result.messageDiagnostics,
        ...(result.accepted ? {} : { errorCode: result.errorCode, errorMessage: result.errorMessage }),
      });

      if (result.accepted) {
        sentCount += 1;
        nextRecipients.push({
          ...recipient,
          status: "SENT",
          providerMessageId: result.providerMessageId || "",
          lastError: "",
          sentAt,
        });
      } else {
        failedCount += 1;
        nextRecipients.push({
          ...recipient,
          status: "FAILED",
          providerMessageId: "",
          lastError: result.errorMessage || result.errorCode || "Echec envoi SMS",
          sentAt: null,
        });
      }
    }

    const finalStatus = failedCount && sentCount ? "PARTIAL" : failedCount ? "FAILED" : "SENT";
    const updatedCampaign = normalizeSmsCampaign(
      {
        ...campaign,
        recipients: nextRecipients,
        status: finalStatus,
        lastSentAt: sentAt,
        updatedAt: new Date().toISOString(),
      },
      campaignIndex,
    );

    const { existing: freshExisting, payload: freshPayload } = await loadEditorPayload(countryId);
    const freshIndex = freshPayload.smsCampaigns.findIndex((c) => c.id === campaignId);
    if (freshIndex < 0) {
      console.error("[campaign][sms] campaign lost before final save", { campaignId });
      return;
    }
    freshPayload.smsCampaigns[freshIndex] = updatedCampaign;
    await saveEditorPayload({ countryId, payload: freshPayload, existing: freshExisting, actorEmail });

    console.log("[campaign][sms] send complete", { campaignId, sentCount, failedCount, status: finalStatus });
  } catch (err) {
    console.error("[campaign][sms] processCampaignSends error", { campaignId, error: err.message });
    try {
      const { existing, payload } = await loadEditorPayload(countryId);
      const idx = payload.smsCampaigns.findIndex((c) => c.id === campaignId);
      if (idx >= 0 && String(payload.smsCampaigns[idx].status || "").toUpperCase() === "SENDING") {
        payload.smsCampaigns[idx] = normalizeSmsCampaign(
          { ...payload.smsCampaigns[idx], status: "FAILED", updatedAt: new Date().toISOString() },
          idx,
        );
        await saveEditorPayload({ countryId, payload, existing, actorEmail });
      }
    } catch (saveErr) {
      console.error("[campaign][sms] failed to mark campaign as FAILED:", saveErr.message);
    }
  }
}

async function sendSmsCampaign(req, res) {
  try {
    const countryId = pickCountryId(req);
    const campaignId = String(req.params.campaignId || "").trim();
    const actorEmail = String(req.user?.email || "").trim();
    const { existing, payload } = await loadEditorPayload(countryId);
    const campaignIndex = payload.smsCampaigns.findIndex((campaign) => campaign.id === campaignId);

    if (campaignIndex < 0) {
      return res.status(404).json({ message: "Campagne SMS introuvable." });
    }

    const campaign = payload.smsCampaigns[campaignIndex];

    if (String(campaign.status || "").toUpperCase() === "SENDING") {
      return res.status(409).json({ message: "Un envoi est deja en cours pour cette campagne." });
    }

    const failedOnly = Boolean(req.body?.failedOnly);
    const eligibleCount = campaign.recipients.filter(
      (recipient) =>
        recipient.phoneNormalized &&
        (failedOnly
          ? String(recipient.status || "").toUpperCase() === "FAILED"
          : !["SENT", "SKIPPED"].includes(String(recipient.status || "").toUpperCase())),
    ).length;

    if (!eligibleCount) {
      return res.status(400).json({
        message: failedOnly
          ? "Aucun destinataire en echec a renvoyer."
          : "Aucun destinataire valide a envoyer.",
      });
    }

    const sendingCampaign = normalizeSmsCampaign(
      { ...campaign, status: "SENDING", updatedAt: new Date().toISOString() },
      campaignIndex,
    );
    payload.smsCampaigns[campaignIndex] = sendingCampaign;
    await saveEditorPayload({ countryId, payload, existing, actorEmail });

    res.status(202).json({
      sending: true,
      total: eligibleCount,
      campaign: sendingCampaign,
    });

    setImmediate(() => {
      processCampaignSends({ countryId, campaignId, actorEmail, failedOnly }).catch((err) => {
        console.error("[campaign][sms] unhandled background error:", err);
      });
    });
  } catch (e) {
    console.error("sendSmsCampaign error:", e);
    if (!res.headersSent) {
      return res
        .status(e.statusCode || 500)
        .json({ message: e.message || "Erreur serveur (sendSmsCampaign)" });
    }
  }
}

async function findSmsCampaignRecipient({ campaignId, recipientId, token }) {
  const rows = await prisma.countryMarketingContent.findMany({
    select: {
      id: true,
      countryId: true,
      slidesJson: true,
      sidePanelsJson: true,
      publishingJson: true,
    },
  });

  for (const row of rows) {
    const payload = readStoredMarketingContent(row).editorPayload;
    const campaignIndex = payload.smsCampaigns.findIndex((campaign) => campaign.id === campaignId);
    if (campaignIndex < 0) continue;

    const campaign = payload.smsCampaigns[campaignIndex];
    const recipientIndex = campaign.recipients.findIndex(
      (recipient) => recipient.id === recipientId && recipient.rsvpToken === token,
    );
    if (recipientIndex < 0) continue;

    return {
      content: row,
      payload,
      campaign,
      campaignIndex,
      recipient: campaign.recipients[recipientIndex],
      recipientIndex,
    };
  }

  return null;
}

async function findSmsCampaignRecipientByToken(token) {
  const rows = await prisma.countryMarketingContent.findMany({
    select: {
      id: true,
      countryId: true,
      slidesJson: true,
      sidePanelsJson: true,
      publishingJson: true,
    },
  });

  for (const row of rows) {
    const payload = readStoredMarketingContent(row).editorPayload;
    for (let campaignIndex = 0; campaignIndex < payload.smsCampaigns.length; campaignIndex += 1) {
      const campaign = payload.smsCampaigns[campaignIndex];
      const recipientIndex = campaign.recipients.findIndex(
        (recipient) => recipient.rsvpToken === token,
      );
      if (recipientIndex < 0) continue;

      return {
        content: row,
        payload,
        campaign,
        campaignIndex,
        recipient: campaign.recipients[recipientIndex],
        recipientIndex,
      };
    }
  }

  return null;
}

async function getSmsCampaignRsvp(req, res) {
  try {
    const campaignId = String(req.params.campaignId || "").trim();
    const recipientId = String(req.params.recipientId || "").trim();
    const token = String(req.params.token || "").trim();
    const found = await findSmsCampaignRecipient({ campaignId, recipientId, token });

    if (!found) {
      return res.status(404).json({ message: "Invitation introuvable ou expiree." });
    }

    return res.json({
      campaign: {
        id: found.campaign.id,
        name: found.campaign.name,
        eventName: found.campaign.eventName,
        eventDate: found.campaign.eventDate,
        location: found.campaign.location,
      },
      recipient: {
        id: found.recipient.id,
        nom: found.recipient.nom,
        numeroFbo: found.recipient.numeroFbo,
        status: found.recipient.status,
        respondedAt: found.recipient.respondedAt,
      },
    });
  } catch (e) {
    console.error("getSmsCampaignRsvp error:", e);
    return res.status(500).json({ message: "Erreur serveur (getSmsCampaignRsvp)" });
  }
}

async function getSmsCampaignRsvpByToken(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    const found = await findSmsCampaignRecipientByToken(token);

    if (!found) {
      return res.status(404).json({ message: "Invitation introuvable ou expiree." });
    }

    return res.json({
      campaign: {
        id: found.campaign.id,
        name: found.campaign.name,
        eventName: found.campaign.eventName,
        eventDate: found.campaign.eventDate,
        location: found.campaign.location,
      },
      recipient: {
        id: found.recipient.id,
        nom: found.recipient.nom,
        numeroFbo: found.recipient.numeroFbo,
        status: found.recipient.status,
        respondedAt: found.recipient.respondedAt,
      },
    });
  } catch (e) {
    console.error("getSmsCampaignRsvpByToken error:", e);
    return res.status(500).json({ message: "Erreur serveur (getSmsCampaignRsvpByToken)" });
  }
}

async function respondSmsCampaignRsvp(req, res) {
  try {
    const campaignId = String(req.params.campaignId || "").trim();
    const recipientId = String(req.params.recipientId || "").trim();
    const token = String(req.params.token || "").trim();
    const response = String(req.body?.response || "").trim().toUpperCase();
    const nextStatus = response === "DECLINED" ? "DECLINED" : "CONFIRMED";
    const found = await findSmsCampaignRecipient({ campaignId, recipientId, token });

    if (!found) {
      return res.status(404).json({ message: "Invitation introuvable ou expiree." });
    }

    const updatedRecipient = {
      ...found.recipient,
      status: nextStatus,
      respondedAt: new Date().toISOString(),
      lastError: "",
    };
    const nextRecipients = [...found.campaign.recipients];
    nextRecipients[found.recipientIndex] = updatedRecipient;
    const nextCampaign = normalizeSmsCampaign(
      {
        ...found.campaign,
        recipients: nextRecipients,
        updatedAt: new Date().toISOString(),
      },
      found.campaignIndex,
    );
    found.payload.smsCampaigns[found.campaignIndex] = nextCampaign;

    const nextPublishing = buildPublishingRecord({
      currentPublishing: normalizePublishing(found.content.publishingJson || {}),
      editorPayload: found.payload,
      actorEmail: "public-rsvp",
      published: false,
    });

    await prisma.countryMarketingContent.update({
      where: { id: found.content.id },
      data: { publishingJson: nextPublishing },
    });

    return res.json({
      ok: true,
      status: nextStatus,
      campaign: {
        id: nextCampaign.id,
        name: nextCampaign.name,
        eventName: nextCampaign.eventName,
        eventDate: nextCampaign.eventDate,
        location: nextCampaign.location,
      },
      recipient: {
        id: updatedRecipient.id,
        nom: updatedRecipient.nom,
        numeroFbo: updatedRecipient.numeroFbo,
        status: updatedRecipient.status,
        respondedAt: updatedRecipient.respondedAt,
      },
    });
  } catch (e) {
    console.error("respondSmsCampaignRsvp error:", e);
    return res.status(500).json({ message: "Erreur serveur (respondSmsCampaignRsvp)" });
  }
}

async function respondSmsCampaignRsvpByToken(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    const response = String(req.body?.response || "").trim().toUpperCase();
    const found = await findSmsCampaignRecipientByToken(token);

    if (!found) {
      return res.status(404).json({ message: "Invitation introuvable ou expiree." });
    }

    return saveSmsCampaignRsvpResponse({ found, response, res });
  } catch (e) {
    console.error("respondSmsCampaignRsvpByToken error:", e);
    return res.status(500).json({ message: "Erreur serveur (respondSmsCampaignRsvpByToken)" });
  }
}

async function saveSmsCampaignRsvpResponse({ found, response, res }) {
  const nextStatus = response === "DECLINED" ? "DECLINED" : "CONFIRMED";
  const updatedRecipient = {
    ...found.recipient,
    status: nextStatus,
    respondedAt: new Date().toISOString(),
    lastError: "",
  };
  const nextRecipients = [...found.campaign.recipients];
  nextRecipients[found.recipientIndex] = updatedRecipient;
  const nextCampaign = normalizeSmsCampaign(
    {
      ...found.campaign,
      recipients: nextRecipients,
      updatedAt: new Date().toISOString(),
    },
    found.campaignIndex,
  );
  found.payload.smsCampaigns[found.campaignIndex] = nextCampaign;

  const nextPublishing = buildPublishingRecord({
    currentPublishing: normalizePublishing(found.content.publishingJson || {}),
    editorPayload: found.payload,
    actorEmail: "public-rsvp",
    published: false,
  });

  await prisma.countryMarketingContent.update({
    where: { id: found.content.id },
    data: { publishingJson: nextPublishing },
  });

  return res.json({
    ok: true,
    status: nextStatus,
    campaign: {
      id: nextCampaign.id,
      name: nextCampaign.name,
      eventName: nextCampaign.eventName,
      eventDate: nextCampaign.eventDate,
      location: nextCampaign.location,
    },
    recipient: {
      id: updatedRecipient.id,
      nom: updatedRecipient.nom,
      numeroFbo: updatedRecipient.numeroFbo,
      status: updatedRecipient.status,
      respondedAt: updatedRecipient.respondedAt,
    },
  });
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
  sendSmsCampaignTest,
  sendSmsCampaign,
  getSmsCampaignRsvp,
  respondSmsCampaignRsvp,
  getSmsCampaignRsvpByToken,
  respondSmsCampaignRsvpByToken,
  uploadMarketingAssetMiddleware,
  uploadMarketingAsset,
};
