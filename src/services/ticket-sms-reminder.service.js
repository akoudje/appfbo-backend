// Rappel SMS "voici votre billet", pour les acheteurs dont l'email de
// confirmation n'arrive jamais (boîte pleine, etc.). Source unique de
// vérité pour le message et le ciblage — réutilisée par le script
// (scripts/send-ticket-sms-reminder.js) et par le bouton admin
// (ticketEvents/smsReminder.js), pour que les deux ne divergent jamais.

const prisma = require("../prisma");
const { normalizeForCountry } = require("../utils/phone");
const { signTicketOrderAccessToken } = require("./ticket-order-ticketing.service");
const { publicFrontendBaseUrl } = require("./public-url.service");
const { sendSms } = require("./sms.service");

const MAX_SMS_LENGTH = 160;
const SEND_DELAY_MS = 350;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Même fonctions que l'email de confirmation (ticket-email-notifications.service.js),
// pour garantir un lien strictement identique/valide — notamment
// publicFrontendBaseUrl() qui normalise le schéma https://.
function ticketOrderUrl(order) {
  const base = publicFrontendBaseUrl();
  if (!base || !order.orderNumber) return "";

  const token = signTicketOrderAccessToken(order.orderNumber);
  if (!token) return "";

  const countryCode = order.country?.code || "CIV";
  return `${base.replace(/\/+$/, "")}/tickets/${encodeURIComponent(order.orderNumber)}?country=${encodeURIComponent(countryCode)}&token=${encodeURIComponent(token)}`;
}

// Message volontairement simple, sans jargon technique (pas de "token", pas
// de mention de "lien sécurisé") : le public visé n'a pas forcément
// l'habitude des liens avec paramètres.
function buildReminderMessage(url) {
  return `FOREVER: Votre billet est ici : ${url}`;
}

// Un même acheteur peut avoir plusieurs commandes distinctes pour le même
// événement (achats séparés) : chaque commande a son propre lien, le SMS
// de rappel n'en montre qu'un. Ce second message, envoyé une seule fois par
// numéro (pas par commande), pointe vers le portail "Mes tickets" qui
// regroupe tous les achats d'un même acheteur.
function buildPortalHintMessage() {
  const base = publicFrontendBaseUrl();
  if (!base) return "";
  const portalHint = `${base.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}/tickets`;
  return `FOREVER: Vous avez plusieurs achats. Voir tous vos billets : ${portalHint}`;
}

// Regroupe les commandes par numéro normalisé pour détecter les acheteurs
// ayant plusieurs achats distincts (même téléphone, commandes séparées).
function countOrdersByPhone(orders, countryCode) {
  const counts = new Map();
  for (const order of orders) {
    const normalized = normalizeForCountry(order.buyerPhone, countryCode || "CIV");
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return counts;
}

function buildReminderPreview(order) {
  const url = ticketOrderUrl(order);
  if (!url) return { order, url: "", message: "", ok: false, reason: "NO_URL" };

  const message = buildReminderMessage(url);
  if (message.length > MAX_SMS_LENGTH) {
    return { order, url, message, ok: false, reason: "TOO_LONG" };
  }
  return { order, url, message, ok: true };
}

async function listReminderOrders(eventId) {
  return prisma.ticketOrder.findMany({
    where: { eventId, status: "PAID", isTest: false },
    select: {
      id: true,
      orderNumber: true,
      buyerFullName: true,
      buyerPhone: true,
      country: { select: { code: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

function filterTargets(orders, { onlyPhone, limit, countryCode } = {}) {
  let targets = orders;
  if (onlyPhone) {
    const normalizedTarget = normalizeForCountry(onlyPhone, countryCode || "CIV");
    targets = targets.filter(
      (order) => normalizeForCountry(order.buyerPhone, countryCode || "CIV") === normalizedTarget,
    );
  }
  const limitNumber = Number.parseInt(limit, 10);
  if (Number.isFinite(limitNumber) && limitNumber > 0) targets = targets.slice(0, limitNumber);
  return targets;
}

async function sendReminders({ eventId, onlyPhone, limit, onProgress = null }) {
  const event = await prisma.ticketEvent.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, country: { select: { code: true } } },
  });
  if (!event) throw Object.assign(new Error("Événement introuvable."), { statusCode: 404 });

  const orders = await listReminderOrders(eventId);
  const targets = filterTargets(orders, { onlyPhone, limit, countryCode: event.country?.code });
  // Calculé sur TOUTES les commandes de l'événement (pas seulement la cible
  // filtrée --only/--limit) : un acheteur a "plusieurs achats" dans l'absolu,
  // pas seulement par rapport à ce sous-ensemble d'envoi.
  const phoneCounts = countOrdersByPhone(orders, event.country?.code);
  const notifiedPhones = new Set();

  const results = {
    sent: 0,
    failed: 0,
    skippedTooLong: 0,
    skippedNoUrl: 0,
    portalHintSent: 0,
    total: targets.length,
  };

  for (const order of targets) {
    const preview = buildReminderPreview(order);
    if (!preview.ok) {
      if (preview.reason === "TOO_LONG") results.skippedTooLong += 1;
      else results.skippedNoUrl += 1;
      if (onProgress) onProgress({ order, preview, results });
      continue;
    }

    const result = await sendSms({
      to: order.buyerPhone,
      message: preview.message,
      countryCode: event.country?.code || "CIV",
      sensitive: true,
    });

    if (result.accepted) results.sent += 1;
    else results.failed += 1;

    if (onProgress) onProgress({ order, preview, result, results });
    await wait(SEND_DELAY_MS);

    const normalizedPhone = normalizeForCountry(order.buyerPhone, event.country?.code || "CIV");
    if (
      normalizedPhone &&
      (phoneCounts.get(normalizedPhone) || 0) > 1 &&
      !notifiedPhones.has(normalizedPhone)
    ) {
      notifiedPhones.add(normalizedPhone);
      const hintMessage = buildPortalHintMessage();
      if (hintMessage) {
        const hintResult = await sendSms({
          to: order.buyerPhone,
          message: hintMessage,
          countryCode: event.country?.code || "CIV",
          sensitive: true,
        });
        if (hintResult.accepted) results.portalHintSent += 1;
        if (onProgress) onProgress({ order, preview: { message: hintMessage, ok: true }, result: hintResult, results, isPortalHint: true });
        await wait(SEND_DELAY_MS);
      }
    }
  }

  return { event, targets, results };
}

async function getReminderOrderById(orderId) {
  return prisma.ticketOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      eventId: true,
      orderNumber: true,
      buyerFullName: true,
      buyerPhone: true,
      status: true,
      isTest: true,
      country: { select: { code: true } },
    },
  });
}

// Renvoi individuel (depuis la liste des commandes d'un événement) : même
// message/lien que l'envoi en masse, pour une seule commande.
async function sendReminderForOrder(orderId) {
  const order = await getReminderOrderById(orderId);
  if (!order) throw Object.assign(new Error("Commande introuvable."), { statusCode: 404 });
  if (order.status !== "PAID") {
    throw Object.assign(
      new Error("Seules les commandes payées peuvent recevoir ce rappel."),
      { statusCode: 400 },
    );
  }

  const preview = buildReminderPreview(order);
  if (!preview.ok) {
    throw Object.assign(
      new Error(
        preview.reason === "TOO_LONG"
          ? "Message trop long pour ce billet (lien trop long)."
          : "Lien indisponible (configuration manquante).",
      ),
      { statusCode: 500 },
    );
  }

  const result = await sendSms({
    to: order.buyerPhone,
    message: preview.message,
    countryCode: order.country?.code || "CIV",
    sensitive: true,
  });

  let hintResult = null;
  const siblingOrders = await listReminderOrders(order.eventId);
  const normalizedPhone = normalizeForCountry(order.buyerPhone, order.country?.code || "CIV");
  const hasMultipleOrders =
    normalizedPhone &&
    siblingOrders.filter(
      (sibling) => normalizeForCountry(sibling.buyerPhone, order.country?.code || "CIV") === normalizedPhone,
    ).length > 1;

  if (hasMultipleOrders) {
    const hintMessage = buildPortalHintMessage();
    if (hintMessage) {
      await wait(SEND_DELAY_MS);
      hintResult = await sendSms({
        to: order.buyerPhone,
        message: hintMessage,
        countryCode: order.country?.code || "CIV",
        sensitive: true,
      });
    }
  }

  return { order, preview, result, hintResult };
}

module.exports = {
  MAX_SMS_LENGTH,
  ticketOrderUrl,
  buildReminderMessage,
  buildPortalHintMessage,
  countOrdersByPhone,
  buildReminderPreview,
  listReminderOrders,
  filterTargets,
  sendReminders,
  getReminderOrderById,
  sendReminderForOrder,
};
