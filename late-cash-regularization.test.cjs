// Régularisation d'un encaissement espèces reçu après fermeture de caisse
// (orders.controller regularizeLateCashPayment).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { claimOrderSnapshot } = require('./src/helpers/order-write-guard');
const permissions = require('./src/auth/permissions');
const country = require('./src/helpers/countryScope');

function response() { return { code: 200, status(v) { this.code = v; return this; }, json(v) { this.body = v; return this; } }; }

function load(db) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/controllers/admin/orders.controller.js'), 'utf8'), {
    module, console: { error() {} }, process, Buffer, require(id) {
      if (id === '../../prisma') return db;
      if (id.endsWith('/order-write-guard')) return { claimOrderSnapshot };
      if (id.endsWith('/countryScope')) return country;
      if (id.endsWith('/permissions')) return permissions;
      if (id.endsWith('/parcel-number')) return require('./src/helpers/parcel-number');
      if (id.endsWith('/realtime-events.service')) return { publishRealtimeEvent: () => {} };
      return {};
    },
  });
  return module.exports;
}

const INVOICED_AT = new Date('2026-11-04T13:40:00Z');
function fixture({ order: patch = {}, cancelLog, stock = 100, existingTx = 0 } = {}) {
  let order = {
    id: 'order', countryId: 'CIV', status: 'CANCELLED', paymentStatus: 'UNPAID', deliveryMode: 'RETRAIT_SITE_FLP',
    invoicedAt: INVOICED_AT, factureReference: '128895', as400InvoiceTotalFcfa: 70697, totalFcfa: 70697,
    assignedInvoicerId: 'agent', assignedInvoicer: { id: 'agent', fullName: 'Agent' }, fboNomComplet: 'CLIENT',
    stockDeductedAt: null, stockRestoredAt: null, preparationLaunchedAt: null, parcelNumber: null,
    cancelledAt: new Date('2026-11-04T14:22:59Z'), cancelReason: 'Paiement non reçu : précommande annulée à la fermeture de la caisse du facturier.',
    items: [{ id: 'line', productId: 'p1', qty: 3 }],
    logs: [cancelLog === undefined ? { id: 'log', action: 'CANCEL', meta: { source: 'CASH_REGISTER_CLOSURE' } } : cancelLog].filter(Boolean),
    ...patch,
  };
  const state = { stock, movements: [], logs: [], txs: [], checklist: 0 };
  const matches = (where, row) => Object.entries(where).every(([k, v]) => v === undefined || (v && typeof v === 'object' && 'not' in v ? row[k] != null : v === null ? row[k] == null : row[k] === v));
  const tx = {
    preorder: {
      updateMany: async ({ where, data }) => { if (!matches(where, order)) return { count: 0 }; order = { ...order, ...data }; return { count: 1 }; },
      update: async ({ data }) => { order = { ...order, ...data }; return { ...order }; },
    },
    countryProduct: { updateMany: async ({ where, data }) => { if (state.stock < where.stockQty.gte) return { count: 0 }; state.stock -= data.stockQty.decrement; return { count: 1 }; } },
    stockMovement: { create: async ({ data }) => { state.movements.push(data); return data; } },
    preorderLog: { create: async ({ data }) => { state.logs.push(data); return data; } },
    preparationChecklistItem: { upsert: async () => { state.checklist++; return {}; } },
    cashierTransaction: { create: async ({ data }) => { state.txs.push(data); return data; }, count: async () => existingTx },
  };
  const db = {
    ...tx,
    preorder: { ...tx.preorder, findFirst: async () => ({ ...order }) },
    async $transaction(fn) {
      const snapshot = structuredClone({ order, state });
      try { return await fn(tx); } catch (e) { ({ order } = snapshot); Object.assign(state, snapshot.state); throw e; }
    },
  };
  return { controller: load(db), state, get order() { return order; } };
}

const body = (patch = {}) => ({ receiptNumber: 'RC-1', amountReceivedFcfa: 70697, deliveredAt: '2026-11-04T18:00:00Z', ...patch });
const req = (b = body(), role = 'SUPER_ADMIN') => ({ countryId: 'CIV', country: { id: 'CIV' }, user: { id: 'admin', role }, params: { id: 'order' }, body: b });

test('régularise une commande annulée à la fermeture de caisse : livrée, payée, caisse de l’agent, stock débité', async () => {
  const f = fixture();
  const res = response();
  await f.controller.regularizeLateCashPayment(req(), res);
  assert.equal(res.code, 200, res.body?.message);
  const o = f.order;
  assert.equal(o.status, 'FULFILLED');
  assert.equal(o.paymentStatus, 'PAID');
  assert.equal(o.manualPaymentValidatedById, 'agent');
  assert.ok(Date.now() - o.paidAt.getTime() < 5000, 'encaissement daté de maintenant');
  assert.equal(o.fulfilledAt.toISOString(), '2026-11-04T18:00:00.000Z');
  assert.equal(o.cancelledAt, null);
  assert.equal(o.cancelReason, null);
  assert.ok(o.parcelNumber && o.stockDeductedAt);
  assert.equal(f.state.stock, 97);
  assert.equal(f.state.movements.length, 1);
  assert.equal(f.state.txs.length, 1);
  assert.deepEqual(
    { cashierId: f.state.txs[0].cashierId, mode: f.state.txs[0].paymentMode, amount: f.state.txs[0].amountReceivedFcfa },
    { cashierId: 'agent', mode: 'ESPECES', amount: 70697 },
  );
  assert.deepEqual(f.state.logs.map((l) => l.action), ['REACTIVATE', 'VALIDATE_MANUAL_PAYMENT', 'PAYMENT_CONFIRMED', 'LAUNCH_PREPARATION', 'PREPARE', 'FULFILL']);
  assert.ok(f.state.logs.every((l) => l.meta.source === 'CASH_COLLECTED_AFTER_CLOSURE_REGULARIZATION'));
});

test('accepte aussi une annulation automatique après délai expiré', async () => {
  const f = fixture({ cancelLog: { id: 'log', action: 'CANCEL', meta: { mode: 'AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW' } } });
  const res = response();
  await f.controller.regularizeLateCashPayment(req(), res);
  assert.equal(res.code, 200, res.body?.message);
  assert.equal(f.order.status, 'FULFILLED');
});

const refusals = [
  ['rôle non administrateur global', {}, req(body(), 'OPERATIONS_DIRECTOR'), 403],
  ['annulation manuelle', { cancelLog: null, order: { cancelReason: 'Client a annulé' } }, req(), 400],
  ['commande non annulée', { order: { status: 'INVOICED' } }, req(), 400],
  ['commande déjà payée', { order: { paymentStatus: 'PAID' } }, req(), 400],
  ['stock déjà débité', { order: { stockDeductedAt: new Date() } }, req(), 400],
  ['sans agent de vente', { order: { assignedInvoicerId: null } }, req(), 400],
  ['encaissement déjà existant', { existingTx: 1 }, req(), 409],
  ['reçu manquant', {}, req(body({ receiptNumber: ' ' })), 400],
  ['montant différent de la facture', {}, req(body({ amountReceivedFcfa: 70000 })), 400],
  ['date de remise avant la préfacture', {}, req(body({ deliveredAt: '2026-11-03T10:00:00Z' })), 400],
  ['date de remise dans le futur', {}, req(body({ deliveredAt: '2999-01-01T00:00:00Z' })), 400],
  ['stock insuffisant', { stock: 2 }, req(), 409],
];
for (const [name, opts, request, code] of refusals) {
  test(`refuse : ${name} (rien n’est modifié)`, async () => {
    const f = fixture(opts);
    const before = f.order.status;
    const res = response();
    await f.controller.regularizeLateCashPayment(request, res);
    assert.equal(res.code, code, res.body?.message);
    assert.equal(f.order.status, before);
    assert.equal(f.state.txs.length, 0);
    assert.equal(f.state.logs.length, 0);
  });
}
