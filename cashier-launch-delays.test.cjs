// Supervision caisse, onglet « Lancements » (cashier-launch-delays.service).
const test = require('node:test'), assert = require('node:assert/strict');
const { buildLaunchDelaysReport, percentile } = require('./src/services/cashier-launch-delays.service');

const NOW = new Date('2026-11-09T12:00:00Z');
const at = (min) => new Date(NOW.getTime() - min * 60000);
const desiree = { id: 'des', fullName: 'Désirée' };
const alain = { id: 'ala', fullName: 'Alain' };

// paidAt / lancement exprimés en minutes avant NOW.
const launched = [
  { id: 'l1', paidAt: at(100), preparationLaunchedAt: at(95), assignedInvoicer: desiree },  // 5 min
  { id: 'l2', paidAt: at(90), preparationLaunchedAt: at(80), assignedInvoicer: desiree },   // 10 min
  { id: 'l3', paidAt: at(200), preparationLaunchedAt: at(140), assignedInvoicer: alain },   // 60 min
  { id: 'l4', paidAt: at(130), preparationLaunchedAt: at(100), assignedInvoicer: alain },   // 30 min
  { id: 'l5', paidAt: at(60), preparationLaunchedAt: at(50), assignedInvoicer: null, preparationLaunchedBy: desiree }, // 10 min
  // Payé la veille à 21 h (Wave du soir), lancé à l'ouverture : hors délais.
  { id: 'l6', paidAt: at(900), preparationLaunchedAt: at(170), assignedInvoicer: desiree },
];
const pending = [
  { id: 'p1', paidAt: at(55), parcelNumber: 'COL-1', assignedInvoicer: alain },
  { id: 'p2', paidAt: at(30), parcelNumber: 'COL-2', assignedInvoicer: alain },
  { id: 'p3', paidAt: at(5), parcelNumber: 'COL-3', assignedInvoicer: desiree },
];

function fakeDb(capture = {}) {
  return {
    countrySettings: { findUnique: async () => ({ cashierLaunchWarnAfterMinutes: 15, cashierLaunchAlertAfterMinutes: 25, cashierLaunchReminderIntervalMinutes: 10, cashierLaunchMaxReminders: 3 }) },
    preorder: {
      findMany: async (args) => {
        if (args.where.preparationLaunchedAt === null) { capture.pendingWhere = args.where; return pending; }
        capture.launchedWhere = args.where;
        return launched;
      },
    },
  };
}
const req = { countryId: 'CIV' };
const period = { start: at(1440), end: NOW };

test('percentile au rang le plus proche', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 10, 10, 30, 60], 50), 10);
  assert.equal(percentile([5, 10, 10, 30, 60], 90), 60);
});

test('totaux : médiane, p90, dépassements du seuil (25) et de l\'escalade (50)', async () => {
  const capture = {};
  const r = await buildLaunchDelaysReport(fakeDb(capture), req, period, NOW);
  assert.equal(r.settings.escalateAfterMinutes, 50);
  assert.deepEqual(
    { launched: r.totals.launchedSameDay, previousDay: r.totals.paidPreviousDay, all: r.totals.launched, median: r.totals.medianMinutes, p90: r.totals.p90Minutes, over: r.totals.overAlert, esc: r.totals.overEscalation },
    { launched: 5, previousDay: 1, all: 6, median: 10, p90: 60, over: 2, esc: 1 },
  );
  assert.equal(capture.launchedWhere.isTest, false);
  assert.equal(capture.launchedWhere.countryId, 'CIV');
});

test('par agent : attribution à l\'agent de la commande, sinon à qui a lancé', async () => {
  const r = await buildLaunchDelaysReport(fakeDb(), req, period, NOW);
  const des = r.byAgent.find((a) => a.key === 'des');
  const ala = r.byAgent.find((a) => a.key === 'ala');
  assert.equal(des.launchedSameDay, 3);
  assert.equal(des.paidPreviousDay, 1);
  assert.equal(des.launched, 4);
  assert.equal(des.medianMinutes, 10);
  assert.equal(ala.launched, 2);
  assert.equal(ala.overAlert, 2);
  // Alain a un colis en attente depuis 55 min : escaladé, il passe en tête.
  assert.equal(r.byAgent[0].key, 'ala');
  assert.equal(ala.pendingNow, 2);
  assert.equal(ala.escalatedNow, 1);
  assert.equal(ala.oldestPendingMinutes, 55);
});

test('colis en attente : niveaux et périmètre pays complet', async () => {
  const capture = {};
  const r = await buildLaunchDelaysReport(fakeDb(capture), req, period, NOW);
  assert.deepEqual(r.pending.map((p) => p.level), ['escalated', 'overdue', 'fresh']);
  assert.equal(r.pending[0].agent.label, 'Alain');
  assert.equal(r.totals.escalatedNow, 1);
  assert.equal(capture.pendingWhere.assignedInvoicerId, undefined);
});

test('par jour : regroupé sur la date de lancement', async () => {
  const r = await buildLaunchDelaysReport(fakeDb(), req, period, NOW);
  assert.equal(r.byDay.length, 1);
  assert.equal(r.byDay[0].date, '2026-11-09');
  assert.equal(r.byDay[0].launchedSameDay, 5);
  assert.equal(r.byDay[0].paidPreviousDay, 1);
});
