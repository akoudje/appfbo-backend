// Clôture d'un TicketEvent + émission des crédits pour les billets payés
// jamais scannés, sur le modèle de preorder-expiration.service.js :
// transaction + re-vérification idempotente + notifications best-effort
// hors transaction. Deux déclencheurs possibles (geste admin, ou job
// automatique dès que endsAt est dépassé) appellent la même fonction.

const prisma = require("../prisma");
const { notifyCreditIssued } = require("./ticket-credit-notifications.service");
const { publishRealtimeEvent } = require("./realtime-events.service");

const DEFAULT_CREDIT_VALIDITY_MONTHS = 6;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCreditValidityMonths() {
  return parsePositiveInt(process.env.TICKET_CREDIT_VALIDITY_MONTHS, DEFAULT_CREDIT_VALIDITY_MONTHS);
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function getSchedulerEveryMinutes() {
  return Math.max(1, parsePositiveInt(process.env.TICKET_EVENT_AUTO_CLOSE_CHECK_EVERY_MINUTES, 15));
}

// Clôture l'événement (s'il est encore PUBLISHED) et émet un TicketCredit
// pour chaque billet encore ACTIVE (jamais scanné) appartenant à une
// commande payée, non test, ayant atteint le seuil de la commande fixé sur
// l'événement. Idempotent : un second appel sur un événement déjà clôturé
// est un no-op (protège contre une course entre le geste admin et le job).
async function closeTicketEventAndIssueCredits({ eventId, actorAdminId = null, now = new Date(), dryRun = false } = {}) {
  // Un create + un update par billet non scanné, en séquence : avec
  // beaucoup de billets éligibles, le délai par défaut (5s) d'une
  // transaction interactive Prisma peut être trop court face à la latence
  // réseau vers la base de prod (déjà observé sur un autre traitement par
  // lot dans ce projet). On l'étend explicitement pour ce seul appel.
  const issuedCredits = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TicketEvent" WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.ticketEvent.findUnique({
      where: { id: eventId },
      include: { country: { select: { code: true } } },
    });
    if (!event) return { skipped: true, reason: "NOT_FOUND" };
    if (event.status !== "PUBLISHED") return { skipped: true, reason: "ALREADY_CLOSED", status: event.status };

    const eligibleOrders = await tx.ticketOrder.findMany({
      where: {
        eventId: event.id,
        status: "PAID",
        isTest: false,
        quantity: { gte: event.creditEligibilityMinQuantity },
      },
      select: { id: true },
    });

    const unusedTickets = eligibleOrders.length
      ? await tx.ticket.findMany({
          where: {
            orderId: { in: eligibleOrders.map((order) => order.id) },
            status: "ACTIVE",
          },
          select: {
            id: true,
            orderId: true,
            ticketTypeId: true,
            holderFullName: true,
            holderPhone: true,
            holderEmail: true,
            ticketType: { select: { label: true, priceFcfa: true } },
          },
        })
      : [];

    if (dryRun) {
      return { skipped: false, dryRun: true, eligibleOrdersCount: eligibleOrders.length, unusedTicketsCount: unusedTickets.length };
    }

    await tx.ticketEvent.update({ where: { id: event.id }, data: { status: "CLOSED", updatedById: actorAdminId } });

    const expiresAt = addMonths(now, getCreditValidityMonths());
    const credits = [];
    for (const ticket of unusedTickets) {
      const credit = await tx.ticketCredit.create({
        data: {
          countryId: event.countryId,
          originEventId: event.id,
          originOrderId: ticket.orderId,
          originTicketId: ticket.id,
          originTicketTypeId: ticket.ticketTypeId,
          ticketTypeLabel: ticket.ticketType?.label || "",
          priceFcfaSnapshot: ticket.ticketType?.priceFcfa || 0,
          holderFullName: ticket.holderFullName,
          holderPhone: ticket.holderPhone,
          holderEmail: ticket.holderEmail,
          expiresAt,
        },
      });
      await tx.ticket.update({ where: { id: ticket.id }, data: { status: "EXPIRED" } });
      credits.push(credit);
    }

    return { skipped: false, dryRun: false, event, credits };
  }, { timeout: 30000, maxWait: 15000 });

  if (issuedCredits.skipped || issuedCredits.dryRun) return issuedCredits;

  for (const credit of issuedCredits.credits) {
    try {
      await notifyCreditIssued({
        credit,
        originEvent: issuedCredits.event,
        countryCode: issuedCredits.event.country?.code,
      });
    } catch (error) {
      console.error("[ticket-event-closure] notification error:", error);
    }
  }

  publishRealtimeEvent({
    countryId: issuedCredits.event.countryId,
    eventKey: "ticket_credits_issued",
    orderId: issuedCredits.event.id,
    meta: { eventId: issuedCredits.event.id, creditsCount: issuedCredits.credits.length },
  });

  return { ok: true, skipped: false, creditsCount: issuedCredits.credits.length, eventId: issuedCredits.event.id };
}

function startTicketEventAutoCloseScheduler() {
  if (String(process.env.TICKET_EVENT_AUTO_CLOSE_ENABLED || "true").toLowerCase() !== "true") {
    console.info("[ticket-event-closure] scheduler disabled via TICKET_EVENT_AUTO_CLOSE_ENABLED");
    return null;
  }

  const intervalMs = getSchedulerEveryMinutes() * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const candidates = await prisma.ticketEvent.findMany({
        where: { status: "PUBLISHED", endsAt: { not: null, lt: now } },
        select: { id: true },
      });
      for (const candidate of candidates) {
        const result = await closeTicketEventAndIssueCredits({ eventId: candidate.id, now });
        if (!result?.skipped) {
          console.log("[ticket-event-closure] auto-close summary", { eventId: candidate.id, ...result });
        }
      }
    } catch (error) {
      console.error("[ticket-event-closure] scheduler error", error);
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
  closeTicketEventAndIssueCredits,
  startTicketEventAutoCloseScheduler,
};
