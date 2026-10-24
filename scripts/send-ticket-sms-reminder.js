/**
 * Envoie un SMS de rappel, avec le lien direct vers leur billet, à tous les
 * acheteurs PAID d'un événement — filet de rattrapage pour ceux dont l'email
 * de confirmation n'est jamais arrivé (boîte pleine, etc.). Les commandes de
 * test (isTest: true) sont exclues.
 *
 * Même logique que le bouton admin (ticketEvents/smsReminder.js) : les deux
 * passent par ticket-sms-reminder.service.js, pour ne jamais diverger sur le
 * message envoyé.
 *
 * Par défaut : DRY RUN (affiche ce qui serait envoyé, n'envoie rien).
 * Envoi réel : ajouter --send.
 * --only=<téléphone> : limite aux commandes dont le numéro acheteur
 *   correspond (test réel ciblé, avant un envoi en masse).
 * --limit=<N> : limite aux N premières commandes (après --only s'il est
 *   fourni).
 *
 * Usage:
 *   node backend/scripts/send-ticket-sms-reminder.js <eventId>                          (dry run, tout le monde)
 *   node backend/scripts/send-ticket-sms-reminder.js <eventId> --only=0700000000 --send  (test réel, un seul numéro)
 *   node backend/scripts/send-ticket-sms-reminder.js <eventId> --send                   (envoi réel à tout le monde)
 */

const { PrismaClient } = require("@prisma/client");
const reminder = require("../src/services/ticket-sms-reminder.service");

const prisma = new PrismaClient();

async function main() {
  const eventId = process.argv[2];
  const send = process.argv.includes("--send");
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const onlyPhone = onlyArg ? onlyArg.slice("--only=".length).trim() : null;
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.slice("--limit=".length), 10) : null;

  if (!eventId) {
    console.error("Usage: node scripts/send-ticket-sms-reminder.js <eventId> [--only=<téléphone>] [--limit=<N>] [--send]");
    process.exitCode = 1;
    return;
  }

  const event = await prisma.ticketEvent.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, country: { select: { code: true } } },
  });
  if (!event) {
    console.error(`Événement introuvable : ${eventId}`);
    process.exitCode = 1;
    return;
  }

  const orders = await reminder.listReminderOrders(eventId);
  const targets = reminder.filterTargets(orders, { onlyPhone, limit, countryCode: event.country?.code });

  if (onlyPhone && !targets.length) {
    console.error(`Aucune commande PAID (hors test) trouvée pour le numéro ${onlyPhone}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Événement : ${event.title} (${event.country?.code || "?"}) — ${orders.length} commande(s) payée(s) hors test.`);
  if (onlyPhone || limit) {
    console.log(`Filtré à ${targets.length} commande(s) (--only=${onlyPhone || "-"} --limit=${limit || "-"}).`);
  }
  console.log(send ? "Mode : ENVOI RÉEL" : "Mode : DRY RUN (rien n'est envoyé — ajoutez --send pour le faire réellement)");
  console.log("");

  if (!send) {
    let shown = 0;
    const results = { ok: 0, skippedTooLong: 0, skippedNoUrl: 0 };
    for (const order of targets) {
      const preview = reminder.buildReminderPreview(order);
      if (!preview.ok) {
        if (preview.reason === "TOO_LONG") results.skippedTooLong += 1;
        else results.skippedNoUrl += 1;
        console.warn(`[SKIP] ${order.orderNumber} : ${preview.reason}`);
        continue;
      }
      results.ok += 1;
      if (shown < 3) {
        console.log(`[EXEMPLE] -> ${order.buyerFullName} (${order.buyerPhone})\n  "${preview.message}"\n`);
        shown += 1;
      }
    }
    console.log("Résumé :", JSON.stringify({ ...results, total: targets.length, dryRun: true }, null, 2));
    return;
  }

  const { results } = await reminder.sendReminders({
    eventId,
    onlyPhone,
    limit,
    onProgress: ({ order, preview, result }) => {
      if (!preview.ok) {
        console.warn(`[SKIP] ${order.orderNumber} : ${preview.reason}`);
      } else if (!result.accepted) {
        console.warn(`[ÉCHEC] ${order.orderNumber} : ${result.errorCode || "?"} ${result.errorMessage || ""}`);
      }
    },
  });

  console.log("");
  console.log("Résumé :", JSON.stringify({ ...results, dryRun: false }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
