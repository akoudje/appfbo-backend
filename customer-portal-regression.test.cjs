const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { customerOrderResponse } = require('./src/utils/customerOrderResponse');

function response() { return { code: 200, cookies: [], status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, cookie(...args) { this.cookies.push(args); return this; } }; }
function request(body = {}, query = {}) { return { customer: { fboId: 'fbo', numeroFbo: '225-000-111-222' }, countryId: 'CIV', country: { id: 'CIV', code: 'CIV' }, params: { id: 'order' }, body, query }; }
function controller(file, db, extras = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/controllers', file), 'utf8'), {
    module, Buffer, Date, console: { error() {} }, process: { env: { CUSTOMER_OTP_PEPPER: 'test-pepper', CUSTOMER_JWT_SECRET: 'test-secret' } },
    require: (name) => {
      if (name === '../prisma') return db;
      if (name === 'crypto') return crypto;
      if (['path', 'fs', 'os'].includes(name)) return require(name);
      if (name === 'multer') return Object.assign(() => ({ single: () => () => {} }), { diskStorage: (options) => options });
      if (name === 'jsonwebtoken') return { sign: () => 'signed-session' };
      if (name === '../utils/customerOrderResponse') return { customerOrderResponse };
      if (name === '../services/notification-template-defaults') return { getPaymentExpiryHours: () => 3 };
      return extras[name] || {};
    },
  });
  return module.exports;
}

test('search and filters apply to all pages while preserving customer ownership', async () => {
  let listWhere;
  const api = controller('customerOrders.controller.js', { preorder: {
    findMany: async ({ where, skip, take }) => { listWhere = where; assert.equal(skip, 20); assert.equal(take, 20); return [{ id: 'order', fboNumero: '225-000-111-222', status: 'READY' }]; },
    count: async ({ where }) => { assert.equal(where, listWhere); return 22; },
  } });
  const res = response(); await api.listMyOrders(request({}, { page: 2, q: 'beneficiary', status: 'READY', relation: 'SELF' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.hasMore, true); assert.equal(res.body.total, 22);
  assert.equal(listWhere.OR[0].fboId, 'fbo'); assert.equal(listWhere.AND[0].OR[2].fboNomComplet.contains, 'beneficiary');
  assert.equal(listWhere.AND[1].status, 'READY'); assert.equal(listWhere.AND[2].fboId, 'fbo');
});
test('for-other filter preserves owner scope and excludes the customers own orders', async () => {
  const api = controller('customerOrders.controller.js', { preorder: { findMany: async ({ where }) => { assert.equal(where.OR[0].fboId, 'fbo'); assert.equal(where.AND[0].fboId.not, 'fbo'); assert.equal(where.AND[0].placedByFboNumero, '225-000-111-222'); return []; }, count: async () => 0 } });
  const res = response(); await api.listMyOrders(request({}, { relation: 'PLACED_FOR_OTHER' }), res); assert.equal(res.code, 200);
});
test('client responses allow only customer fields, including nested products and proofs', () => {
  const data = customerOrderResponse({ id: 'o', country: { code: 'CIV', settings: { secret: 'x' } }, totalFcfa: 10000, preorderPaymentMode: 'WAVE', invoiceInternalNote: 'private', bankProofUploadToken: 'secret', logs: [{ note: 'internal' }], messages: [{ id: 'm', channel: 'SMS', errorMessage: 'provider credentials', toPhone: 'private' }], items: [{ id: 'i', product: { nom: 'Aloe', cost: 12 }, internalMargin: 50 }], bankPaymentProofs: [{ id: 'p', originalFileName: 'proof.pdf', reviewedById: 'admin', internalNote: 'private' }] });
  assert.equal(data.invoiceInternalNote, undefined); assert.equal(data.bankProofUploadToken, undefined); assert.equal(data.logs, undefined);
  assert.equal(data.country.settings, undefined); assert.equal(data.items[0].product.cost, undefined); assert.equal(data.messages[0].errorMessage, undefined); assert.equal(data.bankPaymentProofs[0].reviewedById, undefined);
  assert.equal(data.paymentPricing.amountToPayFcfa, 10100);
});
test('cancellation cannot overwrite a concurrently invoiced or paid order and writes no log', async () => {
  const db = { preorder: { findFirst: async () => ({ id: 'order', status: 'SUBMITTED' }), updateMany: async ({ where }) => { assert.equal(where.status.in[0], 'SUBMITTED'); assert.equal(where.paymentStatus.not, 'PAID'); return { count: 0 }; } } };
  db.$transaction = async (fn) => fn(db);
  const res = response(); await controller('customerOrders.controller.js', db).cancelMyOrder(request(), res);
  assert.equal(res.code, 409);
});
test('cancellation of another customers order is rejected before any writes', async () => {
  const res = response(); await controller('customerOrders.controller.js', { preorder: { findFirst: async () => null } }).cancelMyOrder(request(), res); assert.equal(res.code, 404);
});

function otpDb() {
  let consumed = false;
  return {
    fbo: { findUnique: async () => ({ id: 'fbo', numeroFbo: '225-000-111-222', nomComplet: 'Client' }) },
    customerOtpChallenge: {
      findFirst: async () => ({ id: 'otp', codeHash: crypto.createHash('sha256').update('test-pepper:123456').digest('hex'), attempts: 0, maxAttempts: 5 }),
      updateMany: async ({ where }) => { assert.equal(where.consumedAt, null); assert.equal(where.attempts.lt, 5); assert.ok(where.expiresAt.gt); if (consumed) return { count: 0 }; consumed = true; return { count: 1 }; },
    },
  };
}
test('concurrent verification consumes a correct OTP once and issues only one session', async () => {
  const api = controller('customerAuth.controller.js', otpDb());
  const first = response(), second = response();
  await Promise.all([api.verifyOtp(request({ numeroFbo: '225-000-111-222', code: '123456' }), first), api.verifyOtp(request({ numeroFbo: '225-000-111-222', code: '123456' }), second)]);
  assert.deepEqual([first.code, second.code].sort(), [200, 400]); assert.equal(first.cookies.length + second.cookies.length, 1);
});
test('web session remains HttpOnly and does not return a readable bearer token', async () => {
  const res = response(); await controller('customerAuth.controller.js', otpDb()).verifyOtp(request({ numeroFbo: '225-000-111-222', code: '123456' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.token, undefined); assert.equal(res.cookies[0][2].httpOnly, true);
});
test('native session returns a bearer token only after a valid OTP and does not set a web cookie', async () => {
  const res = response(); await controller('customerAuth.controller.js', otpDb()).verifyOtp(request({ numeroFbo: '225-000-111-222', code: '123456', sessionTransport: 'bearer' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.token, 'signed-session'); assert.equal(res.cookies.length, 0);
});

test('client proof endpoint rejects paid, finished, cancelled and expired orders before upload', async () => {
  for (const state of [{ status: 'PAID', paymentStatus: 'PAID' }, { status: 'READY' }, { status: 'FULFILLED' }, { status: 'CANCELLED' }, { status: 'INVOICED', paymentExpiresAt: new Date('2000-01-01') }]) {
    const req = request(); req.file = { originalname: 'proof.pdf' };
    const db = { preorder: { findFirst: async () => ({ id: 'order', countryId: 'CIV', fboId: 'fbo', preorderPaymentMode: 'BANK_TRANSFER', ...state }) } };
    const res = response(); await controller('customerBankProof.controller.js', db).submitMyBankProof(req, res); assert.equal(res.code, 400);
  }
});
test('proof submission cannot overwrite a payment confirmed during the upload', async () => {
  const temp = path.join(__dirname, '.tmp-customer-proof-test.pdf'); fs.writeFileSync(temp, 'test');
  const db = { bankPaymentProof: { create: async () => ({ id: 'proof' }) }, preorder: { updateMany: async ({ where }) => { assert.equal(where.paymentStatus.not, 'PAID'); assert.equal(where.status.in[0], 'INVOICED'); return { count: 0 }; } } };
  db.$transaction = async (fn) => fn(db);
  const api = controller('customerBankProof.controller.js', db, { '../services/cloudinary': { uploadFile: async () => ({ secure_url: 'https://example.test/proof' }) } });
  await assert.rejects(() => api.createBankProofSubmission({ order: { id: 'order', countryId: 'CIV', fboId: 'fbo' }, file: { path: temp, originalname: 'proof.pdf', mimetype: 'application/pdf', size: 4 } }), (error) => error.statusCode === 409);
  assert.equal(fs.existsSync(temp), false);
});
test('proof submission rejects a fractional declared amount before upload', async () => {
  const api = controller('customerBankProof.controller.js', {});
  await assert.rejects(() => api.createBankProofSubmission({ order: {}, file: {}, declaredAmountFcfa: '12.5' }), (error) => error.statusCode === 400);
});
