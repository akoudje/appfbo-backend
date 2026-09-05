// Politique de non-retrait : rappelle le client avant l'échéance, puis
// signale (sans rien annuler ni prélever automatiquement) les colis READY
// dont le délai de retrait est dépassé — même architecture de scheduler
// embarqué que preorder-expiration.service.js et
// ticket-order-expiration.service.js.
//
// Volontairement pas d'automatisation de la sanction elle-même : le
// signalement alimente une liste admin (getOverduePickups), et
// applyPickupPenalty() reste une action déclenchée par un humain qui
// choisit le montant — voir la discussion produit avant d'implémenter
// un prélèvement automatique.

const prisma = require("../prisma");
const { sendPreorderNotification } = require("./preorder-notifications.service");
const { publishRealtimeEvent } = require("./realtime-events.service");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isSchedulerEnabled() {
  return String(process.env.PICKUP_OVERDUE_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
}

// Délai après mise à disposition (preparedAt) au-delà duquel un colis est
// considéré en retard de retrait.
function getOverdueAfterDays() {
  return Math.max(1, parsePositiveInt(process.env.PICKUP_OVERDUE_AFTER_DAYS, 7));
}

// Envoie un rappel ce nombre de jours avant l'échéance ci-dessus.
function getReminderBeforeDays() {
  const overdueDays = getOverdueAfterDays();
  return Math.min(
    Math.max(1, parsePositiveInt(process.env.PICKUP_REMINDER_BEFORE_DAYS, 2)),
    overdueDays - 1 >= 1 ? overdueDays - 1 : 1,
  );
}

function getSchedulerEveryMinutes() {
  // Délai exprimé en jours : pas besoin de repasser toutes les 5 minutes,
  // une fois par heure suffit largement à rester dans la bonne fenêtre.
  return Math.max(15, parsePositiveInt(process.env.PICKUP_OVERDUE_CHECK_EVERY_MINUTES, 60));
}

function formatFcfa(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "0 FCFA";
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(amount))} FCFA`;
}

function buildPickupReminderMessage(preorder, overdueAt) {
  const customer = String(preorder?.fboNomComplet || "Client").trim();
  const reference = String(
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-",
  ).trim();
  const deadline = overdueAt
    ? overdueAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "bientôt";
  return `Bonjour ${customer}, votre colis ${reference} est pret depuis plusieurs jours. Merci de le retirer avant le ${deadline} avec votre code de retrait, faute de quoi des frais de stockage pourront s'appliquer.`;
}

async function hasExistingLog(preorderId, action, sinceDate) {
  const existing = await prisma.preorderLog.findFirst({
    where: {
      preorderId,
      action,
      ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * Envoie un rappel de retrait aux commandes READY dont l'échéance approche
 * et qui n'en ont pas déjà reçu un depuis leur mise à disposition.
 */
async function sendPickupReminders({ now = new Date() } = {}) {
  const overdueDays = getOverdueAfterDays();
  const reminderDays = getReminderBeforeDays();
  const reminderCutoff = new Date(now.getTime() - (overdueDays - reminderDays) * 24 * 60 * 60 * 1000);
  const overdueCutoff = new Date(now.getTime() - overdueDays * 24 * 60 * 60 * 1000);

  // Fenêtre : déjà mûr pour le rappel (preparedAt <= reminderCutoff) mais
  // pas encore en retard complet (preparedAt > overdueCutoff) — au-delà,
  // c'est flagOverduePickups qui prend le relais.
  const candidates = await prisma.preorder.findMany({
    where: {
      status: "READY",
      preparedAt: { lte: reminderCutoff, gt: overdueCutoff },
    },
    select: {
      id: true,
      countryId: true,
      preorderNumber: true,
      parcelNumber: true,
      fboNomComplet: true,
      fboNumero: true,
      factureWhatsappTo: true,
      fboEmail: true,
      preparedAt: true,
    },
    orderBy: { preparedAt: "asc" },
    take: 200,
  });

  const reminded = [];
  for (const preorder of candidates) {
    if (await hasExistingLog(preorder.id, "PICKUP_REMINDER_SENT", preorder.preparedAt)) continue;

    const overdueAt = new Date(
      new Date(preorder.preparedAt).getTime() + overdueDays * 24 * 60 * 60 * 1000,
    );

    try {
      const result = await sendPreorderNotification({
        preorder,
        // "REMINDER" (et non "PICKUP_REMINDER") est déjà utilisé par le
        // rappel de paiement de préfacture, avec un template SMS/email
        // configuré en base par l'admin pour CE purpose — ce template
        // configuré prend le pas sur le `message` fourni ici
        // (resolveConfiguredTemplates ne retombe sur le message custom que
        // si aucun template n'est configuré pour le purpose demandé). Avec
        // purpose: "REMINDER", le rappel de retrait envoyait donc le
        // template de rappel de paiement, dont les placeholders
        // (paymentCollectionCode, totalFcfa, supportPhone) ne s'appliquent
        // pas à ce flux : "Montant 0F", code dupliqué sur le numéro de
        // commande, "Assistance:" vide. Voir aussi flagOverduePickups
        // ci-dessous, même bug.
        purpose: "PICKUP_REMINDER",
        message: buildPickupReminderMessage(preorder, overdueAt),
        actorName: "SYSTEM_PICKUP_REMINDER",
      });

      await prisma.preorderLog.create({
        data: {
          preorderId: preorder.id,
          action: "PICKUP_REMINDER_SENT",
          note: "Rappel automatique de retrait envoyé",
          meta: {
            overdueAt: overdueAt.toISOString(),
            overdueDays,
            channel: result?.channel || null,
            sent: Boolean(result?.sent),
          },
          actorAdminId: null,
        },
      });
      reminded.push(preorder.preorderNumber);
    } catch (error) {
      console.error("[pickup-overdue] reminder send failed", {
        preorderId: preorder.id,
        message: error?.message || String(error),
      });
    }
  }

  return { ok: true, checkedAt: now.toISOString(), remindedCount: reminded.length, reminded };
}

/**
 * Signale (PreorderLog, pas de changement de statut ni de facturation) les
 * commandes READY dont le délai de retrait est dépassé et pas encore
 * signalées. Une notification informe le client du dépassement.
 */
async function flagOverduePickups({ now = new Date() } = {}) {
  const overdueDays = getOverdueAfterDays();
  const overdueCutoff = new Date(now.getTime() - overdueDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.preorder.findMany({
    where: {
      status: "READY",
      preparedAt: { lte: overdueCutoff },
    },
    select: {
      id: true,
      countryId: true,
      preorderNumber: true,
      parcelNumber: true,
      fboNomComplet: true,
      fboNumero: true,
      factureWhatsappTo: true,
      fboEmail: true,
      preparedAt: true,
    },
    orderBy: { preparedAt: "asc" },
    take: 200,
  });

  const flagged = [];
  for (const preorder of candidates) {
    if (await hasExistingLog(preorder.id, "PICKUP_OVERDUE_FLAGGED", preorder.preparedAt)) continue;

    const daysLate = Math.floor(
      (now.getTime() - new Date(preorder.preparedAt).getTime()) / (24 * 60 * 60 * 1000),
    );

    try {
      const result = await sendPreorderNotification({
        preorder,
        // Voir le commentaire équivalent dans sendPickupReminders : purpose
        // distinct de "REMINDER" (déjà pris par le rappel de paiement, avec
        // un template configuré qui écraserait ce message).
        purpose: "PICKUP_OVERDUE",
        message:
          `Bonjour ${preorder.fboNomComplet || "Client"}, votre colis ${preorder.parcelNumber || preorder.preorderNumber} ` +
          `n'a toujours pas ete retire (${daysLate} jour${daysLate > 1 ? "s" : ""} apres mise a disposition). ` +
          `Merci de le retirer rapidement, des frais de stockage peuvent desormais s'appliquer.`,
        actorName: "SYSTEM_PICKUP_OVERDUE",
      });

      await prisma.preorderLog.create({
        data: {
          preorderId: preorder.id,
          action: "PICKUP_OVERDUE_FLAGGED",
          note: `Retrait en retard de ${daysLate} jour(s)`,
          meta: {
            daysLate,
            overdueDays,
            channel: result?.channel || null,
            sent: Boolean(result?.sent),
          },
          actorAdminId: null,
        },
      });

      publishRealtimeEvent({
        countryId: preorder.countryId,
        eventKey: "pickup_overdue_flagged",
        orderId: preorder.id,
        meta: { daysLate },
      });

      flagged.push(preorder.preorderNumber);
    } catch (error) {
      console.error("[pickup-overdue] flag failed", {
        preorderId: preorder.id,
        message: error?.message || String(error),
      });
    }
  }

  return { ok: true, checkedAt: now.toISOString(), flaggedCount: flagged.length, flagged };
}

/**
 * Liste les commandes READY en retard de retrait (au moins signalées une
 * fois), avec le nombre de jours de retard — alimente la vue admin.
 */
async function getOverduePickups({ countryId = null } = {}) {
  const overdueDays = getOverdueAfterDays();
  const overdueCutoff = new Date(Date.now() - overdueDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.preorder.findMany({
    where: {
      status: "READY",
      preparedAt: { lte: overdueCutoff },
      ...(countryId ? { countryId } : {}),
    },
    select: {
      id: true,
      preorderNumber: true,
      parcelNumber: true,
      factureReference: true,
      fboNomComplet: true,
      fboNumero: true,
      pointDeVente: true,
      totalFcfa: true,
      preparedAt: true,
      pickupPenaltyFcfa: true,
      pickupPenaltyNote: true,
      pickupPenaltyAppliedAt: true,
      pickupPenaltyAppliedByAdmin: { select: { id: true, fullName: true } },
    },
    orderBy: { preparedAt: "asc" },
    take: 200,
  });

  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    daysLate: Math.floor((now - new Date(row.preparedAt).getTime()) / (24 * 60 * 60 * 1000)),
  }));
}

/**
 * Enregistre une pénalité de non-retrait sur une commande — action
 * délibérée d'un admin, montant libre. N'ajuste pas totalFcfa/la
 * facturation automatiquement : à collecter/reporter manuellement pour
 * l'instant (voir commentaire en tête de fichier).
 */
async function applyPickupPenalty({ preorderId, countryId, amountFcfa, note, adminId }) {
  const amount = Number.parseInt(String(amountFcfa ?? ""), 10);
  if (!Number.isFinite(amount) || amount < 0) {
    const err = new Error("Montant de pénalité invalide.");
    err.statusCode = 400;
    throw err;
  }

  const order = await prisma.preorder.findFirst({
    where: { id: preorderId, ...(countryId ? { countryId } : {}) },
    select: { id: true, status: true, preorderNumber: true },
  });
  if (!order) {
    const err = new Error("Commande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: order.id },
      data: {
        pickupPenaltyFcfa: amount,
        pickupPenaltyNote: note ? String(note).trim().slice(0, 500) : null,
        pickupPenaltyAppliedAt: now,
        pickupPenaltyAppliedById: adminId || null,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: order.id,
        action: "PICKUP_PENALTY_APPLIED",
        note: note ? String(note).trim().slice(0, 500) : "Pénalité de non-retrait enregistrée",
        meta: { amountFcfa: amount },
        actorAdminId: adminId || null,
      },
    });

    return saved;
  });

  return updated;
}

function startPickupOverdueScheduler() {
  if (!isSchedulerEnabled()) {
    console.info("[pickup-overdue] scheduler disabled via PICKUP_OVERDUE_SCHEDULER_ENABLED");
    return null;
  }

  const intervalMs = getSchedulerEveryMinutes() * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const reminderResult = await sendPickupReminders({ now });
      if (reminderResult.remindedCount > 0) {
        console.log("[pickup-overdue] reminder summary", reminderResult);
      }
      const flagResult = await flagOverduePickups({ now });
      if (flagResult.flaggedCount > 0) {
        console.log("[pickup-overdue] flag summary", flagResult);
      }
    } catch (error) {
      console.error("[pickup-overdue] scheduler error", error);
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
  sendPickupReminders,
  flagOverduePickups,
  getOverduePickups,
  applyPickupPenalty,
  startPickupOverdueScheduler,
};
