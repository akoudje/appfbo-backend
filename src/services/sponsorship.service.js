// src/services/sponsorship.service.js
// Parrainage : un FBO (Animateur adjoint et plus) inscrit un filleul majeur.
// Règles métier, stockage privé des pièces d'identité et passage automatique
// APPROVED_PENDING_PURCHASE -> VALIDATED / EXPIRED (voir schema.prisma).

const fs = require("fs");
const path = require("path");
const os = require("os");
const multer = require("multer");
const prisma = require("../prisma");
const { cloudinary, uploadFile } = require("./cloudinary");
const { sendSms, normalizePhoneForCountry } = require("./sms.service");

const MIN_RECRUIT_AGE = 18;
const SPONSOR_ALLOWED_GRADES = new Set(["ANIMATEUR_ADJOINT", "ANIMATEUR", "MANAGER_ADJOINT", "MANAGER"]);
const CONSENT_VERSION = "sponsorship-consent-v1";
const DOCUMENT_FIELDS = { idFront: "ID_FRONT", idBack: "ID_BACK", passport: "PASSPORT", other: "OTHER" };
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"]);
const MIME_FORMATS = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
const TMP_DIR = path.join(os.tmpdir(), "appfbo-sponsorships");

// Pièces d'identité acceptées (toutes portent la date de naissance).
const ID_DOCUMENT_LABELS = {
  CNI: "Carte nationale d'identité",
  PASSPORT: "Passeport",
  DRIVING_LICENSE: "Permis de conduire",
  CONSULAR_CARD: "Carte consulaire",
  OTHER: "Autre pièce officielle",
};

// Un email (ou une pièce) ne peut servir qu'à un parrainage en cours, approuvé
// ou validé ; un parrainage refusé ou expiré le libère.
const ACTIVE_SPONSORSHIP_STATUSES = ["SUBMITTED", "CHANGES_REQUESTED", "APPROVED_PENDING_PURCHASE", "VALIDATED"];

const STATUS_LABELS = {
  DRAFT: "Brouillon",
  SUBMITTED: "Soumis",
  CHANGES_REQUESTED: "Complément demandé",
  APPROVED_PENDING_PURCHASE: "Approuvé, en attente d'achat",
  VALIDATED: "Parrainage validé",
  REJECTED: "Refusé",
  EXPIRED: "Expiré",
};

function httpError(statusCode, message, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function canonicalFboNumber(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 12) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
}

function buildConsentText({ recruitName, countryName }) {
  return (
    `J'atteste disposer de l'accord et de la procuration de ${recruitName} pour l'inscrire ` +
    `comme distributeur et transmettre ses informations et sa pièce d'identité à ` +
    `Forever Living Products ${countryName || ""}. Je certifie que ces informations sont exactes ` +
    `et que ${recruitName} n'a pas signé de contrat Distributeur Forever au cours des 24 derniers mois.`
  ).replace(/\s+/g, " ").trim();
}

// Âge révolu à la date de référence (dates sans heure, en UTC).
function ageOn(birthDate, reference = new Date()) {
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    reference.getUTCMonth() < birth.getUTCMonth() ||
    (reference.getUTCMonth() === birth.getUTCMonth() && reference.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};
const bool = (value) => (value === true || value === "true" ? true : value === false || value === "false" ? false : null);

// Normalise et contrôle la fiche saisie par le parrain. Lève une 400 lisible.
// Code pays interne -> code ISO alpha-2 (pays de résidence du filleul).
const COUNTRY_ALPHA2 = { CIV: "CI", BFA: "BF", TGO: "TG", BEN: "BJ", NER: "NE" };

function normalizeRecruitPayload(raw = {}, { countryCode = "CIV", now = new Date() } = {}) {
  const errors = [];
  const required = (key, label) => {
    const value = text(raw[key]);
    if (!value) errors.push(`${label} est obligatoire.`);
    return value;
  };

  const lastName = required("lastName", "Le nom");
  const firstNames = required("firstNames", "Le prénom");
  const birthPlace = required("birthPlace", "Le lieu de naissance");
  const idDocumentType = String(raw.idDocumentType || "CNI").trim().toUpperCase();
  if (!ID_DOCUMENT_LABELS[idDocumentType]) errors.push("Le type de pièce d'identité est invalide.");
  const idDocumentNumber = required("idDocumentNumber", "Le n° de la pièce d'identité");
  const city = required("city", "La ville");
  const mobileRaw = required("mobile", "Le téléphone mobile");

  const birthDate = parseDateOnly(raw.birthDate);
  if (!birthDate) {
    errors.push("La date de naissance est obligatoire (AAAA-MM-JJ).");
  } else {
    const age = ageOn(birthDate, now);
    if (age === null || age < 0 || age > 120) errors.push("La date de naissance est invalide.");
    else if (age < MIN_RECRUIT_AGE) errors.push(`Le filleul doit avoir au moins ${MIN_RECRUIT_AGE} ans (âge actuel : ${age} ans).`);
  }

  const mobile = mobileRaw ? normalizePhoneForCountry(mobileRaw, countryCode) : null;
  if (mobileRaw && !mobile) errors.push("Le numéro de téléphone mobile est invalide.");

  const sponsorPhoneRaw = required("sponsorPhone", "Votre téléphone (parrain)");
  const sponsorPhone = sponsorPhoneRaw ? normalizePhoneForCountry(sponsorPhoneRaw, countryCode) : null;
  if (sponsorPhoneRaw && !sponsorPhone) errors.push("Votre numéro de téléphone (parrain) est invalide.");

  // Email obligatoire : canal de contact du filleul (notifications de commande).
  const email = required("email", "L'email du filleul")?.toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("L'adresse email est invalide.");

  const childrenCount = raw.childrenCount === "" || raw.childrenCount == null ? null : Number.parseInt(raw.childrenCount, 10);
  if (childrenCount !== null && (!Number.isFinite(childrenCount) || childrenCount < 0 || childrenCount > 50)) {
    errors.push("Le nombre d'enfants est invalide.");
  }

  const spouseBirthDate = raw.spouseBirthDate ? parseDateOnly(raw.spouseBirthDate) : null;
  if (raw.spouseBirthDate && !spouseBirthDate) errors.push("La date de naissance du conjoint est invalide.");
  const tradeRegisterDate = raw.tradeRegisterDate ? parseDateOnly(raw.tradeRegisterDate) : null;
  if (raw.tradeRegisterDate && !tradeRegisterDate) errors.push("La date du registre de commerce est invalide.");

  if (errors.length) throw httpError(400, errors.join(" "), "SPONSORSHIP_INVALID");

  return {
    lastName: lastName.toUpperCase(),
    firstNames: firstNames.toUpperCase(),
    birthDate,
    birthPlace,
    idDocumentType,
    idDocumentNumber: idDocumentNumber.toUpperCase().replace(/\s+/g, ""),
    passportNumber: text(raw.passportNumber)?.toUpperCase() || null,
    mobile,
    email,
    addressArea: text(raw.addressArea),
    city,
    postalBox: text(raw.postalBox),
    zoneCode: text(raw.zoneCode),
    homeCountry: text(raw.homeCountry) || COUNTRY_ALPHA2[countryCode] || "CI",
    maritalStatus: text(raw.maritalStatus),
    childrenCount,
    bankRib: text(raw.bankRib),
    spouseLastName: text(raw.spouseLastName)?.toUpperCase() || null,
    spouseFirstNames: text(raw.spouseFirstNames)?.toUpperCase() || null,
    spouseBirthDate,
    spouseBirthPlace: text(raw.spouseBirthPlace),
    profession: text(raw.profession),
    businessSector: text(raw.businessSector),
    tradeRegisterNumber: text(raw.tradeRegisterNumber),
    tradeRegisterDate,
    tradeRegisterPlace: text(raw.tradeRegisterPlace),
    vatSubject: bool(raw.vatSubject),
    asdiSubject: bool(raw.asdiSubject),
    sponsorCity: text(raw.sponsorCity),
    sponsorPhone: sponsorPhone || null,
  };
}

async function getSponsorshipSettings(countryId) {
  const settings = await prisma.countrySettings.findUnique({
    where: { countryId },
    select: {
      sponsorshipEnabled: true,
      sponsorshipMinPurchaseFcfa: true,
      sponsorshipPurchaseWindowHours: true,
      fboNumberPrefix: true,
      country: { select: { code: true, name: true } },
    },
  });
  return {
    enabled: Boolean(settings?.sponsorshipEnabled),
    minPurchaseFcfa: settings?.sponsorshipMinPurchaseFcfa ?? 53000,
    purchaseWindowHours: settings?.sponsorshipPurchaseWindowHours ?? 48,
    fboNumberPrefix: settings?.fboNumberPrefix || null,
    countryCode: settings?.country?.code || "CIV",
    countryName: settings?.country?.name || "",
  };
}

function isSponsorGradeAllowed(grade) {
  return SPONSOR_ALLOWED_GRADES.has(String(grade || "").toUpperCase());
}

// ---------------------------------------------------------------------------
// Pièces d'identité : stockage Cloudinary PRIVÉ (type "private"), jamais d'URL
// publique. Lecture uniquement via une URL signée générée côté serveur.
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(TMP_DIR, { recursive: true });
      cb(null, TMP_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(String(file.mimetype || "").toLowerCase())) {
      return cb(httpError(400, "Format de pièce non accepté (JPEG, PNG, WEBP ou PDF).", "SPONSORSHIP_FILE_TYPE"));
    }
    return cb(null, true);
  },
});

const uploadSponsorshipDocumentsMiddleware = (req, res, next) =>
  upload.fields(Object.keys(DOCUMENT_FIELDS).map((name) => ({ name, maxCount: 1 })))(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "Chaque pièce doit faire au plus 8 Mo." : err.message || "Envoi de fichier invalide.";
    return res.status(err.statusCode || 400).json({ message, code: err.code || "SPONSORSHIP_UPLOAD" });
  });

function collectUploadedFiles(req) {
  const files = [];
  for (const [field, type] of Object.entries(DOCUMENT_FIELDS)) {
    const file = req.files?.[field]?.[0];
    if (file) files.push({ file, type });
  }
  return files;
}

function cleanupTmpFiles(files = []) {
  for (const { file } of files) {
    try {
      if (file?.path) fs.unlinkSync(file.path);
    } catch {
      // nettoyage au mieux
    }
  }
}

async function storeSponsorshipDocument({ file, type, sponsorshipId }) {
  const mime = String(file.mimetype || "").toLowerCase();
  const resourceType = mime === "application/pdf" ? "raw" : "image";
  const uploaded = await uploadFile(file.path, {
    folder: "appfbo/sponsorships",
    type: "private",
    resource_type: resourceType,
    use_filename: false,
    unique_filename: true,
  });
  if (!uploaded?.public_id) throw new Error("UPLOAD_PIECE_PARRAINAGE_INDISPONIBLE");
  return {
    sponsorshipId,
    type,
    storagePublicId: uploaded.public_id,
    storageResourceType: resourceType,
    mimeType: mime,
    sizeBytes: Number(file.size || 0),
    originalFileName: file.originalname || null,
  };
}

function buildDocumentDownloadUrl(document) {
  const format = document.storageResourceType === "raw" ? "" : MIME_FORMATS[document.mimeType] || "";
  return cloudinary.utils.private_download_url(document.storagePublicId, format, {
    resource_type: document.storageResourceType,
    type: "private",
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
  });
}

// Contenu d'une pièce pour le dossier PDF : images converties en JPEG par
// Cloudinary (le générateur PDF ne lit ni WEBP ni HEIC), PDF tels quels.
async function fetchSponsorshipDocumentBuffer(document) {
  const axios = require("axios");
  const isImage = document.storageResourceType !== "raw";
  const url = cloudinary.utils.private_download_url(document.storagePublicId, isImage ? "jpg" : "", {
    resource_type: document.storageResourceType,
    type: "private",
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
  });
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  return { buffer: Buffer.from(response.data), mimeType: isImage ? "image/jpeg" : document.mimeType };
}

async function streamSponsorshipDocument(document, res) {
  const axios = require("axios");
  const response = await axios.get(buildDocumentDownloadUrl(document), { responseType: "stream", timeout: 20000 });
  res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${String(document.originalFileName || "piece").replace(/"/g, "")}"`,
  );
  response.data.pipe(res);
}

async function addSponsorshipLog(tx, { sponsorshipId, action, note = null, meta = null, actorAdminId = null, actorFboId = null }) {
  return (tx || prisma).sponsorshipLog.create({
    data: { sponsorshipId, action, note, meta: meta || undefined, actorAdminId, actorFboId },
  });
}

async function notifySms({ to, message, countryCode }) {
  if (!to) return;
  try {
    await sendSms({ to, message, countryCode });
  } catch (error) {
    console.error("[sponsorship] SMS non envoyé", { to, error: error?.message || String(error) });
  }
}

async function findSponsorPhone(sponsorship) {
  if (sponsorship.sponsorPhone) return sponsorship.sponsorPhone;
  const lastOrder = await prisma.preorder.findFirst({
    where: { fboId: sponsorship.sponsorFboId, factureWhatsappTo: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { factureWhatsappTo: true },
  });
  return lastOrder?.factureWhatsappTo || null;
}

// ---------------------------------------------------------------------------
// Achat de validation : une SEULE commande payée du filleul, dont le montant
// AS400 facturé (hors frais Wave, livraison et emballage) atteint le minimum,
// payée entre l'approbation et l'échéance.
// ---------------------------------------------------------------------------

function as400BaseAmount(preorder) {
  const invoiced = Number(preorder.as400InvoiceTotalFcfa ?? preorder.totalFcfa ?? 0);
  return invoiced - Number(preorder.fraisLivraisonFcfa || 0) - Number(preorder.emballageFcfa || 0);
}

async function findQualifyingPreorder(sponsorship) {
  if (!sponsorship.recruitFboId || !sponsorship.approvedAt) return null;
  const candidates = await prisma.preorder.findMany({
    where: {
      fboId: sponsorship.recruitFboId,
      countryId: sponsorship.countryId,
      paymentStatus: "PAID",
      paidAt: { gte: sponsorship.approvedAt, ...(sponsorship.purchaseDeadlineAt ? { lte: sponsorship.purchaseDeadlineAt } : {}) },
    },
    orderBy: { paidAt: "asc" },
    select: {
      id: true,
      preorderNumber: true,
      paidAt: true,
      totalFcfa: true,
      as400InvoiceTotalFcfa: true,
      fraisLivraisonFcfa: true,
      emballageFcfa: true,
    },
  });
  const minimum = Number(sponsorship.minPurchaseFcfa || 0);
  return candidates.find((order) => as400BaseAmount(order) >= minimum) || null;
}

async function evaluateSponsorship(sponsorship, { now = new Date() } = {}) {
  if (sponsorship.status !== "APPROVED_PENDING_PURCHASE") return { status: sponsorship.status, changed: false };
  const qualifying = await findQualifyingPreorder(sponsorship);

  if (qualifying) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.sponsorship.findUnique({ where: { id: sponsorship.id }, select: { status: true } });
      if (current?.status !== "APPROVED_PENDING_PURCHASE") return;
      await tx.sponsorship.update({
        where: { id: sponsorship.id },
        data: { status: "VALIDATED", validatedAt: now, qualifyingPreorderId: qualifying.id },
      });
      await tx.fbo.update({
        where: { id: sponsorship.recruitFboId },
        data: { sponsorFboId: sponsorship.sponsorFboId, sponsorLinkedAt: now },
      });
      await addSponsorshipLog(tx, {
        sponsorshipId: sponsorship.id,
        action: "VALIDATED",
        note: `Achat de validation : ${qualifying.preorderNumber} (${as400BaseAmount(qualifying)} F AS400). Lien parrain-filleul enregistré.`,
        meta: { preorderId: qualifying.id, as400BaseAmountFcfa: as400BaseAmount(qualifying), minPurchaseFcfa: sponsorship.minPurchaseFcfa },
      });
    });
    const sponsorPhone = await findSponsorPhone(sponsorship);
    const country = await prisma.country.findUnique({ where: { id: sponsorship.countryId }, select: { code: true } });
    await notifySms({
      to: sponsorPhone,
      countryCode: country?.code || "CIV",
      message: `FOREVER: parrainage de ${sponsorship.firstNames} ${sponsorship.lastName} valide (FBO ${sponsorship.recruitFboNumero}). Merci !`,
    });
    return { status: "VALIDATED", changed: true };
  }

  if (sponsorship.purchaseDeadlineAt && now > sponsorship.purchaseDeadlineAt) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.sponsorship.findUnique({ where: { id: sponsorship.id }, select: { status: true } });
      if (current?.status !== "APPROVED_PENDING_PURCHASE") return;
      await tx.sponsorship.update({ where: { id: sponsorship.id }, data: { status: "EXPIRED", expiredAt: now } });
      await addSponsorshipLog(tx, {
        sponsorshipId: sponsorship.id,
        action: "EXPIRED",
        note: `Aucune commande payée d'au moins ${sponsorship.minPurchaseFcfa} F avant l'échéance.`,
      });
    });
    return { status: "EXPIRED", changed: true };
  }

  return { status: sponsorship.status, changed: false };
}

async function evaluatePendingSponsorships({ now = new Date() } = {}) {
  const pending = await prisma.sponsorship.findMany({ where: { status: "APPROVED_PENDING_PURCHASE" } });
  const summary = { checked: pending.length, validated: 0, expired: 0 };
  for (const sponsorship of pending) {
    try {
      const result = await evaluateSponsorship(sponsorship, { now });
      if (result.changed && result.status === "VALIDATED") summary.validated += 1;
      if (result.changed && result.status === "EXPIRED") summary.expired += 1;
    } catch (error) {
      console.error("[sponsorship] évaluation impossible", { id: sponsorship.id, error: error?.message });
    }
  }
  return summary;
}

function startSponsorshipScheduler() {
  if (String(process.env.SPONSORSHIP_SCHEDULER_ENABLED || "true").toLowerCase() === "false") {
    console.info("[sponsorship] scheduler disabled via SPONSORSHIP_SCHEDULER_ENABLED");
    return null;
  }
  const everyMinutes = Math.max(1, Number.parseInt(process.env.SPONSORSHIP_SCHEDULER_EVERY_MINUTES || "5", 10) || 5);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await evaluatePendingSponsorships();
      if (summary.validated || summary.expired) console.log("[sponsorship] scheduler summary", summary);
    } catch (error) {
      console.error("[sponsorship] scheduler error", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMinutes * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  tick().catch(() => {});
  return timer;
}

// true si l'email n'est utilisé par aucun autre parrainage actif (tous pays).
async function isRecruitEmailAvailable(email, { excludeSponsorshipId = null } = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return true;
  const existing = await prisma.sponsorship.findFirst({
    where: {
      email: { equals: normalized, mode: "insensitive" },
      status: { in: ACTIVE_SPONSORSHIP_STATUSES },
      ...(excludeSponsorshipId ? { id: { not: excludeSponsorshipId } } : {}),
    },
    select: { id: true },
  });
  return !existing;
}

async function assertRecruitEmailAvailable(email, options) {
  if (!(await isRecruitEmailAvailable(email, options))) {
    throw httpError(409, "Cet email est déjà utilisé pour un autre parrainage. Utilisez l'email personnel du filleul.", "SPONSORSHIP_DUPLICATE_EMAIL");
  }
}

module.exports = {
  ID_DOCUMENT_LABELS,
  ACTIVE_SPONSORSHIP_STATUSES,
  isRecruitEmailAvailable,
  assertRecruitEmailAvailable,
  MIN_RECRUIT_AGE,
  CONSENT_VERSION,
  STATUS_LABELS,
  httpError,
  ageOn,
  canonicalFboNumber,
  buildConsentText,
  normalizeRecruitPayload,
  getSponsorshipSettings,
  isSponsorGradeAllowed,
  uploadSponsorshipDocumentsMiddleware,
  collectUploadedFiles,
  cleanupTmpFiles,
  storeSponsorshipDocument,
  streamSponsorshipDocument,
  fetchSponsorshipDocumentBuffer,
  addSponsorshipLog,
  notifySms,
  findSponsorPhone,
  as400BaseAmount,
  evaluateSponsorship,
  evaluatePendingSponsorships,
  startSponsorshipScheduler,
};
