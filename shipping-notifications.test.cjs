const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { OrderMessagePurpose, OrderMessageStatus } = require('@prisma/client');
const shipping = require('./src/services/shipping.service');

function moduleFrom(path, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), { module, URL, Date, Map, Buffer, process: { env: { PUBLIC_APP_URL: 'https://customer.example.test' } }, console: { error() {}, warn() {} }, require: name => dependencies[name] || {} });
  return module.exports;
}

function fixture(patch = {}) {
  const records = [], emails = [], calls = [], results = [];
  let emailAccepted = true, sequence = 0;
  const link = { id: 'link', token: 't'.repeat(32), source: 'SHIPPING', countryId: 'ci', status: 'ACTIVE', baseAmountFcfa: 10000, serviceFeeFcfa: 100, amountFcfa: 10100, ...patch.link };
  const order = { id: 'order', countryId: 'ci', country: { code: 'CIV' }, status: 'PAID', paymentStatus: 'PAID', preorderNumber: 'PO-CIV-20261012-0001', fboNomComplet: 'CLIENT TEST', fboEmail: 'buyer@example.test', factureWhatsappTo: '+2250700000000', shippingRecipientPhone: '+2250100000000', deliveryMode: 'EXPEDITION_CODITRANS', preorderPaymentMode: 'BANK_TRANSFER', totalFcfa: 90160, shippingFeeFcfa: 10000, shippingPaymentLinkId: 'link', shippingPaymentLink: link, ...patch.order };
  const db = {
    preorder: { findFirst: async ({ where }) => where.countryId === order.countryId ? order : null },
    countrySettings: { findUnique: async () => ({ notificationTemplates: { sms: { INVOICE: 'Facture produits 90160 FCFA' }, email: { INVOICE: { subject: 'Mauvaise facture', body: 'Payer les produits 90160 FCFA' } } } }) },
    orderMessage: {
      findFirst: async ({ where }) => records.filter(row => row.preorderId === where.preorderId && row.purpose === where.purpose && row.channel === where.channel && row.body === where.body && (!where.status || where.status.in.includes(row.status)) && (where.OR ? row.status === 'QUEUED' || row.createdAt >= where.OR[1].createdAt.gte : row.createdAt >= where.createdAt.gte)).at(-1) || null,
      findMany: async ({ where }) => records.filter(row => row.preorderId === where.preorderId && row.purpose === where.purpose && row.paymentLinkTarget === where.paymentLinkTarget),
      create: async ({ data }) => {
        assert.ok(Object.values(OrderMessagePurpose).includes(data.purpose), 'Notification purpose must exist in Prisma');
        assert.ok(Object.values(OrderMessageStatus).includes(data.status), 'Notification status must exist in Prisma');
        const row = { ...data, id: 'message-' + (++sequence), createdAt: new Date(Date.now() + sequence) }; records.push(row); return row;
      },
      update: async ({ where, data }) => { const row = records.find(row => row.id === where.id); Object.assign(row, data); return row; },
    },
    orderMessageEvent: { create: async () => ({}) },
  };
  const generic = moduleFrom('./src/services/preorder-notifications.service.js', {
    '../prisma': db,
    './sms.orange.service': { MAX_SMS_LENGTH: 160 },
    './email.service': { normalizeEmail: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')) ? value : '', sendEmail: async args => { emails.push(args); return { accepted: emailAccepted, provider: 'MOCK', providerMessageId: 'mail-' + emails.length }; } },
    './notification-template-defaults': { getPaymentExpiryHours: () => 2 },
    './email-templates/layout': require('./src/services/email-templates/layout'),
    './shipping.service': shipping,
    './mobile-push.service': { sendPreorderMobilePush: async () => ({ sent: false, reason: 'NO_PUSH_TOKEN' }) },
  });
  const api = moduleFrom('./src/services/shipping-notifications.service.js', {
    '../prisma': db, './shipping.service': shipping,
    './preorder-notifications.service': { sendPreorderNotification: async args => { calls.push(args); const result = await generic.sendPreorderNotification(args); results.push(result); return result; } },
  });
  return { api, order, records, emails, calls, results, setEmailAccepted(value) { emailAccepted = value; } };
}
const request = { orderId: 'order', countryId: 'ci', actorName: 'Préparateur test' };

test('shipping payment sends the separate amount to the buyer email and queues the buyer SMS', async () => {
  const f = fixture(); const summary = await f.api.notifyShippingPayment(request);
  assert.equal(f.emails.length, 1);
  assert.equal(f.emails[0].to, 'buyer@example.test');
  assert.match(f.emails[0].body, /10\s*100 FCFA/);
  assert.equal(f.emails[0].body.includes('90160'), false);
  assert.match(f.emails[0].html, /Payer les frais d’expédition/);
  assert.equal(f.emails[0].html.includes('Déposer ma preuve'), false);
  const sms = f.records.find(row => row.channel === 'SMS');
  assert.equal(sms.toPhone, '+2250700000000');
  assert.notEqual(sms.toPhone, f.order.shippingRecipientPhone);
  assert.ok(sms.body.includes('10100 FCFA'));
  assert.ok(sms.body.includes(f.api.paymentUrl(f.order)));
  assert.ok(sms.body.length <= 160, `SMS too long: ${sms.body.length}`);
  assert.equal(sms.purpose, 'PAYMENT_LINK');
  assert.equal(sms.status, 'QUEUED');
  assert.equal(summary.status, 'QUEUED');
  assert.equal(f.results[0].smsQueued, true);
  assert.equal(f.results[0].smsSent, false);
});

test('repeated notification keeps accepted mail and queued SMS without sending duplicates', async () => {
  const f = fixture(); await f.api.notifyShippingPayment(request); await f.api.notifyShippingPayment(request);
  assert.equal(f.emails.length, 1); assert.equal(f.records.length, 2);
  assert.equal(f.results[1].smsQueued, true); assert.equal(f.results[1].smsSent, false);
});
test('an older SMS still in the delivery queue is not queued again during a resend', async () => {
  const f = fixture(); await f.api.notifyShippingPayment(request);
  f.records.find(row => row.channel === 'SMS').createdAt = new Date(Date.now() - 3600000);
  await f.api.notifyShippingPayment(request);
  assert.equal(f.records.filter(row => row.channel === 'SMS').length, 1);
  assert.equal(f.results[1].smsQueued, true); assert.equal(f.results[1].smsSent, false);
});

test('a failed email can be retried while the queued SMS remains a single message', async () => {
  const f = fixture(); f.setEmailAccepted(false);
  assert.equal((await f.api.notifyShippingPayment(request)).status, 'PARTIAL');
  f.setEmailAccepted(true);
  const summary = await f.api.notifyShippingPayment(request);
  assert.equal(f.emails.length, 2);
  assert.equal(f.records.filter(row => row.channel === 'SMS').length, 1);
  assert.equal(summary.channels.find(item => item.channel === 'EMAIL').status, 'SENT');
});

test('free or already paid shipping never requests another payment', async () => {
  for (const patch of [{ order: { shippingFeeFcfa: 0, shippingPaymentLink: null } }, { link: { status: 'PAID', providerStatus: 'SUCCEEDED' } }]) {
    const f = fixture(patch); assert.equal((await f.api.notifyShippingPayment(request)).status, 'NOT_REQUIRED'); assert.equal(f.calls.length, 0);
  }
});

test('another country, replaced links, cancelled orders and mismatching fees cannot trigger messages', async () => {
  const foreign = fixture(); await assert.rejects(foreign.api.notifyShippingPayment({ ...request, countryId: 'other' }), error => error.statusCode === 404);
  for (const patch of [{ link: { status: 'CANCELLED' } }, { link: { countryId: 'other' } }, { link: { baseAmountFcfa: 1 } }, { order: { status: 'CANCELLED' } }]) {
    const f = fixture(patch); await assert.rejects(f.api.notifyShippingPayment(request), error => error.statusCode === 409); assert.equal(f.calls.length, 0);
  }
});

test('notification summary omits payment tokens and internal provider data', async () => {
  const f = fixture(); await f.api.notifyShippingPayment(request);
  const result = f.api.withShippingNotification({ ...f.order, messages: f.records });
  assert.equal(result.shippingPaymentLink.token, undefined);
  assert.equal(result.shippingNotification.status, 'QUEUED');
  assert.equal(JSON.stringify(result.shippingNotification).includes(f.order.shippingPaymentLink.token), false);
});
test('the portal exposes a distinct shipping payment alert for the customer own order', async () => {
  const f = fixture(); const countryWhere = [];
  const db = {
    preorder: { findMany: async ({ where }) => { countryWhere.push(where); return [{ ...f.order, fboNumero: '225-000-111-222', shippingQuotedAt: new Date() }]; } },
    customerNotificationRead: { findMany: async () => [] },
  };
  const portal = moduleFrom('./src/controllers/customerNotifications.controller.js', { '../prisma': db, '../services/shipping.service': shipping, '../services/notification-template-defaults': { getPaymentExpiryHours: () => 2 } });
  const req = { customer: { fboId: 'owner', numeroFbo: '225-000-111-222' } };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await portal.listMyNotifications(req, res);
  assert.equal(res.code, 200); assert.equal(countryWhere[0].OR[0].fboId, 'owner');
  const alert = res.body.data.find(item => item.title === 'Frais d’expédition à payer');
  assert.ok(alert); assert.equal(alert.key, 'order:shipping-payment:link');
  assert.equal(require('./src/services/mobile-push.service').notificationKeyForPurpose('order', 'SHIPPING_PAYMENT_LINK', 'link'), alert.key);
  assert.match(alert.body, /10\s*100 FCFA/); assert.equal(alert.body.includes('90160'), false);
});
