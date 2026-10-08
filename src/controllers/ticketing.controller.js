const prisma = require("../prisma");
const wave = require("../services/ticket-wave-payment.service");
const inventory = require("../services/ticket-inventory.service");
const { computePaymentPricing } = require("../payments/payment-pricing");
const { normalizeEmail } = require("../services/email.service");
const {
  sendTicketOrderEmail,
  sendTicketOrderAccessEmail,
} = require("../services/ticket-email-notifications.service");
const { publicFrontendBaseUrl } = require("../services/public-url.service");
const {
  ticketOrderNumber,
  signTicketOrderAccessToken,
  verifyTicketOrderAccessToken,
  ensureTicketsActivatedForPaidOrder,
  paidOrderTicketInclude,
} = require("../services/ticket-order-ticketing.service");
const { fail, quantity, salesState, timeZone } = inventory;
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
function error(res, e) {
  if (e.code === "P2002")
    return res.status(409).json({
      message: "Cet achat existe déjà. Reprenez-le depuis son lien sécurisé.",
    });
  if (e.statusCode)
    return res
      .status(e.statusCode)
      .json({ message: e.message, code: e.code || undefined });
  console.error("Public tickets:", e);
  return res.status(500).json({
    message:
      "Impossible de terminer cette opération. Réessayez dans un instant.",
  });
}
function assertOrderAccessToken(req, res, number) {
  if (verifyTicketOrderAccessToken(number, req.query?.token || req.body?.token))
    return true;
  res.status(404).json({
    message:
      "Ce lien d’achat est incomplet ou indisponible. Utilisez le lien reçu par email ou retrouvez vos tickets.",
  });
  return false;
}
const eventInclude = {
  country: { select: { name: true, code: true } },
  ticketTypes: {
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  },
};
function serializeEvent(event, counts = new Map()) {
  const state = salesState(event),
    globalCount = counts.get("event:" + event.id) || 0,
    globalRemaining =
      event.capacity == null ? null : Math.max(0, event.capacity - globalCount);
  const ticketTypes = (event.ticketTypes || []).map((t) => {
    const local =
      t.capacity == null
        ? null
        : Math.max(0, t.capacity - (counts.get("type:" + t.id) || 0));
    const remaining =
      local === null
        ? globalRemaining
        : globalRemaining === null
          ? local
          : Math.min(local, globalRemaining);
    return {
      id: t.id,
      label: t.label,
      description: t.description,
      priceFcfa: t.priceFcfa,
      maxPerOrder: t.maxPerOrder,
      active: t.active,
      remaining,
    };
  });
  const available = ticketTypes.some(
    (t) => t.active && (t.remaining == null || t.remaining > 0),
  );
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    description: event.description,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    countryName: event.country?.name || null,
    countryCode: event.country?.code,
    timeZone: timeZone(event.country?.code),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    posterUrl: event.posterUrl,
    videoUrl: event.videoUrl,
    salesOpenAt: event.salesOpenAt,
    salesCloseAt: event.salesCloseAt,
    salesStatus: state === "OPEN" && !available ? "SOLD_OUT" : state,
    remaining: globalRemaining,
    ticketTypes,
  };
}
function serializeOrder(order) {
  const pricing = computePaymentPricing({
    paymentMode: order.paymentMethod || "WAVE",
    orderTotalFcfa: order.totalFcfa,
  });
  const countryCode = order.country?.code || "CIV";
  const token = signTicketOrderAccessToken(order.orderNumber);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    totalFcfa: order.totalFcfa,
    paymentServiceFeeFcfa:
      order.paymentServiceFeeFcfa ?? pricing.paymentServiceFeeFcfa,
    amountToPayFcfa: order.amountToPayFcfa ?? pricing.amountToPayFcfa,
    quantity: order.quantity,
    buyerFullName: order.buyerFullName,
    buyerPhone: order.buyerPhone,
    buyerEmail: order.buyerEmail,
    paidAt: order.paidAt,
    expiresAt: order.expiresAt,
    ticketIssueCode: order.ticketIssueCode,
    countryCode,
    timeZone: timeZone(countryCode),
    updatedAt: order.updatedAt,
    event: order.event
      ? serializeEvent({ ...order.event, country: order.country })
      : null,
    ticketType: order.ticketType
      ? { id: order.ticketType.id, label: order.ticketType.label }
      : null,
    tickets: (order.tickets || [])
      .filter((t) => ["ACTIVE", "USED"].includes(t.status))
      .map((t) => ({
        id: t.id,
        ticketCode: t.ticketCode,
        qrToken: t.qrToken,
        holderFullName: t.holderFullName,
        status: t.status,
        ticketType: { label: t.ticketType?.label || order.ticketType?.label },
      })),
    accessToken: token,
  };
}
async function listPublicEvents(req, res) {
  try {
    const events = await prisma.ticketEvent.findMany({
      where: {
        countryId: req.countryId,
        status: { in: ["PUBLISHED", "CLOSED", "CANCELLED"] },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      include: eventInclude,
    });
    const counts = await inventory.availability(events);
    return res.json({ data: events.map((e) => serializeEvent(e, counts)) });
  } catch (e) {
    return error(res, e);
  }
}
async function getPublicEvent(req, res) {
  try {
    const event = await prisma.ticketEvent.findFirst({
      where: {
        countryId: req.countryId,
        slug: normalizeSlug(req.params.slug),
        status: { in: ["PUBLISHED", "CLOSED", "CANCELLED"] },
      },
      include: eventInclude,
    });
    if (!event) fail("Événement introuvable.", 404);
    return res.json(
      serializeEvent(event, await inventory.availability([event])),
    );
  } catch (e) {
    return error(res, e);
  }
}
async function quote(req, res) {
  try {
    const qty = quantity(req.body.quantity);
    const type = await prisma.ticketType.findFirst({
      where: {
        id: req.body.ticketTypeId,
        event: {
          countryId: req.countryId,
          slug: normalizeSlug(req.params.slug),
        },
      },
      include: { event: true },
    });
    if (!type || !type.active) fail("Billet indisponible.", 404);
    if (salesState(type.event) !== "OPEN")
      fail("La vente de billets est fermée pour cet événement.", 409);
    if (qty > type.maxPerOrder)
      fail(`Maximum ${type.maxPerOrder} billets par achat.`);
    await inventory.assertCapacity(prisma, type.event, type, qty);
    return res.json({
      quantity: qty,
      ticketTypeId: type.id,
      unitPriceFcfa: type.priceFcfa,
      ...computePaymentPricing({
        paymentMode: type.priceFcfa === 0 ? "FREE" : "WAVE",
        orderTotalFcfa: type.priceFcfa * qty,
      }),
    });
  } catch (e) {
    return error(res, e);
  }
}
function buyer(body) {
  const name = String(body.buyerFullName || "").trim(),
    phone = digitsOnly(body.buyerPhone),
    email = normalizeEmail(body.buyerEmail || "");
  if (!name || name.length > 200)
    fail("Renseignez votre nom complet (200 caractères maximum).");
  if (!/^\d{8,15}$/.test(phone))
    fail("Renseignez un numéro de téléphone valide.");
  if (!email || email.length > 254)
    fail("Renseignez une adresse email valide pour recevoir vos tickets.");
  return {
    buyerFullName: name,
    buyerPhone: phone,
    buyerEmail: email,
    holderFullName: name,
    holderPhone: phone,
    holderEmail: email,
  };
}
async function createTicketOrder(req, res) {
  try {
    const body = req.body || {},
      qty = quantity(body.quantity),
      identity = buyer(body);
    const key = body.clientRequestId;
    if (
      key !== undefined &&
      (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(key))
    )
      fail("Identifiant de reprise invalide.");
    const type = await prisma.ticketType.findFirst({
      where: {
        id: String(body.ticketTypeId || ""),
        event: {
          countryId: req.countryId,
          slug: normalizeSlug(body.eventSlug),
        },
      },
      include: { event: true },
    });
    if (!type) fail("Type de billet introuvable.", 404);
    let newlyCreated = false;
    const order = await prisma.$transaction(async (tx) => {
      await inventory.lockEvent(tx, type.eventId);
      if (key) {
        const existing = await tx.ticketOrder.findUnique({
          where: {
            countryId_clientRequestId: {
              countryId: req.countryId,
              clientRequestId: key,
            },
          },
          include: paidOrderTicketInclude(),
        });
        if (existing) {
          if (
            existing.eventId !== type.eventId ||
            existing.ticketTypeId !== type.id ||
            existing.quantity !== qty ||
            existing.buyerPhone !== identity.buyerPhone ||
            existing.buyerEmail !== identity.buyerEmail ||
            existing.buyerFullName !== identity.buyerFullName
          )
            fail(
              "Les informations de cet achat ont changé. Reprenez-le ou démarrez un nouvel achat.",
              409,
            );
          return existing;
        }
      }
      const fresh = await tx.ticketType.findUnique({
        where: { id: type.id },
        include: { event: true },
      });
      if (!fresh.active || salesState(fresh.event) !== "OPEN")
        fail("La vente de billets n’est pas ouverte.", 409);
      if (qty > fresh.maxPerOrder)
        fail(`Maximum ${fresh.maxPerOrder} billets par achat.`);
      const total = fresh.priceFcfa * qty,
        pricing = computePaymentPricing({
          paymentMode: total === 0 ? "FREE" : "WAVE",
          orderTotalFcfa: total,
        });
      if (
        !Number.isSafeInteger(total) ||
        total < 0 ||
        pricing.amountToPayFcfa > 2147483647
      )
        fail("Le montant de cet achat est invalide ou trop élevé.");
      if (
        body.expectedAmountToPayFcfa !== undefined &&
        Number(body.expectedAmountToPayFcfa) !== pricing.amountToPayFcfa
      )
        fail(
          "Le prix a changé. Vérifiez le nouveau récapitulatif avant de continuer.",
          409,
          "PRICE_CHANGED",
        );
      await inventory.assertCapacity(tx, fresh.event, fresh, qty);
      newlyCreated = true;
      const saved = await tx.ticketOrder.create({
        data: {
          countryId: req.countryId,
          eventId: fresh.eventId,
          ticketTypeId: fresh.id,
          orderNumber: ticketOrderNumber(),
          clientRequestId: key || null,
          ...identity,
          quantity: qty,
          totalFcfa: total,
          paymentServiceFeeFcfa: pricing.paymentServiceFeeFcfa,
          amountToPayFcfa: pricing.amountToPayFcfa,
          status: total === 0 ? "PAID" : "PENDING_PAYMENT",
          paymentMethod: total === 0 ? "FREE" : "WAVE",
          paymentProvider: total === 0 ? "FREE" : "WAVE",
          paymentStatus: total === 0 ? "SUCCEEDED" : "INITIATED",
          paidAt: total === 0 ? new Date() : null,
          expiresAt: total === 0 ? null : new Date(Date.now() + 30 * 60000),
        },
      });
      if (total === 0) await ensureTicketsActivatedForPaidOrder(tx, saved);
      return tx.ticketOrder.findUnique({
        where: { id: saved.id },
        include: paidOrderTicketInclude(),
      });
    });
    if (order.status === "PAID") {
      if (newlyCreated && order.paymentMethod === "FREE")
        sendTicketOrderEmail({
          order,
          publicUrl: publicFrontendBaseUrl(req),
        }).catch(() => {});
      return res.status(201).json({
        ...serializeOrder(order),
        checkoutUrl: null,
        paymentInitiated: false,
      });
    }
    let payment = null,
      paymentError = null;
    try {
      payment = await wave.initiateTicketWavePayment({
        req,
        orderNumber: order.orderNumber,
      });
    } catch (e) {
      console.warn("Ticket checkout deferred:", e.message);
      paymentError =
        "Votre achat est enregistré. Reprenez le paiement depuis cette page.";
    }
    return res.status(201).json({
      ...serializeOrder(payment?.order || order),
      checkoutUrl: payment?.checkoutUrl || null,
      paymentInitiated: !!payment?.checkoutUrl,
      paymentError,
    });
  } catch (e) {
    return error(res, e);
  }
}
async function getTicketOrder(req, res) {
  try {
    const number = String(req.params.orderNumber || "")
      .trim()
      .toUpperCase();
    if (!assertOrderAccessToken(req, res, number)) return;
    const order = await prisma.ticketOrder.findFirst({
      where: { countryId: req.countryId, orderNumber: number },
      include: paidOrderTicketInclude(),
    });
    if (!order) fail("Achat introuvable.", 404);
    return res.json(serializeOrder(order));
  } catch (e) {
    return error(res, e);
  }
}
async function initiateTicketWavePayment(req, res) {
  try {
    const number = String(req.params.orderNumber || "")
      .trim()
      .toUpperCase();
    if (!assertOrderAccessToken(req, res, number)) return;
    const result = await wave.initiateTicketWavePayment({
      req,
      orderNumber: number,
    });
    return res.json({ ...result, order: serializeOrder(result.order) });
  } catch (e) {
    return error(res, e);
  }
}
async function syncTicketWavePaymentStatus(req, res) {
  try {
    const number = String(req.params.orderNumber || "")
      .trim()
      .toUpperCase();
    if (!assertOrderAccessToken(req, res, number)) return;
    const result = await wave.syncTicketWavePaymentStatus({
      req,
      orderNumber: number,
    });
    return res.json({ ok: true, order: serializeOrder(result.order) });
  } catch (e) {
    return error(res, e);
  }
}
async function recoverTicketOrder(req, res) {
  try {
    const identifier = String(req.body?.identifier || "").trim();
    const orderNumber = String(req.body?.orderNumber || "")
      .trim()
      .toUpperCase();
    const normalizedEmail = normalizeEmail(identifier);
    const normalizedPhone =
      /^[+\d ().-]+$/.test(identifier) &&
      /^\d{8,15}$/.test(digitsOnly(identifier))
        ? digitsOnly(identifier)
        : "";

    const neutralResponse = {
      ok: true,
      message:
        "Si un achat correspond à ces informations, son lien sécurisé sera renvoyé à l’adresse email associée.",
    };

    if (!identifier && !orderNumber) return res.json(neutralResponse);

    const where = {
      countryId: req.countryId,
      status: { in: ["PAID", "PENDING_PAYMENT", "EXPIRED"] },
    };
    if (orderNumber) where.orderNumber = orderNumber;
    if (identifier) {
      where.OR = [
        ...(normalizedEmail
          ? [{ buyerEmail: normalizedEmail }, { holderEmail: normalizedEmail }]
          : []),
        ...(normalizedPhone
          ? [{ buyerPhone: normalizedPhone }, { holderPhone: normalizedPhone }]
          : []),
      ];
      if (!where.OR.length) return res.json(neutralResponse);
    }

    const order = await prisma.ticketOrder.findFirst({
      where,
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      include: {
        country: { select: { code: true } },
        event: true,
        ticketType: true,
        tickets: { include: { ticketType: true } },
      },
    });

    if (order?.buyerEmail || order?.holderEmail) {
      await sendTicketOrderAccessEmail({
        order,
        publicUrl: publicFrontendBaseUrl(req),
      });
    }

    return res.json(neutralResponse);
  } catch (error) {
    console.error("recoverTicketOrder error:", error);
    return res
      .status(500)
      .json({ message: "Erreur serveur (recoverTicketOrder)" });
  }
}

module.exports = {
  listPublicEvents,
  getPublicEvent,
  quote,
  createTicketOrder,
  getTicketOrder,
  recoverTicketOrder,
  initiateTicketWavePayment,
  syncTicketWavePaymentStatus,
};

async function resumeTicketOrder(req, res) {
  try {
    const key = req.body?.clientRequestId;
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(key))
      fail("Lien de reprise indisponible.", 404);
    const order = await prisma.ticketOrder.findUnique({
      where: {
        countryId_clientRequestId: {
          countryId: req.countryId,
          clientRequestId: key,
        },
      },
      include: paidOrderTicketInclude(),
    });
    if (!order) fail("Lien de reprise indisponible.", 404);
    return res.json(serializeOrder(order));
  } catch (e) {
    return error(res, e);
  }
}
module.exports.resumeTicketOrder = resumeTicketOrder;
