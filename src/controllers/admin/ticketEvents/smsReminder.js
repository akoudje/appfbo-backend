// Rappel SMS "voici votre billet" déclenché depuis l'admin, pour les
// acheteurs dont l'email de confirmation n'arrive jamais (boîte pleine...).
// Le message et le ciblage viennent de ticket-sms-reminder.service.js,
// partagé avec scripts/send-ticket-sms-reminder.js (même source de vérité).

const prisma = require("../../../prisma");
const reminder = require("../../../services/ticket-sms-reminder.service");

async function getSmsReminderPreview(req, res) {
  try {
    const eventId = req.params.id;
    const { onlyPhone, limit } = req.query;

    const event = await prisma.ticketEvent.findFirst({
      where: { id: eventId, countryId: req.countryId },
      select: { id: true, title: true, country: { select: { code: true } } },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable." });

    const orders = await reminder.listReminderOrders(eventId);
    const targets = reminder.filterTargets(orders, { onlyPhone, limit, countryCode: event.country?.code });
    const sample = targets.length ? reminder.buildReminderPreview(targets[0]) : null;
    const phoneCounts = reminder.countOrdersByPhone(orders, event.country?.code);
    const multiOrderPhoneCount = [...phoneCounts.values()].filter((count) => count > 1).length;

    return res.json({
      eventTitle: event.title,
      totalPaid: orders.length,
      targetCount: targets.length,
      sampleMessage: sample?.message || null,
      sampleOk: sample ? sample.ok : null,
      multiOrderPhoneCount,
      portalHintMessage: multiOrderPhoneCount ? reminder.buildPortalHintMessage() : null,
    });
  } catch (error) {
    console.error("ticketEvents.getSmsReminderPreview error:", error);
    return res.status(500).json({ message: "Erreur serveur (getSmsReminderPreview)" });
  }
}

// Envoi en arrière-plan : des centaines de SMS séquentiels (délai anti-rafale
// inclus) dépasseraient largement le temps d'une requête HTTP classique. La
// cible exacte est déjà connue de l'admin via l'aperçu avant confirmation ;
// le résultat final est journalisé côté serveur.
async function sendSmsReminder(req, res) {
  try {
    const eventId = req.params.id;
    const { onlyPhone, limit } = req.body || {};

    const event = await prisma.ticketEvent.findFirst({
      where: { id: eventId, countryId: req.countryId },
      select: { id: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable." });

    const orders = await reminder.listReminderOrders(eventId);
    const targets = reminder.filterTargets(orders, { onlyPhone, limit, countryCode: req.country?.code });
    if (!targets.length) {
      return res.status(400).json({ message: "Aucun destinataire ne correspond à ces critères." });
    }

    res.json({ started: true, total: targets.length });

    const actorAdminId = req.user?.id || null;
    reminder
      .sendReminders({ eventId, onlyPhone, limit })
      .then(({ results }) => {
        console.log("[ticket-sms-reminder] terminé", { eventId, actorAdminId, ...results });
      })
      .catch((error) => {
        console.error("[ticket-sms-reminder] échec", { eventId, actorAdminId, error });
      });
  } catch (error) {
    console.error("ticketEvents.sendSmsReminder error:", error);
    return res.status(500).json({ message: "Erreur serveur (sendSmsReminder)" });
  }
}

module.exports = {
  getSmsReminderPreview,
  sendSmsReminder,
};
