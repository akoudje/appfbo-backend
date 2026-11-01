const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const shipping = require('./src/services/shipping.service');

function moduleFrom(path, dependencies, env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), { module, URL, Date, Map, Set, Buffer, process: { env }, console: { error() {}, warn() {}, log() {} }, require: name => dependencies[name] || require(name) });
  return module.exports;
}

// canSend : WhatsApp utilisable pour ce message ; accepted : réponse MailerSend.
function fixture({ canSend = true, accepted = true, order: orderPatch = {}, messages = [] } = {}) {
  const records = [...messages], events = [], whatsappCalls = [];
  let sequence = records.length;
  const order = { id: 'order', countryId: 'ci', country: { code: 'CIV' }, status: 'INVOICED', preorderNumber: 'PO-CIV-20261101-0001', paymentCollectionCode: 'A7K2Q', fboNomComplet: 'CLIENT TEST', fboEmail: 'buyer@example.test', factureWhatsappTo: '0707070707', deliveryMode: 'RETRAIT', preorderPaymentMode: 'ESPECES', totalFcfa: 48500, ...orderPatch };
  const db = {
    countrySettings: { findUnique: async () => null },
    orderMessage: {
      findFirst: async () => null,
      findUnique: async ({ where }) => {
        const row = records.find(r => r.id === where.id);
        if (!row) return null;
        return { ...row, events: events.filter(e => e.orderMessageId === row.id && e.status === 'SMS_FALLBACK_QUEUED'), preorder: order };
      },
      create: async ({ data }) => { const row = { ...data, id: 'message-' + (++sequence), createdAt: new Date() }; records.push(row); return row; },
      update: async ({ where, data }) => { const row = records.find(r => r.id === where.id); Object.assign(row, data); return row; },
    },
    orderMessageEvent: { create: async ({ data }) => { events.push(data); return data; } },
  };
  const whatsapp = {
    canSendPreorderWhatsAppTemplate: () => canSend,
    sendPreorderWhatsAppNotification: async args => {
      whatsappCalls.push(args);
      return accepted
        ? { accepted: true, provider: 'MAILERSEND_WHATSAPP', providerMessageId: 'wa-1' }
        : { accepted: false, provider: 'MAILERSEND_WHATSAPP', errorCode: 'MAILERSEND_WHATSAPP_422', errorMessage: 'refusé' };
    },
  };
  const api = moduleFrom('./src/services/preorder-notifications.service.js', {
    '../prisma': db,
    './sms.service': { sendSms: async () => { throw new Error('le SMS passe par la file, jamais en direct'); } },
    './sms.orange.service': { MAX_SMS_LENGTH: 160 },
    './email.service': { normalizeEmail: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')) ? value : '', sendEmail: async () => ({ accepted: true, provider: 'MOCK', providerMessageId: 'mail-1' }) },
    './notification-template-defaults': { getPaymentExpiryHours: () => 48 },
    './email-templates/layout': require('./src/services/email-templates/layout'),
    '../utils/phone': require('./src/utils/phone'),
    './shipping.service': shipping,
    './whatsapp.service': whatsapp,
    './mobile-push.service': { sendPreorderMobilePush: async () => ({ sent: false, reason: 'NO_PUSH_TOKEN' }) },
  });
  const phoneRows = channel => records.filter(r => r.channel === channel);
  return { api, order, records, events, whatsappCalls, phoneRows };
}

const notify = (f, patch = {}) => f.api.sendPreorderNotification({ preorder: f.order, purpose: 'INVOICE', message: 'Code A7K2Q. 48 500 FCFA.', ...patch });

test('WhatsApp is the FBO primary channel once its template can be sent: no SMS is spent', async () => {
  const f = fixture();
  const result = await notify(f);
  assert.equal(result.whatsappSent, true);
  assert.equal(result.smsQueued, false);
  assert.equal(f.phoneRows('WHATSAPP').length, 1);
  assert.equal(f.phoneRows('SMS').length, 0);
  assert.equal(f.whatsappCalls[0].purpose, 'INVOICE');
});

test('a WhatsApp rejected by MailerSend falls back to a queued SMS, traced on the WhatsApp message', async () => {
  const f = fixture({ accepted: false });
  const result = await notify(f);
  assert.equal(result.sent, true);
  assert.equal(result.channel, 'SMS');
  assert.equal(result.whatsappSent, false);
  assert.equal(result.smsQueued, true);
  const [whatsappRow] = f.phoneRows('WHATSAPP');
  const [smsRow] = f.phoneRows('SMS');
  assert.equal(whatsappRow.status, 'FAILED');
  assert.equal(smsRow.status, 'QUEUED');
  assert.equal(smsRow.body, whatsappRow.body);
  assert.ok(f.events.some(e => e.orderMessageId === whatsappRow.id && e.status === 'SMS_FALLBACK_QUEUED'));
});

test('without a usable WhatsApp template the SMS stays the phone channel', async () => {
  const f = fixture({ canSend: false });
  const result = await notify(f);
  assert.equal(result.smsQueued, true);
  assert.equal(f.phoneRows('WHATSAPP').length, 0);
  assert.equal(f.whatsappCalls.length, 0);
});

test('messages outside the SMS policy go out on WhatsApp but never fall back to SMS', async () => {
  const sent = fixture();
  assert.equal((await notify(sent, { purpose: 'PAYMENT_CONFIRMED' })).whatsappSent, true);
  const rejected = fixture({ accepted: false });
  await notify(rejected, { purpose: 'PAYMENT_CONFIRMED' });
  assert.equal(rejected.phoneRows('SMS').length, 0);
  const noTemplate = fixture({ canSend: false });
  await notify(noTemplate, { purpose: 'PAYMENT_CONFIRMED' });
  assert.equal(noTemplate.phoneRows('SMS').length + noTemplate.phoneRows('WHATSAPP').length, 0);
});

test('an explicitly forced SMS channel bypasses WhatsApp', async () => {
  const f = fixture();
  await notify(f, { forceChannel: 'SMS' });
  assert.equal(f.whatsappCalls.length, 0);
  assert.equal(f.phoneRows('SMS').length, 1);
});

const failedWhatsApp = (patch = {}) => ({ id: 'wa-msg', preorderId: 'order', channel: 'WHATSAPP', purpose: 'INVOICE', status: 'FAILED', body: 'Code A7K2Q. 48 500 FCFA.', toPhone: '0707070707', paymentLinkTarget: null, paymentLinkTracked: null, createdAt: new Date(), ...patch });

test('a WhatsApp reported failed by webhook queues one SMS fallback, only once', async () => {
  const f = fixture({ messages: [failedWhatsApp()] });
  const first = await f.api.queueSmsFallbackForFailedWhatsApp('wa-msg');
  assert.ok(first);
  assert.equal(first.channel, 'SMS');
  assert.equal(first.body, 'Code A7K2Q. 48 500 FCFA.');
  assert.equal(first.toPhone, '0707070707');
  assert.equal(await f.api.queueSmsFallbackForFailedWhatsApp('wa-msg'), null);
  assert.equal(f.phoneRows('SMS').length, 1);
});

test('webhook fallback skips stale messages, purposes outside the SMS policy and unreachable numbers', async () => {
  const stale = fixture({ messages: [failedWhatsApp({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) })] });
  assert.equal(await stale.api.queueSmsFallbackForFailedWhatsApp('wa-msg'), null);
  const policy = fixture({ messages: [failedWhatsApp({ purpose: 'PAYMENT_CONFIRMED' })] });
  assert.equal(await policy.api.queueSmsFallbackForFailedWhatsApp('wa-msg'), null);
  const foreign = fixture({ order: { factureWhatsappTo: '+33612345678' }, messages: [failedWhatsApp()] });
  assert.equal(await foreign.api.queueSmsFallbackForFailedWhatsApp('wa-msg'), null);
  const shippingFulfilled = fixture({ order: { deliveryMode: 'EXPEDITION_CODITRANS' }, messages: [failedWhatsApp({ purpose: 'ORDER_FULFILLED' })] });
  assert.ok(await shippingFulfilled.api.queueSmsFallbackForFailedWhatsApp('wa-msg'));
});
