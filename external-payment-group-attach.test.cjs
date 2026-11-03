const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(file, requireStub) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, process, Buffer, console: { error() {} }, require: requireStub,
  });
  return module.exports;
}
const settlement = load('src/services/settlement.service.js', () => ({}));
function controller(db) {
  return load('src/controllers/admin/externalPaymentLinks.controller.js', (name) => {
    if (name === '../../prisma') return db;
    if (name === '../../services/settlement.service') return { parsePreorderNumbers: settlement.parsePreorderNumbers };
    return {};
  });
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(body = {}) { return { params: { id: 'link' }, countryId: 'CIV', body, query: {}, user: { id: 'agent' }, protocol: 'https', get: () => 'example.test' }; }

const link = { id: 'link', status: 'PAID', amountFcfa: 30300, baseAmountFcfa: 30000, serviceFeeFcfa: 300, reference: 'QR-20261103-0051', token: 'token', countryId: 'CIV', providerTransactionId: 'TX-1' };
const orders = [
  { id: 'o1', preorderNumber: 'PO-CIV-20261103-0201', countryId: 'CIV', totalFcfa: 10000, status: 'INVOICED', paymentStatus: 'UNPAID' },
  { id: 'o2', preorderNumber: 'PO-CIV-20261103-0202', countryId: 'CIV', totalFcfa: 20000, status: 'INVOICED', paymentStatus: 'UNPAID' },
];
const text = 'PO-CIV-20261103-0201\nPO-CIV-20261103-0202';

function database(overrides = {}) {
  const writes = { payments: [], orders: [], logs: 0, transactions: 0 };
  const db = {
    externalPaymentLink: { findFirst: async () => link, update: async () => link },
    payment: {
      findFirst: async () => null,
      create: async ({ data }) => { writes.payments.push(data); return { id: `pay-${writes.payments.length}` }; },
      update: async () => ({}),
    },
    paymentAttempt: { create: async () => ({ id: 'attempt' }) },
    preorder: {
      findMany: async ({ where }) => orders.filter((order) => where.preorderNumber.in.includes(order.preorderNumber)),
      update: async ({ where, data }) => { writes.orders.push({ id: where.id, ...data }); return data; },
    },
    preorderLog: { create: async () => { writes.logs += 1; } },
    ...overrides,
  };
  db.$transaction = async (fn, options) => { writes.transactions += 1; assert.equal(options.isolationLevel, 'Serializable'); return fn(db); };
  return { db, writes };
}

test('group attach previews the list without writing anything', async () => {
  const { db, writes } = database();
  const res = response();
  await controller(db).attachToOrders(request({ text, dryRun: true }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.orders.length, 2);
  assert.equal(res.body.ordersTotalFcfa, 30000);
  assert.equal(writes.transactions, 0);
});

test('group attach blocks when the invoices total differs from the payment excluding fees', async () => {
  const { db, writes } = database();
  const res = response();
  await controller(db).attachToOrders(request({ text: 'PO-CIV-20261103-0201' }), res);
  assert.equal(res.code, 409);
  assert.match(res.body.message, /Montant incompatible/);
  assert.equal(writes.transactions, 0);
});

test('group attach reports unknown, paid and settled orders', async () => {
  const flagged = [
    { ...orders[0], status: 'PAID', paymentStatus: 'PAID' },
    { ...orders[1], settlementEntity: 'FLP_BURKINA' },
  ];
  const { db } = database({ preorder: { findMany: async () => flagged } });
  const res = response();
  await controller(db).attachToOrders(request({ text: `${text}\nPO-CIV-20261103-0999`, dryRun: true }), res);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.issues.length, 3);
});

test('group attach writes one payment per order with distinct references and marks them paid', async () => {
  const { db, writes } = database();
  const res = response();
  await controller(db).attachToOrders(request({ text }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(writes.payments.map((p) => p.clientReference), ['external:link:o1', 'external:link:o2']);
  assert.deepEqual(writes.payments.map((p) => p.amountPaidFcfa), [10000, 20000]);
  assert.ok(writes.payments.every((p) => p.providerTxnId === null));
  const paid = writes.orders.filter((o) => o.status === 'PAID');
  assert.equal(paid.length, 2);
  assert.equal(writes.logs, 2);
});

test('group attach refuses a payment already attached', async () => {
  const { db, writes } = database({ payment: { findFirst: async () => ({ id: 'existing' }) } });
  const res = response();
  await controller(db).attachToOrders(request({ text }), res);
  assert.equal(res.code, 409);
  assert.equal(writes.transactions, 0);
});

test('single attach refuses a payment already split across several orders', async () => {
  const { db } = database({
    preorder: { findFirst: async () => orders[0] },
    payment: { findFirst: async () => ({ id: 'p', preorderId: 'o9', clientReference: 'external:link:o9' }) },
  });
  const res = response();
  await controller(db).attachToOrder(request({ preorderNumber: 'PO-CIV-20261103-0201' }), res);
  assert.equal(res.code, 409);
  assert.match(res.body.message, /plusieurs commandes/);
});
