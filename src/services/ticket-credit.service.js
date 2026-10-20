// Consultation et échange des crédits de billets non scannés (voir
// ticket-event-closure.service.js pour leur émission). Le crédit est
// nominatif (téléphone/email du porteur d'origine) et ne s'échange que
// contre un billet de même catégorie, sur le seul TicketEvent PUBLISHED du
// même pays — réservation de places décidée manuellement par l'admin via
// TicketType.creditReservedCapacity.

const prisma = require("../prisma");
const recovery = require("./ticket-phone-recovery.service");
const { ticketCode, ticketQrToken, ticketOrderNumber } = require("./ticket-order-ticketing.service");

function fail(message, statusCode = 400, code = null) {
  throw Object.assign(new Error(message), { statusCode, code });
}

// Même filtre que ticket-phone-recovery.service.js#whereForPhone, mais sur
// le porteur du crédit plutôt que sur l'acheteur de la commande.
function whereForHolderPhone(canonical, countryId, countryCode) {
  return { countryId, holderPhone: { in: recovery.variants(canonical, countryCode) } };
}

function whereForHolderIdentity({ countryId, channel, phone, countryCode, email }) {
  if (channel === "SMS") return whereForHolderPhone(phone, countryId, countryCode);
  return { countryId, holderEmail: { equals: email, mode: "insensitive" } };
}

const ACTIVE_CREDIT_SELECT = {
  id: true,
  status: true,
  ticketTypeLabel: true,
  priceFcfaSnapshot: true,
  holderFullName: true,
  holderPhone: true,
  holderEmail: true,
  issuedAt: true,
  expiresAt: true,
  redeemedAt: true,
  originEvent: { select: { id: true, title: true, startsAt: true } },
};

async function listCreditsForHolder({ countryId, channel, phone, countryCode, email }) {
  const where = whereForHolderIdentity({ countryId, channel, phone, countryCode, email });
  const credits = await prisma.ticketCredit.findMany({
    where,
    select: ACTIVE_CREDIT_SELECT,
    orderBy: [{ issuedAt: "desc" }],
  });

  const targetEvent = await resolveRedemptionTargetEvent({ countryId });
  return { credits, targetEvent };
}

// Le seul TicketEvent en PUBLISHED dans ce pays ; s'il en existe plusieurs
// par erreur, celui qui démarre le plus tôt (cas non censé se produire —
// au plus un Success Day ouvert à la vente à la fois).
async function resolveRedemptionTargetEvent({ countryId }) {
  return prisma.ticketEvent.findFirst({
    where: { countryId, status: "PUBLISHED" },
    orderBy: [{ startsAt: "asc" }],
    include: { ticketTypes: { where: { active: true } } },
  });
}

async function redeemTicketCredit({ creditId, countryId, channel, phone, countryCode, email, now = new Date() }) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TicketCredit" WHERE id = ${creditId} FOR UPDATE`;
    const credit = await tx.ticketCredit.findFirst({
      where: { id: creditId, countryId, ...whereForHolderIdentity({ countryId, channel, phone, countryCode, email }) },
    });
    if (!credit) fail("Crédit introuvable.", 404);
    if (credit.status !== "ISSUED") fail("Ce crédit n'est plus disponible.", 409, "CREDIT_NOT_ISSUED");
    if (credit.expiresAt <= now) fail("Ce crédit a expiré.", 409, "CREDIT_EXPIRED");

    const targetEvent = await tx.ticketEvent.findFirst({
      where: { countryId, status: "PUBLISHED" },
      orderBy: [{ startsAt: "asc" }],
    });
    if (!targetEvent) fail("Aucune prochaine édition n'est ouverte pour le moment. Réessayez plus tard.", 409, "NO_TARGET_EVENT");

    const targetType = await tx.ticketType.findFirst({
      where: { eventId: targetEvent.id, label: credit.ticketTypeLabel, active: true },
    });
    if (!targetType) fail("La catégorie de votre billet n'existe pas sur cette édition. Contactez l'organisateur.", 409, "NO_MATCHING_TICKET_TYPE");

    const redeemedCount = await tx.ticketCredit.count({
      where: { status: "REDEEMED", redeemedEventId: targetEvent.id, redeemedTicket: { ticketTypeId: targetType.id } },
    });
    if (redeemedCount >= targetType.creditReservedCapacity) {
      fail("Plus de places réservées pour les crédits sur cette catégorie. Contactez l'organisateur.", 409, "CREDIT_CAPACITY_FULL");
    }

    const order = await tx.ticketOrder.create({
      data: {
        countryId,
        eventId: targetEvent.id,
        ticketTypeId: targetType.id,
        orderNumber: ticketOrderNumber(),
        status: "PAID",
        buyerFullName: credit.holderFullName || "Client",
        buyerPhone: credit.holderPhone || "",
        buyerEmail: credit.holderEmail || null,
        holderFullName: credit.holderFullName,
        holderPhone: credit.holderPhone,
        holderEmail: credit.holderEmail,
        quantity: 1,
        totalFcfa: 0,
        paymentMethod: "TICKET_CREDIT",
        paymentProvider: "TICKET_CREDIT",
        paymentStatus: "SUCCEEDED",
        paidAt: now,
        isTest: false,
      },
    });

    const ticket = await tx.ticket.create({
      data: {
        countryId,
        eventId: targetEvent.id,
        ticketTypeId: targetType.id,
        orderId: order.id,
        ticketCode: ticketCode(),
        qrToken: ticketQrToken(),
        holderFullName: credit.holderFullName,
        holderPhone: credit.holderPhone,
        holderEmail: credit.holderEmail,
        status: "ACTIVE",
      },
    });

    await tx.ticketCredit.update({
      where: { id: credit.id },
      data: { status: "REDEEMED", redeemedAt: now, redeemedEventId: targetEvent.id, redeemedOrderId: order.id, redeemedTicketId: ticket.id },
    });

    return { order, ticket, targetEvent };
  });

  return result;
}

module.exports = {
  listCreditsForHolder,
  resolveRedemptionTargetEvent,
  redeemTicketCredit,
};
