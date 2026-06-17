const crypto = require("crypto");

function ticketCode() {
  const stamp = new Date().toISOString().slice(2, 10).replace(/\D/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TCK-${stamp}-${suffix}`;
}

function ticketQrToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function paidOrderTicketInclude() {
  return {
    country: { select: { code: true } },
    event: true,
    ticketType: true,
    tickets: { include: { ticketType: true } },
  };
}

async function ensureTicketsActivatedForPaidOrder(tx, order) {
  const existingTickets = Array.isArray(order.tickets) ? order.tickets : [];
  if (existingTickets.length > 0) {
    await tx.ticket.updateMany({
      where: { orderId: order.id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
    return;
  }

  const ticketTypeId = order.ticketTypeId || order.ticketType?.id || null;
  if (!ticketTypeId) {
    throw new Error("Type de ticket introuvable pour générer les billets.");
  }

  const quantity = Math.max(1, Math.min(50, Number.parseInt(order.quantity, 10) || 1));
  const holderFullName = order.holderFullName || order.buyerFullName;
  const holderPhone = order.holderPhone || order.buyerPhone || null;
  const holderEmail = order.holderEmail || order.buyerEmail || null;

  for (let i = 0; i < quantity; i += 1) {
    await tx.ticket.create({
      data: {
        countryId: order.countryId,
        eventId: order.eventId,
        ticketTypeId,
        orderId: order.id,
        ticketCode: ticketCode(),
        qrToken: ticketQrToken(),
        holderFullName,
        holderPhone,
        holderEmail,
        status: "ACTIVE",
      },
    });
  }
}

module.exports = {
  ensureTicketsActivatedForPaidOrder,
  paidOrderTicketInclude,
};
