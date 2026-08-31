// Gestion des événements et de leurs types de billets : CRUD événement,
// CRUD type de billet, upload d'affiche.

const multer = require("multer");
const prisma = require("../../../prisma");
const { uploadBuffer } = require("../../../services/cloudinary");
const { normalizeSlug, parseDate, parsePositiveInt, includeEventDetails } = require("./shared");

const MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_UPLOAD_MIME_TYPES.has(String(file.mimetype || "").toLowerCase());
    cb(ok ? null : new Error("Format image non supporté (png/jpg/webp/gif)"), ok);
  },
});

function uploadPosterMiddleware(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Le fichier dépasse 5 MB." });
    }
    return res.status(400).json({ message: err.message || "Upload invalide" });
  });
}

async function listEvents(req, res) {
  try {
    const events = await prisma.ticketEvent.findMany({
      where: { countryId: req.countryId },
      orderBy: [{ startsAt: "desc" }],
      include: includeEventDetails(),
    });
    return res.json({ data: events });
  } catch (error) {
    console.error("ticketEvents.listEvents error:", error);
    return res.status(500).json({ message: "Erreur serveur (listEvents)" });
  }
}

async function getEvent(req, res) {
  try {
    const event = await prisma.ticketEvent.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
      include: includeEventDetails(),
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable" });
    return res.json(event);
  } catch (error) {
    console.error("ticketEvents.getEvent error:", error);
    return res.status(500).json({ message: "Erreur serveur (getEvent)" });
  }
}

async function upsertEvent(req, res) {
  try {
    const {
      id,
      slug,
      title,
      subtitle,
      description,
      venueName,
      venueAddress,
      startsAt,
      endsAt,
      posterUrl,
      videoUrl,
      status = "DRAFT",
      capacity,
      salesOpenAt,
      salesCloseAt,
    } = req.body || {};

    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      return res.status(400).json({ message: "Le titre de l'événement est obligatoire." });
    }

    const normalizedSlug = normalizeSlug(slug || normalizedTitle);
    if (!normalizedSlug) {
      return res.status(400).json({ message: "Le slug de l'événement est invalide." });
    }

    const normalizedStartsAt = parseDate(startsAt);
    if (!normalizedStartsAt) {
      return res.status(400).json({ message: "La date de début est obligatoire." });
    }

    const allowedStatuses = new Set(["DRAFT", "PUBLISHED", "CLOSED", "CANCELLED"]);
    const normalizedStatus = String(status || "DRAFT").trim().toUpperCase();
    if (!allowedStatuses.has(normalizedStatus)) {
      return res.status(400).json({ message: "Statut événement invalide." });
    }

    const data = {
      countryId: req.countryId,
      slug: normalizedSlug,
      title: normalizedTitle,
      subtitle: subtitle ? String(subtitle).trim() : null,
      description: description ? String(description).trim() : null,
      venueName: venueName ? String(venueName).trim() : null,
      venueAddress: venueAddress ? String(venueAddress).trim() : null,
      startsAt: normalizedStartsAt,
      endsAt: parseDate(endsAt),
      posterUrl: posterUrl ? String(posterUrl).trim() : null,
      videoUrl: videoUrl ? String(videoUrl).trim() : null,
      status: normalizedStatus,
      capacity: parsePositiveInt(capacity),
      salesOpenAt: parseDate(salesOpenAt),
      salesCloseAt: parseDate(salesCloseAt),
      updatedById: req.user?.id || null,
    };

    let event;
    if (id) {
      const existing = await prisma.ticketEvent.findFirst({
        where: { id: String(id), countryId: req.countryId },
      });
      if (!existing) return res.status(404).json({ message: "Événement introuvable" });
      event = await prisma.ticketEvent.update({
        where: { id: existing.id },
        data,
        include: includeEventDetails(),
      });
    } else {
      event = await prisma.ticketEvent.create({
        data: {
          ...data,
          createdById: req.user?.id || null,
        },
        include: includeEventDetails(),
      });
    }

    return res.json(event);
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "Un événement utilise déjà ce slug." });
    }
    console.error("ticketEvents.upsertEvent error:", error);
    return res.status(500).json({ message: "Erreur serveur (upsertEvent)" });
  }
}

async function upsertTicketType(req, res) {
  try {
    const event = await prisma.ticketEvent.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable" });

    const {
      id,
      label,
      description,
      priceFcfa,
      capacity,
      maxPerOrder,
      active = true,
      sortOrder,
    } = req.body || {};

    const normalizedLabel = String(label || "").trim();
    const normalizedPrice = parsePositiveInt(priceFcfa);
    if (!normalizedLabel) return res.status(400).json({ message: "Libellé billet obligatoire." });
    if (normalizedPrice == null) return res.status(400).json({ message: "Prix billet invalide." });

    const data = {
      eventId: event.id,
      label: normalizedLabel,
      description: description ? String(description).trim() : null,
      priceFcfa: normalizedPrice,
      capacity: parsePositiveInt(capacity),
      maxPerOrder: Math.max(1, parsePositiveInt(maxPerOrder, 10) || 10),
      active: Boolean(active),
      sortOrder: parsePositiveInt(sortOrder, 0) || 0,
    };

    let ticketType;
    if (id) {
      const existingType = await prisma.ticketType.findFirst({
        where: { id: String(id), eventId: event.id },
      });
      if (!existingType) {
        return res.status(404).json({ message: "Type de billet introuvable." });
      }
      ticketType = await prisma.ticketType.update({
        where: { id: existingType.id },
        data,
      });
    } else {
      ticketType = await prisma.ticketType.create({ data });
    }

    return res.json(ticketType);
  } catch (error) {
    console.error("ticketEvents.upsertTicketType error:", error);
    return res.status(500).json({ message: "Erreur serveur (upsertTicketType)" });
  }
}

async function deleteTicketType(req, res) {
  try {
    const event = await prisma.ticketEvent.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
      select: { id: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable" });

    const ticketType = await prisma.ticketType.findFirst({
      where: { id: req.params.ticketTypeId, eventId: event.id },
      include: { _count: { select: { tickets: true } } },
    });
    if (!ticketType) return res.status(404).json({ message: "Type de billet introuvable." });

    if (Number(ticketType._count?.tickets || 0) > 0) {
      return res.status(409).json({
        message:
          "Ce type de ticket contient déjà des billets. Désactivez-le plutôt que de le supprimer.",
      });
    }

    await prisma.ticketType.delete({ where: { id: ticketType.id } });
    return res.json({ ok: true, deletedId: ticketType.id });
  } catch (error) {
    console.error("ticketEvents.deleteTicketType error:", error);
    return res.status(500).json({ message: "Erreur serveur (deleteTicketType)" });
  }
}

async function uploadPoster(req, res) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "Fichier requis" });

    const slug = normalizeSlug(req.body?.slug || "event-poster") || "event-poster";
    const uploadResult = await uploadBuffer(file.buffer, {
      folder: `appfbo/ticket-events/${req.countryId}`,
      resource_type: "image",
      use_filename: true,
      unique_filename: true,
      filename_override: `${slug}-${Date.now()}`,
    });

    const url = uploadResult?.secure_url || uploadResult?.url || null;
    if (!url) throw new Error("UPLOAD_TICKET_EVENT_POSTER_FAILED");

    return res.status(201).json({
      ok: true,
      url,
      width: uploadResult?.width || null,
      height: uploadResult?.height || null,
      bytes: uploadResult?.bytes || file.size || null,
      format: uploadResult?.format || null,
    });
  } catch (error) {
    console.error("ticketEvents.uploadPoster error:", error);
    return res.status(500).json({ message: "Erreur serveur (uploadPoster)" });
  }
}

module.exports = {
  listEvents,
  getEvent,
  upsertEvent,
  upsertTicketType,
  deleteTicketType,
  uploadPosterMiddleware,
  uploadPoster,
};
