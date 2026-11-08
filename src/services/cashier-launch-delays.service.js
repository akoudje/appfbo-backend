// Supervision caisse, onglet « Lancements » : délai entre la confirmation du
// paiement (paidAt) et le lancement de la préparation, par agent de vente et
// par jour, plus les colis payés encore en attente.
//
// Sert au responsable de comptoir à repérer un colis oublié (au-delà de
// 2 × le seuil d'alerte, voir cashier-launch-alerts.service.js) et à suivre
// si les rappels font baisser les délais. L'agent est celui à qui la
// commande est attribuée (assignedInvoicerId) : pour un agent de vente,
// c'est lui qui facture, encaisse, certifie et lance.
//
// Un colis payé un jour et lancé un jour suivant (paiement Wave du soir ou
// de la nuit, lancé à l'ouverture) n'entre pas dans les délais : l'agent
// n'y pouvait rien et ces centaines de minutes écraseraient les
// statistiques. Il est compté à part (« payés la veille »). Fuseau métier :
// Africa/Abidjan = UTC.

const { scopeWhere, pickCountryId } = require("../helpers/countryScope");
const { loadLaunchAlertSettings, listPendingLaunches } = require("./cashier-launch-alerts.service");

function minutesBetween(from, to) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 60000));
}

// Percentile « au rang le plus proche » sur une liste triée.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function delayStats(delays, settings, previousDay = 0) {
  const sorted = [...delays].sort((a, b) => a - b);
  return {
    launched: sorted.length + previousDay,
    launchedSameDay: sorted.length,
    paidPreviousDay: previousDay,
    medianMinutes: percentile(sorted, 50),
    p90Minutes: percentile(sorted, 90),
    overAlert: sorted.filter((d) => d >= settings.alertAfterMinutes).length,
    overEscalation: sorted.filter((d) => d >= settings.escalateAfterMinutes).length,
  };
}

function agentOf(order) {
  const admin = order.assignedInvoicer || order.preparationLaunchedBy || null;
  return admin
    ? { key: admin.id, label: admin.fullName || admin.email || "Agent" }
    : { key: "UNASSIGNED", label: "Non attribué" };
}

async function buildLaunchDelaysReport(db, req, period, now = new Date()) {
  const countryId = pickCountryId(req);
  const [settings, launchedOrders, pendingRows] = await Promise.all([
    loadLaunchAlertSettings(db, countryId),
    db.preorder.findMany({
      where: scopeWhere(req, {
        isTest: false,
        paidAt: { not: null },
        preparationLaunchedAt: { gte: period.start, lte: period.end },
      }),
      select: {
        id: true,
        paidAt: true,
        preparationLaunchedAt: true,
        assignedInvoicer: { select: { id: true, fullName: true, email: true } },
        preparationLaunchedBy: { select: { id: true, fullName: true, email: true } },
      },
    }),
    listPendingLaunches(db, countryId),
  ]);

  const agents = new Map();
  const days = new Map();
  const allDelays = [];
  let allPreviousDay = 0;
  const ensureAgent = (agent) => {
    if (!agents.has(agent.key)) agents.set(agent.key, { ...agent, delays: [], previousDay: 0, pending: [] });
    return agents.get(agent.key);
  };

  for (const order of launchedOrders) {
    const delay = minutesBetween(order.paidAt, order.preparationLaunchedAt);
    if (delay === null) continue;
    const day = new Date(order.preparationLaunchedAt).toISOString().slice(0, 10);
    const paidDay = new Date(order.paidAt).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, { delays: [], previousDay: 0 });
    const agent = ensureAgent(agentOf(order));
    if (paidDay !== day) {
      allPreviousDay += 1;
      agent.previousDay += 1;
      days.get(day).previousDay += 1;
      continue;
    }
    allDelays.push(delay);
    agent.delays.push(delay);
    days.get(day).delays.push(delay);
  }

  const pending = pendingRows.map((row) => {
    const waitedMinutes = minutesBetween(row.paidAt, now);
    return {
      ...row,
      waitedMinutes,
      level:
        waitedMinutes >= settings.escalateAfterMinutes
          ? "escalated"
          : waitedMinutes >= settings.alertAfterMinutes
            ? "overdue"
            : waitedMinutes >= settings.warnAfterMinutes
              ? "warn"
              : "fresh",
    };
  });
  for (const row of pending) {
    const agent = row.agent ? { key: row.agent.id, label: row.agent.label } : { key: "UNASSIGNED", label: "Non attribué" };
    ensureAgent(agent).pending.push(row);
  }

  const byAgent = [...agents.values()]
    .map((agent) => ({
      key: agent.key,
      label: agent.label,
      ...delayStats(agent.delays, settings, agent.previousDay),
      pendingNow: agent.pending.length,
      escalatedNow: agent.pending.filter((row) => row.level === "escalated").length,
      oldestPendingMinutes: agent.pending.length
        ? Math.max(...agent.pending.map((row) => row.waitedMinutes || 0))
        : null,
    }))
    .sort((a, b) => b.escalatedNow - a.escalatedNow || b.overAlert - a.overAlert || b.launched - a.launched);

  const byDay = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({ date, ...delayStats(entry.delays, settings, entry.previousDay) }));

  return {
    settings,
    totals: {
      ...delayStats(allDelays, settings, allPreviousDay),
      pendingNow: pending.length,
      escalatedNow: pending.filter((row) => row.level === "escalated").length,
    },
    byAgent,
    byDay,
    // Plus anciens d'abord (déjà triés par paidAt croissant).
    pending,
    generatedAt: now.toISOString(),
  };
}

module.exports = { buildLaunchDelaysReport, percentile, minutesBetween };
