// Auto-annulation des commandes de tickets en attente de paiement Wave dont
// la fenêtre est dépassée — même pattern que preorder-expiration.service.js
// (scheduler embarqué dans le process, activé au boot depuis server.js).
//
// Avant l'ajout de ce service, seul le bouton admin "Expirer non payés"
// (ticketEvents/orders.js#expireOrders) traitait ces commandes : si personne
// ne cliquait après la clôture d'un événement, les tentatives de paiement
// restaient PENDING_PAYMENT indéfiniment.

const prisma = require("../prisma");
const ticketWavePaymentService = require("./ticket-wave-payment.service");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isAutoExpireEnabled() {
  return String(process.env.TICKET_ORDER_AUTO_EXPIRE_ENABLED || "true").toLowerCase() !== "false";
}

function getSchedulerEveryMinutes() {
  return Math.max(1, parsePositiveInt(process.env.TICKET_ORDER_AUTO_EXPIRE_CHECK_EVERY_MINUTES, 5));
}

// Marge appliquée après expiresAt avant d'annuler pour de bon : laisse le
// temps à un paiement Wave initié in extremis de se finaliser côté
// opérateur avant que le webhook (ou notre sync) ne le confirme.
function getWaveFinalizationGraceMinutes() {
  return Math.max(0, parsePositiveInt(process.env.TICKET_ORDER_WAVE_FINALIZATION_GRACE_MINUTES, 15));
}

/**
 * Annule les commandes de tickets PENDING_PAYMENT dont la fenêtre de
 * paiement (+ marge de grâce Wave) est dépassée. Avant d'annuler une
 * commande Wave, retente une synchronisation du statut auprès de Wave : si
 * le paiement s'avère en fait confirmé (webhook manqué), la commande est
 * laissée telle quelle plutôt qu'annulée à tort — même garde-fou que
 * cancelPreorderAsExpiredUnpaid pour les précommandes.
 */
async function expireStaleTicketOrders({ now = new Date(), countryId = null, eventId = null } = {}) {
  const graceMs = getWaveFinalizationGraceMinutes() * 60 * 1000;

  const candidates = await prisma.ticketOrder.findMany({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { lt: new Date(now.getTime() - graceMs) },
      ...(countryId ? { countryId } : {}),
      ...(eventId ? { eventId } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      countryId: true,
      paymentMethod: true,
      paymentProvider: true,
    },
    take: 500,
    orderBy: { expiresAt: "asc" },
  });

  if (!candidates.length) {
    return { ok: true, checkedAt: now.toISOString(), expiredCount: 0, expired: [], skippedPaidCount: 0 };
  }

  const toExpire = [];
  const skippedPaid = [];

  for (const order of candidates) {
    const isWaveOrder =
      String(order.paymentMethod || "").toUpperCase() === "WAVE" ||
      String(order.paymentProvider || "").toUpperCase() === "WAVE";

    if (isWaveOrder) {
      try {
        const syncResult = await ticketWavePaymentService.syncTicketWavePaymentStatus({
          req: { countryId: order.countryId },
          orderNumber: order.orderNumber,
        });
        const updatedStatus = String(syncResult?.order?.status || "").toUpperCase();
        if (updatedStatus === "PAID") {
          skippedPaid.push(order.orderNumber);
          continue;
        }
      } catch (error) {
        // Échec technique du sync (Wave indisponible, etc.) : on n'annule
        // pas la commande pour autant, exactement comme pour les
        // précommandes — le pire cas est un nouveau tick 5 min plus tard.
        console.warn("[ticket-order-expiration] wave sync before expire failed", {
          orderNumber: order.orderNumber,
          message: error?.message || String(error),
        });
      }
    }

    toExpire.push(order);
  }

  if (!toExpire.length) {
    return {
      ok: true,
      checkedAt: now.toISOString(),
      expiredCount: 0,
      expired: [],
      skippedPaidCount: skippedPaid.length,
    };
  }

  const toExpireIds = toExpire.map((order) => order.id);
  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { orderId: { in: toExpireIds }, status: "RESERVED" },
      data: { status: "CANCELLED" },
    }),
    prisma.ticketOrder.updateMany({
      where: { id: { in: toExpireIds } },
      data: { status: "EXPIRED", paymentStatus: "EXPIRED" },
    }),
  ]);

  return {
    ok: true,
    checkedAt: now.toISOString(),
    expiredCount: toExpire.length,
    expired: toExpire.map((order) => order.orderNumber),
    skippedPaidCount: skippedPaid.length,
  };
}

function startTicketOrderAutoExpireScheduler() {
  if (!isAutoExpireEnabled()) {
    console.info("[ticket-order-expiration] scheduler disabled via TICKET_ORDER_AUTO_EXPIRE_ENABLED");
    return null;
  }

  const intervalMs = getSchedulerEveryMinutes() * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await expireStaleTicketOrders({ now: new Date() });
      if (result.expiredCount > 0 || result.skippedPaidCount > 0) {
        console.log("[ticket-order-expiration] auto-expire summary", result);
      }
    } catch (error) {
      console.error("[ticket-order-expiration] scheduler error", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  tick().catch(() => {});
  return timer;
}

module.exports = {
  expireStaleTicketOrders,
  startTicketOrderAutoExpireScheduler,
};
