const prisma = require('../prisma');
const distribution = require('../services/ticket-distribution.service');
const {
  verifyTicketOrderAccessToken,
  paidOrderTicketInclude
} = require('../services/ticket-order-ticketing.service');
const {
  fail,
  timeZone
} = require('../services/ticket-inventory.service');
const {
  publicFrontendBaseUrl
} = require('../services/public-url.service');
const {
  serializeOrder
} = require('./ticketing.controller');
function error(res, e) {
  if (e.statusCode) return res.status(e.statusCode).json({
    message: e.message
  });
  console.error('[ticket-distribution] operation failed', {
    name: e.name,
    code: e.code
  });
  return res.status(500).json({
    message: 'Impossible de mettre à jour ce billet. Réessayez.'
  });
}
function number(req) {
  const value = String(req.params.orderNumber || '').trim().toUpperCase();
  if (!verifyTicketOrderAccessToken(value, req.query.token)) fail('Ce lien d’achat est indisponible.', 404);
  return value;
}
async function loadOwnedOrder(tx, req, orderNumber, lock = false) {
  const order = await tx.ticketOrder.findFirst({
    where: {
      countryId: req.countryId,
      orderNumber
    },
    include: paidOrderTicketInclude()
  });
  if (!order) fail('Achat introuvable.', 404);
  if (lock) {
    // Keep distribution/payment edits serialized while permitting the key-share
    // lock needed by an entrance scan when it inserts its order audit link.
    await tx.$queryRaw`SELECT "id" FROM "TicketOrder" WHERE "id" = ${order.id} FOR NO KEY UPDATE`;
    return tx.ticketOrder.findFirst({
      where: {
        id: order.id,
        countryId: req.countryId
      },
      include: paidOrderTicketInclude()
    });
  }
  return order;
}
async function assignGuest(req, res) {
  try {
    const orderNumber = number(req),
      name = distribution.guestName(req.body?.guestName);
    const expected = distribution.guestName(req.body?.expectedGuestName);
    const updated = await prisma.$transaction(async tx => {
      const order = await loadOwnedOrder(tx, req, orderNumber, true);
      const ticket = order.tickets.find(t => t.id === req.params.ticketId);
      if (!ticket) fail('Billet introuvable.', 404);
      await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticket.id} FOR UPDATE`;
      const current = await tx.ticket.findUnique({
        where: {
          id: ticket.id
        }
      });
      distribution.assertMutable(order, current);
      if ((current.assignedGuestName || '') !== expected) fail('L’attribution a changé depuis un autre appareil. Actualisez votre achat.', 409);
      const count = await tx.ticketShareEvent.count({
        where: {
          ticketId: ticket.id
        }
      });
      if (count && name !== expected && req.body.acknowledgePreviousShares !== true) fail('Ce billet a déjà été partagé. Modifier son invité n’invalide aucune copie existante. Confirmez la modification.', 409);
      await tx.ticket.update({
        where: {
          id: ticket.id
        },
        data: {
          assignedGuestName: name || null,
          guestAssignedAt: name ? new Date() : null
        }
      });
      await tx.ticketOrder.update({
        where: {
          id: order.id
        },
        data: {
          updatedAt: new Date()
        }
      });
      return loadOwnedOrder(tx, req, orderNumber);
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(serializeOrder(updated));
  } catch (e) {
    return error(res, e);
  }
}
async function getShareLink(req, res) {
  try {
    const order = await loadOwnedOrder(prisma, req, number(req));
    const ticket = order.tickets.find(t => t.id === req.params.ticketId);
    if (!ticket) fail('Billet introuvable.', 404);
    distribution.assertMutable(order, ticket);
    const params = new URLSearchParams({
      country: order.country.code,
      token: distribution.signGuestToken(ticket)
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      ticketId: ticket.id,
      distribution: distribution.distribution(ticket),
      url: `${publicFrontendBaseUrl()}/tickets/shared/${encodeURIComponent(ticket.id)}?${params}`
    });
  } catch (e) {
    return error(res, e);
  }
}
async function recordShare(req, res) {
  try {
    const orderNumber = number(req),
      input = distribution.shareInput(req.body || {});
    const updated = await prisma.$transaction(async tx => {
      const order = await loadOwnedOrder(tx, req, orderNumber, true);
      for (const entry of [...input.tickets].sort((a, b) => a.ticketId.localeCompare(b.ticketId))) {
        const ticket = order.tickets.find(t => t.id === entry.ticketId);
        if (!ticket) fail('Billet introuvable.', 404);
        await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticket.id} FOR UPDATE`;
        const current = await tx.ticket.findUnique({
          where: {
            id: ticket.id
          }
        });
        distribution.assertMutable(order, current);
        const existing = await tx.ticketShareEvent.findUnique({
          where: {
            ticketId_requestId: {
              ticketId: ticket.id,
              requestId: input.requestId
            }
          }
        });
        if (existing) {
          if (existing.channel !== input.channel) fail('Cette action de partage a déjà été enregistrée avec un autre canal.', 409);
          continue;
        }
        const last = await tx.ticketShareEvent.findFirst({
          where: {
            ticketId: ticket.id
          },
          orderBy: [{
            createdAt: 'desc'
          }, {
            id: 'desc'
          }]
        });
        if ((last?.id || null) !== entry.expectedLastShareId) fail('Un partage a été noté depuis un autre appareil. Actualisez pour vérifier son destinataire.', 409);
        if (last && input.acknowledgeRepeat !== true) fail('Ce billet a déjà été partagé. Confirmez le nouveau partage.', 409);
        await tx.ticketShareEvent.create({
          data: {
            ticketId: ticket.id,
            requestId: input.requestId,
            channel: input.channel,
            guestName: current.assignedGuestName
          }
        });
      }
      await tx.ticketOrder.update({
        where: {
          id: order.id
        },
        data: {
          updatedAt: new Date()
        }
      });
      return loadOwnedOrder(tx, req, orderNumber);
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(serializeOrder(updated));
  } catch (e) {
    return error(res, e);
  }
}
async function getSharedTicket(req, res) {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: String(req.params.ticketId || ''),
        countryId: req.countryId
      },
      include: {
        ticketType: {
          select: {
            label: true
          }
        },
        event: {
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            venueName: true,
            venueAddress: true
          }
        },
        order: {
          select: {
            status: true,
            paymentStatus: true,
            ticketIssueCode: true
          }
        }
      }
    });
    if (!ticket || !distribution.verifyGuestToken(ticket, req.query.token) || ticket.order.status !== 'PAID' || ticket.order.paymentStatus === 'REFUNDED' || ticket.order.ticketIssueCode || !['ACTIVE', 'USED'].includes(ticket.status)) fail('Ce billet est indisponible. Contactez la personne qui vous l’a partagé.', 404);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.json({
      event: ticket.event,
      countryCode: req.country?.code || String(req.headers['x-country'] || 'CIV').toUpperCase(),
      timeZone: timeZone(req.country?.code || req.headers['x-country']),
      ticket: {
        id: ticket.id,
        ticketCode: ticket.ticketCode,
        status: ticket.status,
        holderFullName: ticket.assignedGuestName || 'Invité',
        ticketType: ticket.ticketType,
        checkedInAt: ticket.checkedInAt,
        ...(ticket.status === 'ACTIVE' ? {
          qrToken: ticket.qrToken
        } : {})
      }
    });
  } catch (e) {
    return error(res, e);
  }
}
module.exports = {
  assignGuest,
  getShareLink,
  recordShare,
  getSharedTicket
};
