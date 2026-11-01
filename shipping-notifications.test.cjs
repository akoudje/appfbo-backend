const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { OrderMessagePurpose, OrderMessageStatus } = require('@prisma/client');
const shipping = require('./src/services/shipping.service');

function moduleFrom(path, dependencies, env = { PUBLIC_APP_URL: 'https://customer.example.test' }) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), { module, URL, Date, Map, Buffer, process: { env }, console: { error() {}, warn() {} }, require: name => dependencies[name] || {} });
  return module.exports;
}

function fixture(patch = {}, env) {
  const records = [], emails = [], calls = [], results = [];
  let emailAccepted = true, emailErrorCode = null, sequence = 0;
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
    './email.service': { normalizeEmail: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')) ? value : '', sendEmail: async args => { emails.push(args); return { accepted: emailAccepted, provider: 'MOCK', providerMessageId: 'mail-' + emails.length, errorCode: emailErrorCode, errorMessage: 'Private provider response: secret' }; } },
    './notification-template-defaults': { getPaymentExpiryHours: () => 2 },
    './email-templates/layout': require('./src/services/email-templates/layout'),
    '../utils/phone': require('./src/utils/phone'),
    './shipping.service': shipping,
    './mobile-push.service': { sendPreorderMobilePush: async () => ({ sent: false, reason: 'NO_PUSH_TOKEN' }) },
    // WhatsApp non configuré : le SMS reste le canal téléphone.
    './whatsapp.service': { canSendPreorderWhatsAppTemplate: () => false },
  });
  const api = moduleFrom('./src/services/shipping-notifications.service.js', {
    '../prisma': db, './shipping.service': shipping,
    './preorder-notifications.service': { ...generic, sendPreorderNotification: async args => { calls.push(args); const result = await generic.sendPreorderNotification(args); results.push(result); return result; } },
  }, env);
  return { api, order, records, emails, calls, results, setEmailAccepted(value, code = null) { emailAccepted = value; emailErrorCode = code; } };
}
const request = { orderId: 'order', countryId: 'ci', actorName: 'Préparateur test' };

test('ERR_INVALID_URL configuration no longer prevents the email and queued SMS for a saved quote', async () => {
  assert.throws(() => new URL('forevercivstore.com'), error => error.code === 'ERR_INVALID_URL');
  for (const env of [{ PUBLIC_APP_URL: 'forevercivstore.com' }, { PUBLIC_APP_URL: 'invalid URL', APP_PUBLIC_BASE_URL: 'https://forevercivstore.com' }]) {
    const f = fixture({ order: { shippingFeeFcfa: 100 }, link: { baseAmountFcfa: 100, serviceFeeFcfa: 1, amountFcfa: 101 } }, env);
    const summary = await f.api.notifyShippingPayment(request);
    assert.equal(summary.status, 'QUEUED');
    assert.equal(f.emails.length, 1);
    assert.equal(f.records.filter(row => row.channel === 'SMS' && row.status === 'QUEUED').length, 1);
    assert.match(f.emails[0].body, /Total à régler séparément : 101 FCFA/);
    assert.ok(f.records.every(row => row.paymentLinkTarget.startsWith('https://forevercivstore.com/external-payment/')));
  }
});

test('shipping links accept the existing host-only configuration and skip unusable or admin addresses', () => {
  const order = fixture().order;
  for (const [env, expected] of [
    [{ APP_PUBLIC_BASE_URL: ' customer.example.test/ ' }, 'https://customer.example.test/'],
    [{ PUBLIC_APP_URL: 'not a URL', APP_PUBLIC_BASE_URL: 'https://customer.example.test' }, 'https://customer.example.test/'],
    [{ FRONTEND_PUBLIC_URL: 'https://admin.forevercivstore.com' }, 'https://forevercivstore.com/'],
    [{ PUBLIC_APP_URL: 'https://user:secret@example.test' }, 'https://forevercivstore.com/'],
    [{ FRONTEND_URL: 'https://one.example.test,https://two.example.test' }, 'https://forevercivstore.com/'],
  ]) {
    const api = moduleFrom('./src/services/shipping-notifications.service.js', { './shipping.service': shipping }, env);
    assert.ok(api.paymentUrl(order).startsWith(expected));
    assert.equal(api.paymentUrl(order).includes('secret'), false);
  }
});

test('missing buyer contacts report a failure before and after notifying without billing the parcel recipient', async () => {
  const f = fixture({ order: { fboEmail: 'invalid', factureWhatsappTo: null, fbo: { email: null } } });
  for (const summary of [f.api.notificationSummary(f.order), await f.api.notifyShippingPayment(request)]) {
    assert.equal(summary.status, 'FAILED');
    assert.equal(summary.code, 'NO_DESTINATION');
    assert.match(summary.message, /coordonnées de la commande/);
  }
  assert.equal(f.records.length, 0); assert.equal(f.emails.length, 0);
});

test('email-only notification works and explains the missing SMS contact', async () => {
  const f = fixture({ order: { factureWhatsappTo: null } });
  const summary = await f.api.notifyShippingPayment(request);
  assert.equal(summary.status, 'SENT');
  assert.match(summary.message, /SMS : coordonnée manquante/);
  assert.equal(f.emails.length, 1);
});

test('a skipped transport cannot silently return no notification as a successful request', async () => {
  const f = fixture();
  const api = moduleFrom('./src/services/shipping-notifications.service.js', {
    '../prisma': { preorder: { findFirst: async () => f.order }, orderMessage: { findMany: async () => [] } },
    './shipping.service': shipping,
    './preorder-notifications.service': { resolveNotificationEmail: () => 'buyer@example.test', resolveNotificationPhone: () => null, sendPreorderNotification: async () => ({ sent: false, skipped: true }) },
  });
  const summary = await api.notifyShippingPayment(request);
  assert.equal(summary.status, 'FAILED');
  assert.match(summary.message, /aucun envoi email ou SMS n’a été accepté/);
});

test('provider configuration failure remains visible on reload without revealing provider secrets', async () => {
  const f = fixture({ order: { factureWhatsappTo: null } });
  f.setEmailAccepted(false, 'EMAIL_PROVIDER_NOT_CONFIGURED');
  const sent = await f.api.notifyShippingPayment(request);
  const loaded = f.api.notificationSummary({ ...f.order, messages: f.records });
  for (const summary of [sent, loaded]) {
    assert.equal(summary.status, 'FAILED');
    assert.match(summary.message, /service email n’est pas configuré/);
    assert.equal(JSON.stringify(summary).includes('secret'), false);
  }
});

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

test('handover notification carries the actual reference in email and queues a compact SMS without pickup wording', async () => {
  const f=fixture({order:{status:'FULFILLED',deliveryTracking:'CODI-ISSIA-001',shippingDestinationCity:'ISSIA',shippingHandedOverAt:'2026-10-12T18:00:00Z',fulfilledAt:'2026-10-12T18:02:00Z'}});
  const messages=moduleFrom('./src/services/preorder-notifications.service.js',{'./shipping.service':shipping,'./sms.orange.service':{MAX_SMS_LENGTH:160}});
  const sms=messages.buildOrderFulfilledSmsMessage({preorder:f.order});
  const generic=moduleFrom('./src/services/preorder-notifications.service.js',{
    '../prisma':{countrySettings:{findUnique:async()=>null},orderMessage:{findFirst:async()=>null,create:async({data})=>({...data,id:'message'}),update:async({data})=>({...data,id:'message'})},orderMessageEvent:{create:async()=>({})}},
    './shipping.service':shipping,'./sms.orange.service':{MAX_SMS_LENGTH:160},'./notification-template-defaults':{getPaymentExpiryHours:()=>2},
    './email.service':{normalizeEmail:value=>value,sendEmail:async args=>{f.emails.push(args);return {accepted:true};}},'./email-templates/layout':require('./src/services/email-templates/layout'),'../utils/phone':require('./src/utils/phone'),
    './mobile-push.service':{sendPreorderMobilePush:async()=>({sent:false})},
    './whatsapp.service':{canSendPreorderWhatsAppTemplate:()=>false},
  });
  const result=await generic.sendPreorderNotification({preorder:f.order,purpose:'ORDER_FULFILLED',message:sms});
  assert.equal(result.smsQueued,true);assert.equal(result.emailSent,true);assert.ok(sms.length<=160);assert.match(f.emails[0].body,/CODI-ISSIA-001/);assert.match(f.emails[0].body,/ISSIA/);assert.equal(f.emails[0].body.includes('Code de retrait'),false);
  const long=messages.buildOrderFulfilledSmsMessage({preorder:{...f.order,deliveryTracking:'x'.repeat(120)}});assert.ok(long.length<=160);assert.match(long,/espace client/);
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
