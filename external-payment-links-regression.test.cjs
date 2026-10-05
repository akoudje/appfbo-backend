const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function controller(db) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/controllers/admin/externalPaymentLinks.controller.js'), 'utf8'), {
    module, process, Buffer, console: { error() {} },
    require: (name) => name === '../../prisma' ? db : {},
  });
  return module.exports;
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(body = {}, query = {}) { return { params: { id: 'link' }, countryId: 'CIV', body, query, user: { id: 'agent' }, protocol: 'https', get: () => 'example.test' }; }
const link = { id: 'link', status: 'PAID', amountFcfa: 10100, baseAmountFcfa: 10000, serviceFeeFcfa: 100, reference: 'EXT-1', token: 'token', countryId: 'CIV' };
const order = { id: 'order', preorderNumber: 'PO-1', countryId: 'CIV', totalFcfa: 10000, status: 'INVOICED', paymentStatus: 'UNPAID' };

test('creation rejects fractional, malformed and overflowing amounts before any writes', async () => {
  for (const amount of ['12.5', '12oops', 0, -5, 2147483647]) {
    const res = response();
    await controller({}).createLink(request({ invoiceReference: 'INV', customerPhone: '0700000000', baseAmountFcfa: amount }), res);
    assert.equal(res.code, 400);
  }
});
test('creation cannot forge a paid status and rejects invalid phones', async () => {
  for (const body of [{ customerPhone: 'abc' }, { status: 'PAID' }]) {
    const res = response();
    await controller({}).createLink(request({ invoiceReference: 'INV', customerPhone: '0700000000', baseAmountFcfa: 10000, ...body }), res);
    assert.equal(res.code, 400);
  }
});
test('manual status endpoint cannot confirm payment or cancel a paid link', async () => {
  for (const [oldStatus, status] of [['ACTIVE', 'PAID'], ['PAID', 'CANCELLED'], ['CANCELLED', 'ACTIVE']]) {
    const res = response();
    await controller({ externalPaymentLink: { findFirst: async () => ({ ...link, status: oldStatus }) } }).updateStatus(request({ status }), res);
    assert.equal(res.code, 409);
  }
});
test('cancellation detects a concurrently confirmed payment', async () => {
  const res = response();
  await controller({ externalPaymentLink: { findFirst: async () => ({ ...link, status: 'ACTIVE' }), updateMany: async ({ where }) => { assert.deepEqual(Array.from(where.status.in), ['DRAFT', 'ACTIVE']); return { count: 0 }; } } }).updateStatus(request({ status: 'CANCELLED' }), res);
  assert.equal(res.code, 409);
});
test('expired active links cannot be resent by SMS', async () => {
  const res = response();
  await controller({ externalPaymentLink: { findFirst: async () => ({ ...link, status: 'ACTIVE', expiresAt: new Date('2000-01-01') }) } }).resendSms(request(), res);
  assert.equal(res.code, 400);
});
test('attachment rejects underpayment and overpayment without starting a transaction', async () => {
  for (const totalFcfa of [9000, 11000]) {
    const res = response();
    await controller({ externalPaymentLink: { findFirst: async () => link }, preorder: { findFirst: async () => ({ ...order, totalFcfa }) }, payment: { findFirst: async () => null } }).attachToOrder(request({ preorderNumber: 'PO-1' }), res);
    assert.equal(res.code, 409);
    assert.match(res.body.message, /Montant incompatible/);
  }
});
test('attachment matches invoice excluding fees and writes the full paid amount', async () => {
  let payment, updated;
  const db = {
    externalPaymentLink: { findFirst: async () => link, update: async () => link },
    preorder: { findFirst: async () => order, update: async ({ data }) => { updated = data; return { ...order, ...data }; } },
    payment: { findFirst: async () => null, create: async ({ data }) => { payment = data; return { id: 'payment' }; }, update: async () => ({}) },
    paymentAttempt: { create: async () => ({ id: 'attempt' }) }, preorderLog: { create: async () => ({}) },
  };
  db.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(db); };
  const res = response();
  await controller(db).attachToOrder(request({ preorderNumber: 'PO-1' }), res);
  assert.equal(res.code, 200); assert.equal(payment.amountPaidFcfa, 10100); assert.equal(updated.paymentStatus, 'PAID');
});
test('attachment rechecks order changes inside the transaction', async () => {
  let reads = 0;
  const db = { externalPaymentLink: { findFirst: async () => link }, preorder: { findFirst: async () => (++reads === 1 ? order : { ...order, totalFcfa: 12000 }) }, payment: { findFirst: async () => null } };
  db.$transaction = async (fn) => fn(db);
  const res = response(); await controller(db).attachToOrder(request({ preorderNumber: 'PO-1' }), res);
  assert.equal(res.code, 409);
});
test('expired filter and search preserve both conditions; statistics stay within the selected results', async () => {
  const captured = [];
  const db = { externalPaymentLink: {
    count: async (args) => { captured.push(args.where); return 1; },
    aggregate: async ({ where }) => { assert.equal(where.AND[0].OR[0].status, 'EXPIRED'); return { _count: { _all: 0 }, _sum: {} }; },
    findMany: async ({ where }) => { assert.equal(where.OR[0].status, 'EXPIRED'); assert.equal(where.AND[0].OR[0].reference.contains, 'INV'); return [{ ...link, status: 'ACTIVE', expiresAt: new Date('2000-01-01') }]; },
  }, payment: { findMany: async () => [{ clientReference: 'external:link', preorder: { id: 'order', preorderNumber: 'PO-1' } }] } };
  const res = response(); await controller(db).listLinks(request({}, { status: 'EXPIRED', q: 'INV' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.data[0].status, 'EXPIRED'); assert.equal(res.body.data[0].attachedOrder.preorderNumber, 'PO-1'); assert.equal(captured[1].AND[1].status, 'ACTIVE');
});
test('candidate order search stays country scoped and excludes sold and cancelled orders', async () => {
  const res = response();
  await controller({ preorder: { findMany: async ({ where, take }) => { assert.equal(where.countryId, 'CIV'); assert.equal(where.paymentStatus.not, 'PAID'); assert.ok(where.status.notIn.includes('CANCELLED')); assert.equal(take, 10); return []; } } }).findAttachOrders(request({}, { q: 'PO' }), res);
  assert.equal(res.code, 200);
});
