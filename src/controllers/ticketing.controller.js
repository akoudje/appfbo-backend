const crypto = require("crypto");
const prisma = require("../prisma");

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function ticketOrderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/\D/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `EVT-${stamp}-${suffix}`;
}

function ticketCode() {
  const stamp = new Date().toISOString().slice(2, 10).replace(/\D/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TCK-${stamp}-${suffix}`;
}

function ticketQrToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function isSalesOpen(event, now = new Date()) {
  if (event.status !== "PUBLISHED") return false;
  if (event.salesOpenAt && new Date(event.salesOpenAt) > now) return false;
  if (event.salesCloseAt && new Date(event.salesCloseAt) < now) return false;
  return true;
}

async function getTicketTypeAvailability(ticketTypeId) {
  const [ticketType, reservedCount] = await Promise.all([
    prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: { event: true },
    }),
    prisma.ticket.count({
      where: {
        ticketTypeId,
        status: { in: ["RESERVED", "ACTIVE", "USED"] },
      },
    }),
  ]);

  if (!ticketType) return null;
  const remaining =
    ticketType.capacity == null
      ? null
      : Math.max(0, Number(ticketType.capacity) - reservedCount);
  return { ticketType, reservedCount, remaining };
}

function serializeEvent(event) {
  const ticketTypes = Array.isArray(event.ticketTypes) ? event.ticketTypes : [];
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    description: event.description,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    posterUrl: event.posterUrl,
    status: event.status,
    ticketTypes: ticketTypes.map((type) => ({
      id: type.id,
      label: type.label,
      description: type.description,
      priceFcfa: type.priceFcfa,
      capacity: type.capacity,
      maxPerOrder: type.maxPerOrder,
      active: type.active,
      sortOrder: type.sortOrder,
      soldCount: Number(type._count?.tickets || 0),
      remaining:
        type.capacity == null
          ? null
          : Math.max(0, Number(type.capacity) - Number(type._count?.tickets || 0)),
    })),
  };
}

async function listPublicEvents(req, res) {
  try {
    const events = await prisma.ticketEvent.findMany({
      where: {
        countryId: req.countryId,
        status: "PUBLISHED",
      },
      orderBy: [{ startsAt: "asc" }],
      include: {
        ticketTypes: {
          where: { active: true },
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
      },
    });

    return res.json({ data: events.map(serializeEvent) });
  } catch (error) {
    console.error("listPublicEvents error:", error);
    return res.status(500).json({ message: "Erreur serveur (listPublicEvents)" });
  }
}

async function getPublicEvent(req, res) {
  try {
    const slug = normalizeSlug(req.params.slug);
    const event = await prisma.ticketEvent.findFirst({
      where: {
        countryId: req.countryId,
        slug,
        status: "PUBLISHED",
      },
      include: {
        ticketTypes: {
          where: { active: true },
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
      },
    });

    if (!event) return res.status(404).json({ message: "Événement introuvable" });
    return res.json(serializeEvent(event));
  } catch (error) {
    console.error("getPublicEvent error:", error);
    return res.status(500).json({ message: "Erreur serveur (getPublicEvent)" });
  }
}

async function createTicketOrder(req, res) {
  try {
    const {
      eventSlug,
      ticketTypeId,
      quantity,
      buyerFullName,
      buyerPhone,
      buyerEmail,
      buyerFboNumber,
      buyerFboName,
      holderFullName,
      paymentMethod,
      note,
    } = req.body || {};

    const qty = Math.max(1, Math.min(50, Number.parseInt(quantity, 10) || 1));
    const normalizedBuyerName = String(buyerFullName || "").trim();
    const normalizedBuyerPhone = digitsOnly(buyerPhone);
    const normalizedHolderName = String(holderFullName || buyerFullName || "").trim();

    if (!eventSlug || !ticketTypeId) {
      return res.status(400).json({ message: "Événement et type de billet requis." });
    }
    if (!normalizedBuyerName || !normalizedBuyerPhone) {
      return res.status(400).json({ message: "Nom et téléphone acheteur requis." });
    }
    if (!normalizedHolderName) {
      return res.status(400).json({ message: "Nom du participant requis." });
    }

    const availability = await getTicketTypeAvailability(String(ticketTypeId));
    if (!availability || availability.ticketType.event.countryId !== req.countryId) {
      return res.status(404).json({ message: "Type de billet introuvable." });
    }

    const { ticketType } = availability;
    const event = ticketType.event;
    if (event.slug !== normalizeSlug(eventSlug)) {
      return res.status(400).json({ message: "Le billet ne correspond pas à cet événement." });
    }
    if (!ticketType.active || !isSalesOpen(event)) {
      return res.status(400).json({ message: "La vente de billets n'est pas ouverte." });
    }
    if (qty > Number(ticketType.maxPerOrder || 10)) {
      return res.status(400).json({ message: `Maximum ${ticketType.maxPerOrder} billet(s) par commande.` });
    }
    if (availability.remaining != null && qty > availability.remaining) {
      return res.status(409).json({ message: "Capacité insuffisante pour ce type de billet." });
    }

    const order = await prisma.$transaction(async (tx) => {
      const savedOrder = await tx.ticketOrder.create({
        data: {
          countryId: req.countryId,
          eventId: event.id,
          orderNumber: ticketOrderNumber(),
          status: "PENDING_PAYMENT",
          buyerFullName: normalizedBuyerName,
          buyerPhone: normalizedBuyerPhone,
          buyerEmail: buyerEmail ? String(buyerEmail).trim().toLowerCase() : null,
          buyerFboNumber: buyerFboNumber ? String(buyerFboNumber).trim() : null,
          buyerFboName: buyerFboName ? String(buyerFboName).trim() : null,
          totalFcfa: Number(ticketType.priceFcfa || 0) * qty,
          paymentMethod: paymentMethod ? String(paymentMethod).trim().toUpperCase() : null,
          paymentStatus: "INITIATED",
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          note: note ? String(note).trim() : null,
        },
      });

      for (let i = 0; i < qty; i += 1) {
        await tx.ticket.create({
          data: {
            countryId: req.countryId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            orderId: savedOrder.id,
            ticketCode: ticketCode(),
            qrToken: ticketQrToken(),
            holderFullName: normalizedHolderName,
            holderPhone: normalizedBuyerPhone,
            holderEmail: buyerEmail ? String(buyerEmail).trim().toLowerCase() : null,
            status: "RESERVED",
          },
        });
      }

      return tx.ticketOrder.findUnique({
        where: { id: savedOrder.id },
        include: {
          event: true,
          tickets: { include: { ticketType: true } },
        },
      });
    });

    return res.status(201).json(order);
  } catch (error) {
    console.error("createTicketOrder error:", error);
    return res.status(500).json({ message: "Erreur serveur (createTicketOrder)" });
  }
}

async function getTicketOrder(req, res) {
  try {
    const order = await prisma.ticketOrder.findFirst({
      where: {
        countryId: req.countryId,
        orderNumber: String(req.params.orderNumber || "").trim().toUpperCase(),
      },
      include: {
        event: true,
        tickets: { include: { ticketType: true } },
      },
    });
    if (!order) return res.status(404).json({ message: "Commande billet introuvable" });
    return res.json(order);
  } catch (error) {
    console.error("getTicketOrder error:", error);
    return res.status(500).json({ message: "Erreur serveur (getTicketOrder)" });
  }
}

module.exports = {
  listPublicEvents,
  getPublicEvent,
  createTicketOrder,
  getTicketOrder,
};
