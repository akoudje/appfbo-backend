// Gestion des commandes de billets : liste, vente cash au guichet,
// encaissement manuel, synchronisation Wave, annulation, renvoi d'email,
// expiration des commandes non payées.

const prisma = require("../../../prisma");
const ticketWavePaymentService = require("../../../services/ticket-wave-payment.service");
const {
  ticketOrderNumber,
  ensureTicketsActivatedForPaidOrder,
  paidOrderTicketInclude,
} = require("../../../services/ticket-order-ticketing.service");
const { normalizeEmail } = require("../../../services/email.service");
const { sendTicketOrderEmail } = require("../../../services/ticket-email-notifications.service");
const { publicFrontendBaseUrl } = require("../../../services/public-url.service");
const { expireStaleTicketOrders } = require("../../../services/ticket-order-expiration.service");
const { digitsOnly, buildOrdersWhere } = require("./shared");

async function listOrders(req, res) {
  try {
    const { eventId, status, q, paymentMethod } = req.query;
    const where = buildOrdersWhere(req, { eventId, status, q, paymentMethod });

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
    const requestedEmail = normalizeEmail(req.body?.email || req.body?.recipientEmail || "");
    if ((req.body?.email || req.body?.recipientEmail) && !requestedEmail) {
      return res.status(400).json({ message: "Adresse email de renvoi invalide." });
    }

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

    const result = await sendTicketOrderEmail({
      order,
      publicUrl: publicFrontendBaseUrl(req),
      recipientEmail: requestedEmail || undefined,
    });
    if (!result.sent) {
      return res.status(400).json({
        message: result.reason === "NO_EMAIL"
          ? "Aucune adresse email n'est associée à cette commande."
          : "Email non envoyé.",
        result,
      });
    }

    return res.json({ ok: true, sentTo: result.to, recipientOverridden: Boolean(requestedEmail) });
  } catch (error) {
    console.error("ticketEvents.resendOrderTicketsEmail error:", error);
    return res.status(500).json({ message: "Erreur serveur (resendOrderTicketsEmail)" });
  }
}

// Depuis l'ajout du scheduler automatique (ticket-order-expiration.service.js),
// ce bouton admin n'est plus la seule ligne de défense contre les commandes
// Wave restées PENDING_PAYMENT — mais il reste utile pour forcer un passage
// immédiat (ex: juste avant de clôturer un événement). Délègue au même
// service pour bénéficier du garde-fou "re-sync Wave avant d'annuler".
async function expireOrders(req, res) {
  try {
    const { eventId } = req.body || {};
    const result = await expireStaleTicketOrders({
      countryId: req.countryId,
      eventId: eventId ? String(eventId) : null,
    });

    return res.json({ expired: result.expiredCount, skippedPaid: result.skippedPaidCount });
  } catch (error) {
    console.error("ticketEvents.expireOrders error:", error);
    return res.status(500).json({ message: "Erreur serveur (expireOrders)" });
  }
}

module.exports = {
  listOrders,
  createCashOrder,
  markOrderPaid,
  syncOrderWavePayment,
  cancelOrder,
  resendOrderTicketsEmail,
  expireOrders,
};
