const crypto = require("crypto");
const multer = require("multer");
const prisma = require("../../prisma");
const { uploadBuffer } = require("../../services/cloudinary");
const ticketWavePaymentService = require("../../services/ticket-wave-payment.service");
const {
  ensureTicketsActivatedForPaidOrder,
  paidOrderTicketInclude,
} = require("../../services/ticket-order-ticketing.service");
const { normalizeEmail } = require("../../services/email.service");
const { sendTicketOrderEmail } = require("../../services/ticket-email-notifications.service");
const { publicFrontendBaseUrl } = require("../../services/public-url.service");

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

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePositiveInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function ticketOrderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/\D/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `EVT-${stamp}-${suffix}`;
}

function uploadPosterMiddleware(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Le fichier dépasse 5 MB." });
    }
    return res.status(400).json({ message: err.message || "Upload invalide" });
  });
}

function includeEventDetails() {
  return {
    ticketTypes: {
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: {
            tickets: {
              where: { status: { in: ["ACTIVE", "USED"] } },
            },
          },
        },
      },
    },
    _count: {
      select: {
        ticketOrders: true,
        tickets: true,
      },
    },
  };
}

function includeCheckInDetails() {
  return {
    event: { select: { id: true, title: true, startsAt: true, venueName: true } },
    ticketType: { select: { id: true, label: true, priceFcfa: true } },
    order: { select: { id: true, orderNumber: true, buyerFullName: true, buyerPhone: true } },
    session: { select: { id: true, entryPoint: true, openedAt: true, closedAt: true } },
    checkedBy: { select: { id: true, fullName: true, email: true } },
    ticket: {
      select: {
        id: true,
        ticketCode: true,
        holderFullName: true,
        status: true,
        checkedInAt: true,
      },
    },
  };
}

function normalizeEntryPoint(value) {
  const normalized = String(value || "").trim();
  return normalized || "Entrée principale";
}

function maskScannedValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length <= 16) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
}

function normalizeScannedTicketValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const queryToken =
      url.searchParams.get("ticket") ||
      url.searchParams.get("token") ||
      url.searchParams.get("qr") ||
      url.searchParams.get("code");
    if (queryToken && String(queryToken).trim()) return String(queryToken).trim();

    const segments = url.pathname.split("/").map((segment) => segment.trim()).filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (lastSegment) return decodeURIComponent(lastSegment);
  } catch {
    // Le QR contient normalement le token brut, pas une URL.
  }

  return raw;
}

function buildCheckInLogData({
  req,
  ticket = null,
  eventId = null,
  session = null,
  entryPoint = null,
  scannedValue = null,
  result,
  reason,
  ticketStatusBefore = null,
  ticketStatusAfter = null,
}) {
  return {
    countryId: req.countryId,
    eventId: ticket?.eventId || eventId || null,
    ticketTypeId: ticket?.ticketTypeId || null,
    ticketId: ticket?.id || null,
    orderId: ticket?.orderId || null,
    sessionId: session?.id || null,
    checkedById: req.user?.id || null,
    entryPoint: session?.entryPoint || entryPoint || null,
    scannedValue: maskScannedValue(scannedValue),
    ticketCode: ticket?.ticketCode || null,
    result,
    reason,
    ticketStatusBefore,
    ticketStatusAfter,
    metadata: {
      userAgent: req.get?.("user-agent") || null,
    },
  };
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

async function listOrders(req, res) {
  try {
    const { eventId, status, q, paymentMethod } = req.query;
    const where = { countryId: req.countryId };
    if (eventId) where.eventId = String(eventId);
    if (status) where.status = String(status).trim().toUpperCase();
    if (paymentMethod) {
      const normalizedPaymentMethod = String(paymentMethod).trim().toUpperCase();
      const aliases = {
        CASH: ["CASH", "ESPECES", "ESPÈCES", "ESPECES_AU_GUICHET"],
        WAVE: ["WAVE"],
      };
      if (normalizedPaymentMethod === "OTHER") {
        where.AND = [
          ...(where.AND || []),
          {
            NOT: {
              OR: [
                { paymentMethod: { in: [...aliases.CASH, ...aliases.WAVE] } },
                { paymentProvider: { in: [...aliases.CASH, ...aliases.WAVE] } },
              ],
            },
          },
        ];
      } else {
        const values = aliases[normalizedPaymentMethod] || [normalizedPaymentMethod];
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { paymentMethod: { in: values } },
              { paymentProvider: { in: values } },
            ],
          },
        ];
      }
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.OR = [
        { orderNumber: { contains: term, mode: "insensitive" } },
        { buyerFullName: { contains: term, mode: "insensitive" } },
        { buyerPhone: { contains: term, mode: "insensitive" } },
        { buyerFboNumber: { contains: term, mode: "insensitive" } },
      ];
    }

    const orders = await prisma.ticketOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: {
        event: { select: { id: true, title: true, startsAt: true } },
        ticketType: true,
        tickets: { include: { ticketType: true } },
      },
    });
    return res.json({ data: orders });
  } catch (error) {
    console.error("ticketEvents.listOrders error:", error);
    return res.status(500).json({ message: "Erreur serveur (listOrders)" });
  }
}

async function createCashOrder(req, res) {
  try {
    const {
      eventId,
      ticketTypeId,
      quantity,
      buyerFullName,
      buyerPhone,
      buyerEmail,
      buyerFboNumber,
      buyerFboName,
      holderFullName,
      note,
    } = req.body || {};

    const normalizedEventId = String(eventId || "").trim();
    const normalizedTicketTypeId = String(ticketTypeId || "").trim();
    const qty = Math.max(1, Math.min(50, Number.parseInt(quantity, 10) || 1));
    const normalizedBuyerName = String(buyerFullName || "").trim();
    const normalizedBuyerPhone = digitsOnly(buyerPhone);
    const normalizedBuyerEmail = normalizeEmail(buyerEmail || "");
    const normalizedHolderName = String(holderFullName || buyerFullName || "").trim();

    if (!normalizedEventId || !normalizedTicketTypeId) {
      return res.status(400).json({ message: "Événement et type de ticket requis." });
    }
    if (!normalizedBuyerName || !normalizedBuyerPhone) {
      return res.status(400).json({ message: "Nom et téléphone client requis." });
    }
    if (!normalizedBuyerEmail) {
      return res.status(400).json({ message: "Email client valide requis pour envoyer le ticket digital." });
    }
    if (!normalizedHolderName) {
      return res.status(400).json({ message: "Nom du participant requis." });
    }

    const ticketType = await prisma.ticketType.findFirst({
      where: {
        id: normalizedTicketTypeId,
        eventId: normalizedEventId,
        event: { countryId: req.countryId },
      },
      include: { event: true },
    });
    if (!ticketType) return res.status(404).json({ message: "Type de ticket introuvable." });
    if (!ticketType.active) return res.status(400).json({ message: "Ce type de ticket est inactif." });
    if (qty > Number(ticketType.maxPerOrder || 10)) {
      return res.status(400).json({ message: `Maximum ${ticketType.maxPerOrder} billet(s) par achat.` });
    }

    const soldCount = await prisma.ticket.count({
      where: { ticketTypeId: ticketType.id, status: { in: ["ACTIVE", "USED"] } },
    });
    if (ticketType.capacity != null && soldCount + qty > Number(ticketType.capacity)) {
      return res.status(409).json({ message: "Capacité insuffisante pour ce type de ticket." });
    }

    const totalFcfa = Number(ticketType.priceFcfa || 0) * qty;
    const order = await prisma.$transaction(async (tx) => {
      const savedOrder = await tx.ticketOrder.create({
        data: {
          countryId: req.countryId,
          eventId: ticketType.eventId,
          ticketTypeId: ticketType.id,
          orderNumber: ticketOrderNumber(),
          status: "PAID",
          buyerFullName: normalizedBuyerName,
          buyerPhone: normalizedBuyerPhone,
          buyerEmail: normalizedBuyerEmail,
          buyerFboNumber: buyerFboNumber ? String(buyerFboNumber).trim() : null,
          buyerFboName: buyerFboName ? String(buyerFboName).trim() : null,
          quantity: qty,
          holderFullName: normalizedHolderName,
          holderPhone: normalizedBuyerPhone,
          holderEmail: normalizedBuyerEmail,
          totalFcfa,
          paymentMethod: "CASH",
          paymentProvider: "CASH",
          paymentReference: `CASH-${Date.now()}`,
          paymentStatus: "SUCCEEDED",
          paidAt: new Date(),
          note: note ? String(note).trim() : "Vente ticket espèces au guichet.",
        },
        include: { ticketType: true, tickets: { include: { ticketType: true } } },
      });

      await ensureTicketsActivatedForPaidOrder(tx, savedOrder);
      return tx.ticketOrder.findUnique({
        where: { id: savedOrder.id },
        include: paidOrderTicketInclude(),
      });
    });

    const emailResult = await sendTicketOrderEmail({ order, publicUrl: publicFrontendBaseUrl(req) });
    return res.status(201).json({ ...order, emailSent: Boolean(emailResult.sent), emailResult });
  } catch (error) {
    console.error("ticketEvents.createCashOrder error:", error);
    return res.status(500).json({ message: "Erreur serveur (createCashOrder)" });
  }
}

async function markOrderPaid(req, res) {
  try {
    const order = await prisma.ticketOrder.findFirst({
      where: { id: req.params.orderId, countryId: req.countryId },
      include: { ticketType: true, tickets: { include: { ticketType: true } } },
    });
    if (!order) return res.status(404).json({ message: "Commande billet introuvable" });
    if (order.status === "CANCELLED" || order.status === "EXPIRED") {
      return res.status(400).json({ message: "Cette commande ne peut plus être encaissée." });
    }

    const { paymentReference, paymentMethod, note } = req.body || {};
    const normalizedPaymentMethod = paymentMethod ? String(paymentMethod).trim().toUpperCase() : "CASH";
    const updated = await prisma.$transaction(async (tx) => {
      await ensureTicketsActivatedForPaidOrder(tx, order);
      return tx.ticketOrder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "SUCCEEDED",
          paymentReference: paymentReference ? String(paymentReference).trim() : order.paymentReference,
          paymentMethod: normalizedPaymentMethod,
          paymentProvider: normalizedPaymentMethod,
          paidAt: order.paidAt || new Date(),
          note: note ? String(note).trim() : order.note,
        },
        include: paidOrderTicketInclude(),
      });
    });

    if (updated.buyerEmail || updated.holderEmail) {
      sendTicketOrderEmail({ order: updated, publicUrl: publicFrontendBaseUrl(req) }).catch((emailError) => {
        console.warn("ticket cash payment email send failed", {
          orderId: updated.id,
          error: emailError?.message,
        });
      });
    }

    return res.json(updated);
  } catch (error) {
    console.error("ticketEvents.markOrderPaid error:", error);
    return res.status(500).json({ message: "Erreur serveur (markOrderPaid)" });
  }
}

async function syncOrderWavePayment(req, res) {
  try {
    const order = await prisma.ticketOrder.findFirst({
      where: { id: req.params.orderId, countryId: req.countryId },
      select: {
        id: true,
        orderNumber: true,
        paymentMethod: true,
        paymentProvider: true,
      },
    });
    if (!order) return res.status(404).json({ message: "Commande billet introuvable" });

    const isWaveOrder =
      String(order.paymentMethod || "").toUpperCase() === "WAVE" ||
      String(order.paymentProvider || "").toUpperCase() === "WAVE";
    if (!isWaveOrder) {
      return res.status(400).json({ message: "Cette commande ticket n'est pas une commande Wave." });
    }

    const result = await ticketWavePaymentService.syncTicketWavePaymentStatus({
      req,
      orderNumber: order.orderNumber,
    });

    return res.json(result.order || result);
  } catch (error) {
    console.error("ticketEvents.syncOrderWavePayment error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.message || "Erreur serveur (syncOrderWavePayment)" });
  }
}

async function cancelOrder(req, res) {
  try {
    const order = await prisma.ticketOrder.findFirst({
      where: { id: req.params.orderId, countryId: req.countryId },
      include: { tickets: true },
    });
    if (!order) return res.status(404).json({ message: "Commande billet introuvable" });
    if (order.status === "PAID") {
      return res.status(400).json({ message: "Une commande payée ne peut pas être annulée ici." });
    }

    const { note } = req.body || {};
    const updated = await prisma.$transaction(async (tx) => {
      await tx.ticket.updateMany({
        where: { orderId: order.id, status: "RESERVED" },
        data: { status: "CANCELLED" },
      });
      return tx.ticketOrder.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          paymentStatus: "CANCELLED",
          note: note ? String(note).trim() : order.note,
        },
        include: {
          event: true,
          tickets: { include: { ticketType: true } },
        },
      });
    });

    return res.json(updated);
  } catch (error) {
    console.error("ticketEvents.cancelOrder error:", error);
    return res.status(500).json({ message: "Erreur serveur (cancelOrder)" });
  }
}

async function resendOrderTicketsEmail(req, res) {
  try {
    const order = await prisma.ticketOrder.findFirst({
      where: { id: req.params.orderId, countryId: req.countryId },
      include: {
        country: { select: { code: true } },
        event: true,
        ticketType: true,
        tickets: { include: { ticketType: true } },
      },
    });
    if (!order) return res.status(404).json({ message: "Commande billet introuvable" });
    if (order.status !== "PAID") {
      return res.status(400).json({ message: "Seules les commandes payées peuvent être renvoyées." });
    }

    const result = await sendTicketOrderEmail({ order, publicUrl: publicFrontendBaseUrl(req) });
    if (!result.sent) {
      return res.status(400).json({
        message: result.reason === "NO_EMAIL"
          ? "Aucune adresse email n'est associée à cette commande."
          : "Email non envoyé.",
        result,
      });
    }

    return res.json({ ok: true, sentTo: result.to });
  } catch (error) {
    console.error("ticketEvents.resendOrderTicketsEmail error:", error);
    return res.status(500).json({ message: "Erreur serveur (resendOrderTicketsEmail)" });
  }
}

async function expireOrders(req, res) {
  try {
    const { eventId } = req.body || {};
    const where = {
      countryId: req.countryId,
      status: "PENDING_PAYMENT",
      expiresAt: { lt: new Date() },
    };
    if (eventId) where.eventId = String(eventId);

    const orders = await prisma.ticketOrder.findMany({
      where,
      select: { id: true },
      take: 500,
    });
    const orderIds = orders.map((order) => order.id);
    if (!orderIds.length) return res.json({ expired: 0 });

    await prisma.$transaction([
      prisma.ticket.updateMany({
        where: { orderId: { in: orderIds }, status: "RESERVED" },
        data: { status: "CANCELLED" },
      }),
      prisma.ticketOrder.updateMany({
        where: { id: { in: orderIds } },
        data: { status: "EXPIRED", paymentStatus: "EXPIRED" },
      }),
    ]);

    return res.json({ expired: orderIds.length });
  } catch (error) {
    console.error("ticketEvents.expireOrders error:", error);
    return res.status(500).json({ message: "Erreur serveur (expireOrders)" });
  }
}

async function checkInTicket(req, res) {
  try {
    const { tokenOrCode, eventId, sessionId, entryPoint } = req.body || {};
    const raw = normalizeScannedTicketValue(tokenOrCode);
    const expectedEventId = String(eventId || "").trim();
    if (!raw) return res.status(400).json({ message: "Code billet ou QR requis." });

    let session = null;
    if (sessionId) {
      session = await prisma.ticketCheckInSession.findFirst({
        where: {
          id: String(sessionId),
          countryId: req.countryId,
          ...(expectedEventId ? { eventId: expectedEventId } : {}),
        },
      });
      if (!session) return res.status(404).json({ message: "Session de contrôle introuvable." });
      if (session.closedAt) return res.status(400).json({ message: "Session de contrôle déjà fermée." });
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        countryId: req.countryId,
        OR: [{ qrToken: raw }, { ticketCode: raw.toUpperCase() }],
      },
      include: {
        event: true,
        ticketType: true,
        order: true,
        checkedInBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!ticket) {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          eventId: expectedEventId || null,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "NOT_FOUND",
          reason: "Billet introuvable.",
        }),
        include: includeCheckInDetails(),
      });
      return res.status(404).json({ message: "Billet introuvable.", log });
    }
    if (expectedEventId && ticket.eventId !== expectedEventId) {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          eventId: expectedEventId,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "WRONG_EVENT",
          reason: "Ce billet appartient à un autre événement.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: ticket.status,
        }),
        include: includeCheckInDetails(),
      });
      return res.status(409).json({ message: "Ce billet appartient à un autre événement.", ticket, log });
    }
    if (ticket.status === "USED") {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "ALREADY_USED",
          reason: "Billet déjà utilisé.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: ticket.status,
        }),
        include: includeCheckInDetails(),
      });
      return res.status(409).json({ message: "Billet déjà utilisé.", ticket, log });
    }
    if (ticket.status !== "ACTIVE") {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "INACTIVE",
          reason: "Billet non actif.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: ticket.status,
        }),
        include: includeCheckInDetails(),
      });
      return res.status(400).json({ message: "Billet non actif.", ticket, log });
    }

    const { updated, log, alreadyUsed } = await prisma.$transaction(async (tx) => {
      const checkInTime = new Date();
      const claim = await tx.ticket.updateMany({
        where: { id: ticket.id, status: "ACTIVE", checkedInAt: null },
        data: {
          status: "USED",
          checkedInAt: checkInTime,
          checkedInById: req.user?.id || null,
        },
      });

      const checkedTicket = await tx.ticket.findUnique({
        where: { id: ticket.id },
        include: {
          event: true,
          ticketType: true,
          order: true,
          checkedInBy: { select: { id: true, fullName: true, email: true } },
        },
      });

      if (!claim.count) {
        const duplicateLog = await tx.ticketCheckInLog.create({
          data: buildCheckInLogData({
            req,
            ticket: checkedTicket || ticket,
            session,
            entryPoint: normalizeEntryPoint(entryPoint),
            scannedValue: raw,
            result: "ALREADY_USED",
            reason: "Billet déjà utilisé.",
            ticketStatusBefore: ticket.status,
            ticketStatusAfter: checkedTicket?.status || ticket.status,
          }),
          include: includeCheckInDetails(),
        });
        return { updated: checkedTicket || ticket, log: duplicateLog, alreadyUsed: true };
      }

      const checkInLog = await tx.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "ACCEPTED",
          reason: "Entrée validée.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: "USED",
        }),
        include: includeCheckInDetails(),
      });
      return { updated: checkedTicket, log: checkInLog, alreadyUsed: false };
    });

    if (alreadyUsed) {
      return res.status(409).json({ message: "Billet déjà utilisé.", ticket: updated, log });
    }

    return res.json({ ...updated, checkInLog: log });
  } catch (error) {
    console.error("ticketEvents.checkInTicket error:", error);
    return res.status(500).json({ message: "Erreur serveur (checkInTicket)" });
  }
}

async function openCheckInSession(req, res) {
  try {
    const { eventId, entryPoint, deviceName } = req.body || {};
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) return res.status(400).json({ message: "Événement requis." });

    const event = await prisma.ticketEvent.findFirst({
      where: { id: normalizedEventId, countryId: req.countryId },
      select: { id: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable." });

    const session = await prisma.ticketCheckInSession.create({
      data: {
        countryId: req.countryId,
        eventId: event.id,
        agentId: req.user?.id || null,
        entryPoint: normalizeEntryPoint(entryPoint),
        deviceName: deviceName ? String(deviceName).trim().slice(0, 120) : null,
      },
      include: {
        event: { select: { id: true, title: true, startsAt: true } },
        agent: { select: { id: true, fullName: true, email: true } },
      },
    });

    return res.status(201).json(session);
  } catch (error) {
    console.error("ticketEvents.openCheckInSession error:", error);
    return res.status(500).json({ message: "Erreur serveur (openCheckInSession)" });
  }
}

async function closeCheckInSession(req, res) {
  try {
    const session = await prisma.ticketCheckInSession.findFirst({
      where: { id: req.params.sessionId, countryId: req.countryId },
    });
    if (!session) return res.status(404).json({ message: "Session de contrôle introuvable." });

    const updated = await prisma.ticketCheckInSession.update({
      where: { id: session.id },
      data: { closedAt: session.closedAt || new Date() },
      include: {
        event: { select: { id: true, title: true, startsAt: true } },
        agent: { select: { id: true, fullName: true, email: true } },
      },
    });
    return res.json(updated);
  } catch (error) {
    console.error("ticketEvents.closeCheckInSession error:", error);
    return res.status(500).json({ message: "Erreur serveur (closeCheckInSession)" });
  }
}

async function listCheckInLogs(req, res) {
  try {
    const { eventId, sessionId, result, q } = req.query;
    const where = { countryId: req.countryId };
    if (eventId) where.eventId = String(eventId);
    if (sessionId) where.sessionId = String(sessionId);
    if (result) where.result = String(result).trim().toUpperCase();
    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.OR = [
        { ticketCode: { contains: term, mode: "insensitive" } },
        { scannedValue: { contains: term, mode: "insensitive" } },
        { ticket: { holderFullName: { contains: term, mode: "insensitive" } } },
        { order: { buyerFullName: { contains: term, mode: "insensitive" } } },
      ];
    }

    const logs = await prisma.ticketCheckInLog.findMany({
      where,
      orderBy: [{ scannedAt: "desc" }],
      take: 200,
      include: includeCheckInDetails(),
    });

    return res.json({ data: logs });
  } catch (error) {
    console.error("ticketEvents.listCheckInLogs error:", error);
    return res.status(500).json({ message: "Erreur serveur (listCheckInLogs)" });
  }
}

async function getCheckInSummary(req, res) {
  try {
    const { eventId, sessionId } = req.query;
    const where = { countryId: req.countryId };
    if (eventId) where.eventId = String(eventId);
    if (sessionId) where.sessionId = String(sessionId);

    const [byResult, activeSessions, totalTickets, usedTickets] = await Promise.all([
      prisma.ticketCheckInLog.groupBy({
        by: ["result"],
        where,
        _count: { result: true },
      }),
      prisma.ticketCheckInSession.findMany({
        where: {
          countryId: req.countryId,
          ...(eventId ? { eventId: String(eventId) } : {}),
          closedAt: null,
        },
        orderBy: [{ openedAt: "desc" }],
        take: 20,
        include: {
          agent: { select: { id: true, fullName: true, email: true } },
        },
      }),
      eventId
        ? prisma.ticket.count({ where: { countryId: req.countryId, eventId: String(eventId), status: { in: ["ACTIVE", "USED"] } } })
        : Promise.resolve(0),
      eventId
        ? prisma.ticket.count({ where: { countryId: req.countryId, eventId: String(eventId), status: "USED" } })
        : Promise.resolve(0),
    ]);

    const counts = byResult.reduce((acc, item) => {
      acc[item.result] = item._count.result;
      return acc;
    }, {});
    const accepted = counts.ACCEPTED || 0;
    const refused = Object.entries(counts).reduce(
      (sum, [key, value]) => (key === "ACCEPTED" ? sum : sum + value),
      0,
    );

    return res.json({
      counts,
      accepted,
      refused,
      totalScans: accepted + refused,
      totalTickets,
      usedTickets,
      remainingTickets: Math.max(0, totalTickets - usedTickets),
      activeSessions,
    });
  } catch (error) {
    console.error("ticketEvents.getCheckInSummary error:", error);
    return res.status(500).json({ message: "Erreur serveur (getCheckInSummary)" });
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
  listOrders,
  createCashOrder,
  markOrderPaid,
  syncOrderWavePayment,
  cancelOrder,
  resendOrderTicketsEmail,
  expireOrders,
  checkInTicket,
  openCheckInSession,
  closeCheckInSession,
  listCheckInLogs,
  getCheckInSummary,
};
