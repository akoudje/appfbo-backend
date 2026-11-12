// Onglet « En attente paiement » de la facturation : état des notifications de
// paiement envoyées au client et renvoi groupé (règles validées le 2026-11-12).
//
// - Tout le monde voit si la notification est partie (SMS, email, WhatsApp).
// - Le renvoi groupé est réservé aux superviseurs de la facturation.
// - Une commande notifiée il y a moins de 30 min n'est pas relancée.
// - Une commande avec un paiement Wave en cours n'est pas relancée (le nouveau
//   lien couperait celui que le client est en train d'utiliser).
// - Un seul renvoi groupé à la fois par pays.
const prisma = require("../prisma");
const { PAYABLE_STATUSES: PAYABLE_STATUS_SET } = require("../payments/payment-link-window");

const PAYABLE_STATUSES = [...PAYABLE_STATUS_SET];

const RESEND_MIN_INTERVAL_MS = 30 * 60 * 1000;
const PAYMENT_IN_PROGRESS_WINDOW_MS = 30 * 60 * 1000;
const BULK_RESEND_MAX = 200;
const BULK_RESEND_PAUSE_MS = 300;
const JOB_RETENTION_MS = 60 * 60 * 1000;

const NOTIFICATION_PURPOSES = ["INVOICE", "PAYMENT_LINK", "REMINDER"];
const NOTIFICATION_CHANNELS = ["SMS", "WHATSAPP", "EMAIL"];
const DELIVERED_STATUSES = ["SENT", "DELIVERED", "READ"];
const FAILED_STATUSES = ["FAILED", "CANCELLED"];
const OPEN_ATTEMPT_STATUSES = ["CREATED", "PROVIDER_SESSION_CREATED", "REDIRECT_READY", "PENDING"];

const SKIP_REASON_LABELS = {
  PAID: "Déjà payée",
  NOT_PAYABLE: "N'est plus en attente de paiement",
  RECENTLY_NOTIFIED: "Notifiée il y a moins de 30 min",
  PAYMENT_IN_PROGRESS: "Paiement Wave en cours",
  NO_CONTACT: "Ni téléphone ni email",
};

function messageTime(message) {
  return message?.sentAt || message?.failedAt || message?.lastStatusAt || message?.createdAt || null;
}

// Résumé des notifications d'une commande (messages du plus récent au plus ancien).
// state : NEVER (jamais envoyée), SENT (au moins un canal parti lors du dernier
// envoi), FAILED (tous les canaux du dernier envoi ont échoué), PENDING (en file).
function summarizeNotifications(messages = []) {
  const sorted = [...messages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  if (!sorted.length) {
    return { state: "NEVER", lastAt: null, count: 0, channels: {}, lastError: null, lastBy: null };
  }
  const channels = {};
  for (const message of sorted) {
    const channel = String(message.channel || "");
    if (!NOTIFICATION_CHANNELS.includes(channel) || channels[channel]) continue;
    channels[channel] = {
      status: message.status,
      at: messageTime(message),
      errorMessage: FAILED_STATUSES.includes(message.status) ? message.errorMessage || null : null,
    };
  }
  // Dernier envoi = messages créés dans les 2 min qui précèdent le plus récent
  // (un envoi produit un message par canal).
  const latestAt = new Date(sorted[0].createdAt).getTime();
  const lastBatch = sorted.filter((m) => latestAt - new Date(m.createdAt).getTime() <= 2 * 60 * 1000);
  let state = "PENDING";
  if (lastBatch.some((m) => DELIVERED_STATUSES.includes(m.status))) state = "SENT";
  else if (lastBatch.every((m) => FAILED_STATUSES.includes(m.status))) state = "FAILED";
  const failed = lastBatch.find((m) => FAILED_STATUSES.includes(m.status) && m.errorMessage);
  return {
    state,
    lastAt: sorted[0].createdAt,
    count: sorted.length,
    channels,
    lastError: failed?.errorMessage || null,
    lastBy: sorted[0].createdBy || null,
  };
}

// Raison d'écarter une commande du renvoi groupé, ou null si elle est relancée.
function classifyForBulkResend(order, { lastNotificationAt = null, openAttemptAt = null, now = new Date() } = {}) {
  if (!order) return "NOT_PAYABLE";
  if (String(order.paymentStatus || "") === "PAID") return "PAID";
  if (!PAYABLE_STATUSES.includes(String(order.status || ""))) return "NOT_PAYABLE";
  if (String(order.billingWorkStatus || "") !== "WAITING_PAYMENT") return "NOT_PAYABLE";
  const nowMs = new Date(now).getTime();
  if (lastNotificationAt && nowMs - new Date(lastNotificationAt).getTime() < RESEND_MIN_INTERVAL_MS) {
    return "RECENTLY_NOTIFIED";
  }
  if (openAttemptAt && nowMs - new Date(openAttemptAt).getTime() < PAYMENT_IN_PROGRESS_WINDOW_MS) {
    return "PAYMENT_IN_PROGRESS";
  }
  const hasPhone = Boolean(String(order.factureWhatsappTo || "").trim());
  const hasEmail = Boolean(String(order.fboEmail || "").trim());
  if (!hasPhone && !hasEmail) return "NO_CONTACT";
  return null;
}

function normalizeIds(ids) {
  const list = Array.isArray(ids) ? ids : String(ids || "").split(",");
  return [...new Set(list.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 500);
}

async function loadMessagesByOrder(orderIds) {
  if (!orderIds.length) return new Map();
  const messages = await prisma.orderMessage.findMany({
    where: { preorderId: { in: orderIds }, purpose: { in: NOTIFICATION_PURPOSES } },
    orderBy: { createdAt: "desc" },
    select: {
      preorderId: true,
      channel: true,
      status: true,
      sentAt: true,
      failedAt: true,
      lastStatusAt: true,
      errorMessage: true,
      createdBy: true,
      createdAt: true,
    },
  });
  const byOrder = new Map();
  for (const message of messages) {
    if (!byOrder.has(message.preorderId)) byOrder.set(message.preorderId, []);
    byOrder.get(message.preorderId).push(message);
  }
  return byOrder;
}

async function getNotificationStatuses({ countryId, ids }) {
  const orderIds = normalizeIds(ids);
  if (!orderIds.length) return {};
  const orders = await prisma.preorder.findMany({
    where: { id: { in: orderIds }, ...(countryId ? { countryId } : {}) },
    select: { id: true },
  });
  const allowed = orders.map((o) => o.id);
  const byOrder = await loadMessagesByOrder(allowed);
  const result = {};
  for (const id of allowed) {
    const summary = summarizeNotifications(byOrder.get(id) || []);
    const nextAllowedAt = summary.lastAt
      ? new Date(new Date(summary.lastAt).getTime() + RESEND_MIN_INTERVAL_MS)
      : null;
    result[id] = {
      ...summary,
      nextBulkResendAt: nextAllowedAt && nextAllowedAt.getTime() > Date.now() ? nextAllowedAt : null,
    };
  }
  return result;
}

// Commandes visées par le renvoi groupé, réparties entre « à relancer » et
// « écartées » (avec la raison).
async function buildBulkResendPlan({ countryId, ids = null, now = new Date() }) {
  const orderIds = ids ? normalizeIds(ids) : null;
  const orders = await prisma.preorder.findMany({
    where: {
      ...(countryId ? { countryId } : {}),
      ...(orderIds ? { id: { in: orderIds } } : {}),
      billingWorkStatus: "WAITING_PAYMENT",
      status: { in: PAYABLE_STATUSES },
    },
    orderBy: [{ billingLastActivityAt: "asc" }, { createdAt: "asc" }],
    take: BULK_RESEND_MAX + 1,
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      billingWorkStatus: true,
      preorderNumber: true,
      factureReference: true,
      fboNomComplet: true,
      fboNumero: true,
      factureWhatsappTo: true,
      fboEmail: true,
      activePayment: {
        select: {
          attempts: {
            where: { provider: "WAVE", status: { in: OPEN_ATTEMPT_STATUSES } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });
  const truncated = orders.length > BULK_RESEND_MAX;
  const selected = orders.slice(0, BULK_RESEND_MAX);
  const byOrder = await loadMessagesByOrder(selected.map((o) => o.id));
  const eligible = [];
  const skipped = [];
  for (const order of selected) {
    const messages = byOrder.get(order.id) || [];
    const reason = classifyForBulkResend(order, {
      lastNotificationAt: messages[0]?.createdAt || null,
      openAttemptAt: order.activePayment?.attempts?.[0]?.createdAt || null,
      now,
    });
    const item = {
      id: order.id,
      reference: order.factureReference || order.preorderNumber || order.id,
      fboNomComplet: order.fboNomComplet || null,
      fboNumero: order.fboNumero || null,
    };
    if (reason) skipped.push({ ...item, reason, reasonLabel: SKIP_REASON_LABELS[reason] });
    else eligible.push(item);
  }
  return { eligible, skipped, truncated, max: BULK_RESEND_MAX };
}

// ---- Tâches de renvoi groupé (en mémoire : une instance d'API) ----
const jobs = new Map();
const runningByCountry = new Map();
let jobSeq = 0;

function pruneJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - new Date(job.finishedAt).getTime() > JOB_RETENTION_MS) jobs.delete(id);
  }
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    startedBy: job.startedBy,
    total: job.total,
    done: job.results.length,
    sent: job.results.filter((r) => r.outcome === "SENT").length,
    queued: job.results.filter((r) => r.outcome === "QUEUED").length,
    failed: job.results.filter((r) => r.outcome === "FAILED").length,
    skipped: job.skipped,
    results: job.results,
  };
}

function getJob(jobId, countryId) {
  pruneJobs();
  const job = jobs.get(String(jobId || ""));
  if (!job || (countryId && job.countryId !== countryId)) return null;
  return publicJob(job);
}

function getCurrentJob(countryId) {
  pruneJobs();
  const runningId = runningByCountry.get(countryId || "");
  if (runningId && jobs.has(runningId)) return publicJob(jobs.get(runningId));
  // Dernière tâche terminée du pays (compte rendu après rechargement de la page).
  let latest = null;
  for (const job of jobs.values()) {
    if (job.countryId !== (countryId || "")) continue;
    if (!latest || new Date(job.startedAt) > new Date(latest.startedAt)) latest = job;
  }
  return publicJob(latest);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lance le renvoi groupé en arrière-plan. resendOne(orderId) envoie la
// notification d'une commande (même chemin que le bouton « Renvoyer ») et
// renvoie le résultat de l'envoi.
async function startBulkResend({ countryId, ids = null, actor = null, resendOne, pauseMs = BULK_RESEND_PAUSE_MS }) {
  const key = countryId || "";
  if (runningByCountry.has(key)) {
    const err = new Error("Un renvoi groupé est déjà en cours. Attendez la fin avant d'en lancer un autre.");
    err.statusCode = 409;
    err.job = getCurrentJob(countryId);
    throw err;
  }
  jobSeq += 1;
  const id = `bulk-${Date.now().toString(36)}-${jobSeq}`;
  runningByCountry.set(key, id);
  let job;
  try {
    const plan = await buildBulkResendPlan({ countryId, ids });
    job = {
      id,
      countryId: key,
      status: "RUNNING",
      startedAt: new Date(),
      finishedAt: null,
      startedBy: actor,
      total: plan.eligible.length,
      skipped: plan.skipped,
      queue: plan.eligible,
      results: [],
    };
    jobs.set(id, job);
  } catch (error) {
    runningByCountry.delete(key);
    throw error;
  }

  (async () => {
    try {
      for (const item of job.queue) {
        let outcome = "FAILED";
        let detail = null;
        try {
          // Revérifié juste avant l'envoi : payée, renvoyée entre-temps…
          const fresh = await buildBulkResendPlan({ countryId, ids: [item.id] });
          const freshSkip = fresh.skipped[0];
          if (freshSkip || !fresh.eligible.length) {
            outcome = "SKIPPED";
            detail = freshSkip?.reasonLabel || SKIP_REASON_LABELS.NOT_PAYABLE;
          } else {
            const sendResult = await resendOne(item.id);
            outcome = sendResult?.sent ? "SENT" : sendResult?.queued ? "QUEUED" : "FAILED";
            detail = sendResult?.errorMessage || null;
          }
        } catch (error) {
          detail = error?.message || "Erreur inconnue";
        }
        job.results.push({ ...item, outcome, detail });
        if (pauseMs) await sleep(pauseMs);
      }
      job.status = "DONE";
    } catch (error) {
      job.status = "FAILED";
      console.error("[billing][bulk-resend] arrêt inattendu", { jobId: id, message: error?.message });
    } finally {
      job.finishedAt = new Date();
      runningByCountry.delete(key);
      const summary = publicJob(job);
      console.info("[billing][bulk-resend] terminé", {
        jobId: id,
        countryId,
        startedBy: actor?.label || actor?.id || null,
        total: summary.total,
        sent: summary.sent,
        queued: summary.queued,
        failed: summary.failed,
        skippedBefore: summary.skipped.length,
      });
    }
  })();

  return publicJob(job);
}

function resetJobsForTests() {
  jobs.clear();
  runningByCountry.clear();
}

module.exports = {
  RESEND_MIN_INTERVAL_MS,
  BULK_RESEND_MAX,
  SKIP_REASON_LABELS,
  summarizeNotifications,
  classifyForBulkResend,
  getNotificationStatuses,
  buildBulkResendPlan,
  startBulkResend,
  getJob,
  getCurrentJob,
  resetJobsForTests,
};
