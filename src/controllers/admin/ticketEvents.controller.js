const prisma = require("../../prisma");

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

function includeEventDetails() {
  return {
    ticketTypes: {
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: {
            tickets: {
              where: { status: { in: ["RESERVED", "ACTIVE", "USED"] } },
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

async function listOrders(req, res) {
  try {
    const { eventId, status, q } = req.query;
    const where = { countryId: req.countryId };
    if (eventId) where.eventId = String(eventId);
    if (status) where.status = String(status).trim().toUpperCase();
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
        tickets: { include: { ticketType: true } },
      },
    });
    return res.json({ data: orders });
  } catch (error) {
    console.error("ticketEvents.listOrders error:", error);
    return res.status(500).json({ message: "Erreur serveur (listOrders)" });
  }
}

async function markOrderPaid(req, res) {
  try {
    const order = await prisma.ticketOrder.findFirst({
      where: { id: req.params.orderId, countryId: req.countryId },
      include: { tickets: true },
    });
    if (!order) return res.status(404).json({ message: "Commande billet introuvable" });

    const { paymentReference, paymentMethod, note } = req.body || {};
    const updated = await prisma.$transaction(async (tx) => {
      await tx.ticket.updateMany({
        where: { orderId: order.id, status: "RESERVED" },
        data: { status: "ACTIVE" },
      });
      return tx.ticketOrder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "SUCCEEDED",
          paymentReference: paymentReference ? String(paymentReference).trim() : order.paymentReference,
          paymentMethod: paymentMethod ? String(paymentMethod).trim().toUpperCase() : order.paymentMethod,
          paidAt: order.paidAt || new Date(),
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
    console.error("ticketEvents.markOrderPaid error:", error);
    return res.status(500).json({ message: "Erreur serveur (markOrderPaid)" });
  }
}

async function checkInTicket(req, res) {
  try {
    const { tokenOrCode } = req.body || {};
    const raw = String(tokenOrCode || "").trim();
    if (!raw) return res.status(400).json({ message: "Code billet ou QR requis." });

    const ticket = await prisma.ticket.findFirst({
      where: {
        countryId: req.countryId,
        OR: [{ qrToken: raw }, { ticketCode: raw.toUpperCase() }],
      },
      include: {
        event: true,
        ticketType: true,
        order: true,
      },
    });
    if (!ticket) return res.status(404).json({ message: "Billet introuvable." });
    if (ticket.status === "USED") return res.status(409).json({ message: "Billet déjà utilisé.", ticket });
    if (ticket.status !== "ACTIVE") return res.status(400).json({ message: "Billet non actif.", ticket });

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "USED",
        checkedInAt: new Date(),
        checkedInById: req.user?.id || null,
      },
      include: {
        event: true,
        ticketType: true,
        order: true,
        checkedInBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("ticketEvents.checkInTicket error:", error);
    return res.status(500).json({ message: "Erreur serveur (checkInTicket)" });
  }
}

module.exports = {
  listEvents,
  getEvent,
  upsertEvent,
  upsertTicketType,
  listOrders,
  markOrderPaid,
  checkInTicket,
};
