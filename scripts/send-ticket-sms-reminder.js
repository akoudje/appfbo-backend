/**
 * Envoie un SMS de rappel, avec le lien direct vers leur billet, à tous les
 * acheteurs PAID d'un événement — filet de rattrapage pour ceux dont l'email
 * de confirmation n'est jamais arrivé (boîte pleine, etc.). Les commandes de
 * test (isTest: true) sont exclues.
 *
 * Par défaut : DRY RUN (affiche ce qui serait envoyé, n'envoie rien).
 * Envoi réel : ajouter --send.
 *
 * Usage:
 *   node backend/scripts/send-ticket-sms-reminder.js <eventId>            (dry run)
 *   node backend/scripts/send-ticket-sms-reminder.js <eventId> --send     (envoi réel)
 */

const { PrismaClient } = require("@prisma/client");
const { signTicketOrderAccessToken } = require("../src/services/ticket-order-ticketing.service");
const { publicFrontendBaseUrl } = require("../src/services/public-url.service");

const prisma = new PrismaClient();

const SEND_DELAY_MS = 350;
const MAX_SMS_LENGTH = 160;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Même fonctions que l'email de confirmation (ticket-email-notifications.service.js
// utilise les deux mêmes), pour garantir un lien strictement identique/valide —
// notamment publicFrontendBaseUrl() qui normalise le schéma https:// (voir le
// bug corrigé plus tôt cette session sur les liens de paiement sans schéma).
function ticketOrderUrl(order) {
  const base = publicFrontendBaseUrl();
  if (!base || !order.orderNumber) return "";

  const token = signTicketOrderAccessToken(order.orderNumber);
  if (!token) return "";

  const countryCode = order.country?.code || "CIV";
  return `${base.replace(/\/+$/, "")}/tickets/${encodeURIComponent(order.orderNumber)}?country=${encodeURIComponent(countryCode)}&token=${encodeURIComponent(token)}`;
}

function buildMessage(order, url) {
  return `Forever: billet -> ${url}`;
}

async function sendOneSms({ to, message, countryCode }) {
  // require() tardif : évite de charger sms.service.js (et donc de valider
  // la config Orange) avant même d'être sûr qu'on a un event/orders valides.
  const { sendSms } = require("../src/services/sms.service");
  return sendSms({ to, message, countryCode, sensitive: true });
}

async function main() {
  const eventId = process.argv[2];
  const send = process.argv.includes("--send");

  if (!eventId) {
    console.error("Usage: node scripts/send-ticket-sms-reminder.js <eventId> [--send]");
    process.exitCode = 1;
    return;
  }

  const event = await prisma.ticketEvent.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, startsAt: true, country: { select: { code: true } } },
  });
  if (!event) {
    console.error(`Événement introuvable : ${eventId}`);
    process.exitCode = 1;
    return;
  }

  const orders = await prisma.ticketOrder.findMany({
    where: { eventId, status: "PAID", isTest: false },
    select: {
      id: true,
      orderNumber: true,
      buyerFullName: true,
      buyerPhone: true,
      country: { select: { code: true } },
      event: { select: { title: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Événement : ${event.title} (${event.country?.code || "?"}) — ${orders.length} commande(s) payée(s) hors test.`);
  console.log(send ? "Mode : ENVOI RÉEL" : "Mode : DRY RUN (rien n'est envoyé — ajoutez --send pour le faire réellement)");
  console.log("");

  const results = { sent: 0, failed: 0, skippedTooLong: 0, skippedNoUrl: 0 };
  let shown = 0;

  for (const order of orders) {
    const url = ticketOrderUrl(order);
    if (!url) {
      results.skippedNoUrl += 1;
      console.warn(`[SKIP] ${order.orderNumber} : impossible de construire le lien (config manquante).`);
      continue;
    }

    const message = buildMessage(order, url);
    if (message.length > MAX_SMS_LENGTH) {
      results.skippedTooLong += 1;
      console.warn(`[SKIP] ${order.orderNumber} : message trop long (${message.length} caractères), lien risquerait d'être tronqué.`);
      continue;
    }

    if (shown < 3) {
      console.log(`[EXEMPLE] -> ${order.buyerFullName} (${order.buyerPhone})\n  "${message}"\n`);
      shown += 1;
    }

    if (!send) continue;

    const result = await sendOneSms({
      to: order.buyerPhone,
      message,
      countryCode: order.country?.code || "CIV",
    });

    if (result.accepted) {
      results.sent += 1;
    } else {
      results.failed += 1;
      console.warn(`[ÉCHEC] ${order.orderNumber} : ${result.errorCode || "?"} ${result.errorMessage || ""}`);
    }

    await wait(SEND_DELAY_MS);
  }

  console.log("");
  console.log("Résumé :", JSON.stringify({ ...results, total: orders.length, dryRun: !send }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
