// Onglet « En attente paiement » : état des notifications et renvoi groupé
// (règles du 2026-11-12 : 30 min entre deux notifications, pas de relance
// pendant un paiement Wave, un seul renvoi groupé à la fois).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');

const db = {};
require.cache[path.join(__dirname, 'src/prisma.js')] = { id: 'prisma', filename: 'prisma', loaded: true, exports: db };

const svc = require('./src/services/billing-payment-notifications.service');

const MIN = 60 * 1000;
const NOW = new Date('2026-11-12T10:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms);
const order = (extra = {}) => ({
  id: 'o1', status: 'INVOICED', paymentStatus: 'PAYMENT_PENDING', billingWorkStatus: 'WAITING_PAYMENT',
  factureWhatsappTo: '+2250700000000', fboEmail: null, ...extra,
});

test('jamais notifiée', () => {
  assert.equal(svc.summarizeNotifications([]).state, 'NEVER');
});

test('dernier envoi : un canal parti suffit, sinon échec', () => {
  const sent = svc.summarizeNotifications([
    { channel: 'SMS', status: 'FAILED', errorMessage: 'numéro invalide', createdAt: ago(1 * MIN) },
    { channel: 'EMAIL', status: 'SENT', sentAt: ago(1 * MIN), createdAt: ago(1 * MIN) },
  ]);
  assert.equal(sent.state, 'SENT');
  assert.equal(sent.channels.SMS.status, 'FAILED');
  assert.equal(sent.channels.EMAIL.status, 'SENT');

  const failed = svc.summarizeNotifications([
    { channel: 'SMS', status: 'FAILED', errorMessage: 'numéro invalide', createdAt: ago(1 * MIN) },
    // Envoi plus ancien réussi : ne compte pas pour l'état du dernier envoi.
    { channel: 'SMS', status: 'DELIVERED', createdAt: ago(90 * MIN) },
  ]);
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.lastError, 'numéro invalide');
  assert.equal(failed.count, 2);
});

test('renvoi groupé : raisons d\'écarter une commande', () => {
  const c = (o, opts = {}) => svc.classifyForBulkResend(order(o), { now: NOW, ...opts });
  assert.equal(c({}), null);
  assert.equal(c({ paymentStatus: 'PAID' }), 'PAID');
  assert.equal(c({ status: 'CANCELLED' }), 'NOT_PAYABLE');
  assert.equal(c({ billingWorkStatus: 'IN_PROGRESS' }), 'NOT_PAYABLE');
  assert.equal(c({}, { lastNotificationAt: ago(29 * MIN) }), 'RECENTLY_NOTIFIED');
  assert.equal(c({}, { lastNotificationAt: ago(31 * MIN) }), null);
  assert.equal(c({}, { openAttemptAt: ago(10 * MIN) }), 'PAYMENT_IN_PROGRESS');
  assert.equal(c({}, { openAttemptAt: ago(45 * MIN) }), null);
  assert.equal(c({ factureWhatsappTo: '', fboEmail: '' }), 'NO_CONTACT');
  assert.equal(c({ factureWhatsappTo: '', fboEmail: 'a@b.ci' }), null);
});

function stubDb({ orders, messages = [] }) {
  db.preorder = {
    findMany: async ({ where }) => {
      const ids = where?.id?.in;
      return orders.filter((o) => !ids || ids.includes(o.id)).filter((o) => !where.countryId || o.countryId === where.countryId);
    },
  };
  db.orderMessage = {
    findMany: async ({ where }) => messages.filter((m) => where.preorderId.in.includes(m.preorderId)),
  };
}

const waitDone = async (countryId) => {
  for (let i = 0; i < 100; i += 1) {
    const job = svc.getCurrentJob(countryId);
    if (job && job.status !== 'RUNNING') return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('renvoi groupé non terminé');
};

test('renvoi groupé : envoie aux commandes éligibles, écarte les autres, un seul à la fois', async () => {
  svc.resetJobsForTests();
  const base = { countryId: 'civ', activePayment: { attempts: [] } };
  stubDb({
    orders: [
      order({ ...base, id: 'a', factureReference: 'F-A' }),
      order({ ...base, id: 'b' }),
      order({ ...base, id: 'c', activePayment: { attempts: [{ createdAt: new Date() }] } }),
      order({ ...base, id: 'd' }),
    ],
    messages: [{ preorderId: 'b', channel: 'SMS', status: 'SENT', createdAt: new Date(Date.now() - 5 * MIN) }],
  });
  const sentTo = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const job = await svc.startBulkResend({
    countryId: 'civ',
    actor: { id: 'u1', label: 'Responsable' },
    pauseMs: 0,
    resendOne: async (id) => {
      await gate;
      sentTo.push(id);
      return id === 'd' ? { sent: false, queued: false, errorMessage: 'SMS refusé' } : { sent: true };
    },
  });
  assert.equal(job.total, 2);
  assert.deepEqual(job.skipped.map((s) => [s.id, s.reason]), [['b', 'RECENTLY_NOTIFIED'], ['c', 'PAYMENT_IN_PROGRESS']]);

  await assert.rejects(
    svc.startBulkResend({ countryId: 'civ', resendOne: async () => ({ sent: true }) }),
    (err) => err.statusCode === 409,
  );

  release();
  const done = await waitDone('civ');
  assert.deepEqual(sentTo, ['a', 'd']);
  assert.equal(done.sent, 1);
  assert.equal(done.failed, 1);
  assert.equal(done.results.find((r) => r.id === 'd').detail, 'SMS refusé');
  assert.equal(done.startedBy.label, 'Responsable');
});

test('renvoi groupé : commande notifiée entre-temps sautée au moment de l\'envoi', async () => {
  svc.resetJobsForTests();
  stubDb({ orders: [order({ id: 'x', countryId: 'civ', activePayment: { attempts: [] } })] });
  // Un agent renvoie la notification juste après le lancement : la 1re lecture
  // (préparation) ne la voit pas, la revérification avant l'envoi si.
  let reads = 0;
  db.orderMessage.findMany = async () => (reads++ === 0 ? [] : [{ preorderId: 'x', channel: 'SMS', status: 'SENT', createdAt: new Date() }]);
  const sentTo = [];
  const job = await svc.startBulkResend({
    countryId: 'civ',
    pauseMs: 0,
    resendOne: async (id) => { sentTo.push(id); return { sent: true }; },
  });
  assert.equal(job.total, 1);
  const done = await waitDone('civ');
  assert.deepEqual(sentTo, []);
  assert.equal(done.results[0].outcome, 'SKIPPED');
});
