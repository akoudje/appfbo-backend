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
    module, Buffer, Date, console: { error() {} }, process: { env: { CUSTOMER_OTP_MIN_RESPONSE_MS: '0', CUSTOMER_OTP_PEPPER: 'test-pepper', CUSTOMER_JWT_SECRET: 'test-secret' } },
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

test('grouped client views preserve ownership, exclude paid orders from payment tasks and separate history', async () => {
  for (const status of ['TO_PAY', 'HISTORY', 'ACTIVE']) {
    let where;
    const api = controller('customerOrders.controller.js', { preorder: {
      findMany: async (args) => { where = args.where; return []; },
      count: async () => 0,
    } });
    const res = response(); await api.listMyOrders(request({}, { status }), res);
    assert.equal(res.code, 200);
    assert.equal(where.OR[0].fboId, 'fbo');
    assert.equal(res.body.viewerNumeroFbo, '225-000-111-222');
    const filter = where.AND[0];
    if (status === 'TO_PAY') {
      assert.deepEqual(Array.from(filter.status.in), ['INVOICED', 'PAYMENT_PENDING']);
      assert.equal(filter.paymentStatus.not, 'PAID');
    } else if (status === 'HISTORY') {
      assert.deepEqual(Array.from(filter.status.in), ['CANCELLED', 'FULFILLED']);
    } else {
      assert.ok(filter.status.notIn.includes('FULFILLED'));
      assert.ok(filter.status.notIn.includes('CANCELLED'));
    }
  }
});

test('reordering recalculates from the current directory grade and refuses an unavailable directory without writes', async () => {
  const options = require('./src/services/country-order-options.service');
  const directory = require('./src/services/fboDirectory.service');
  for (const available of [true, false]) {
    let draft;
    const source = { id: 'order', items: [{ productId: 'p', qty: 2 }], fbo: { id: 'fbo', numeroFbo: '225-000-111-222', nomComplet: 'Ancien nom', grade: 'CLIENT_PRIVILEGIE', email: 'client@example.test' }, country: { settings: {} } };
    const db = {
      preorder: {
        findFirst: async ({ where }) => where.id ? source : null,
        create: async ({ data }) => { draft = data; return { id: 'draft', ...data }; },
        update: async () => ({}),
      },
      product: { findMany: async () => [{ id: 'p' }] },
      preorderItem: { createMany: async () => ({}) },
      preorderLog: { create: async () => ({}) },
    };
    db.$transaction = async fn => fn(db);
    const api = controller('customerOrders.controller.js', db, {
      '../services/fboDirectory.service': { ...directory, fetchFboDirectoryProfile: async () => { if (!available) throw Error('offline'); return { exists: true, full_name: 'KONÉ AMENAN', grade: 'MANAGER' }; } },
      '../services/country-order-options.service': options,
      '../helpers/preorder-number': { formatDateKey: () => '20300101', formatPreorderNumber: () => 'CIV-001' },
      '../services/pricing.service': { computePreorderTotals: async () => ({ totals: {} }) },
    });
    const res = response(); await api.reorderMyOrder(request(), res);
    if (available) {
      assert.equal(res.code, 200);
      assert.equal(draft.fboGrade, 'MANAGER');
      assert.equal(draft.fboNomComplet, 'KONÉ AMENAN');
      assert.equal(res.body.identityVerified, true);
      assert.equal(res.body.fbo.grade, 'MANAGER');
    } else {
      assert.equal(res.code, 503);
      assert.equal(draft, undefined);
    }
  }
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
      findFirst: async ({ where }) => { assert.equal(where.channel, 'EMAIL'); return ({ id: 'otp', codeHash: crypto.createHash('sha256').update('test-pepper:123456').digest('hex'), attempts: 0, maxAttempts: 5 }); },
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

test('dashboard payment filters use valid Prisma OrderPaymentStatus values', async () => {
  const { OrderPaymentStatus } = require('@prisma/client');
  let waitingPaymentQueries = 0;
  const db = {
    fbo: { findUnique: async () => ({ id: 'fbo', numeroFbo: '225-000-111-222', nomComplet: 'Client' }) },
    preorder: {
      count: async ({ where }) => {
        if (where.paymentStatus) {
          const values = [where.paymentStatus.not, ...(where.paymentStatus.notIn || [])].filter(Boolean);
          for (const value of values) assert.ok(Object.values(OrderPaymentStatus).includes(value), `Invalid payment status: ${value}`);
          assert.equal(where.paymentStatus.not, 'PAID');
          waitingPaymentQueries += 1;
        }
        return 2;
      },
      findMany: async () => [],
      groupBy: async () => [],
    },
  };
  const api = controller('customerAuth.controller.js', db, {
    './customerNotifications.controller': { buildNotificationSummaryForCustomer: async () => ({ total: 0, unreadCount: 0 }) },
  });
  const res = response();
  await api.dashboard(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.profile.id, 'fbo');
  assert.equal(res.body.stats.waitingPayment, 2);
  assert.equal(waitingPaymentQueries, 1);
});
function emailOtpApi({ email = 'client@example.test', orders = [], accepted = true, unknown = false } = {}) {
  const sent = [], created = [];
  const db = {
    fbo: { findUnique: async () => unknown ? null : ({ id: 'fbo', email }) },
    preorder: { findMany: async () => orders },
    customerOtpChallenge: {
      findFirst: async ({ where }) => { assert.equal(where.channel, 'EMAIL'); return null; },
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => { created.push(data); return data; },
    },
  };
  db.$transaction = async (fn) => fn(db);
  const api = controller('customerAuth.controller.js', db, {
    '../services/email.service': {
      normalizeEmail: require('./src/services/email.service').normalizeEmail,
      sendEmail: async (payload) => { sent.push(payload); return { accepted }; },
    },
    '../services/sms.service': { sendSms: async () => assert.fail('OTP must never be sent by SMS') },
  });
  return { api, sent, created };
}

test('OTP requests send only email even when a legacy client requests SMS', async () => {
  const { api, sent, created } = emailOtpApi();
  const res = response(); await api.requestOtp(request({ numeroFbo: '225-000-111-222', channel: 'SMS', phone: '0102030405' }), res);
  assert.equal(res.code, 200); assert.equal(sent.length, 1); assert.equal(sent[0].to, 'client@example.test');
  assert.equal(created[0].channel, 'EMAIL'); assert.deepEqual(Array.from(res.body.availableChannels), ['EMAIL']);
  assert.deepEqual(Array.from(res.body.sentChannels), ['EMAIL']);
});

test('OTP uses the latest valid order email when the FBO email is absent or invalid', async () => {
  const { api, sent } = emailOtpApi({ email: 'invalid', orders: [{ fboEmail: '' }, { fboEmail: 'invalid' }, { fboEmail: 'previous@example.test' }] });
  const res = response(); await api.requestOtp(request({ numeroFbo: '225-000-111-222' }), res);
  assert.equal(res.code, 200); assert.equal(sent[0].to, 'previous@example.test');
});

test('OTP without a valid email sends nothing and creates no challenge', async () => {
  const { api, sent, created } = emailOtpApi({ email: '' });
  const res = response(); await api.requestOtp(request({ numeroFbo: '225-000-111-222', channel: 'SMS' }), res);
  assert.equal(res.code, 409); assert.equal(sent.length, 0); assert.equal(created.length, 0);
  assert.match(res.body.message, /email/);
});

test('email delivery failure never falls back to SMS or creates a challenge', async () => {
  const { api, sent, created } = emailOtpApi({ accepted: false });
  const res = response(); await api.requestOtp(request({ numeroFbo: '225-000-111-222' }), res);
  assert.equal(res.code, 502); assert.equal(sent.length, 1); assert.equal(created.length, 0);
});

test('unknown FBO receives a generic email response without sending a code', async () => {
  const { api, sent } = emailOtpApi({ unknown: true });
  const res = response(); await api.requestOtp(request({ numeroFbo: '225-000-111-222', channel: 'SMS' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.channel, 'EMAIL'); assert.equal(sent.length, 0);
});
