const test = require('node:test'), assert = require('node:assert/strict');
const phone = require('./src/utils/phone');

test('national numbers keep their existing format in every country', () => {
  assert.equal(phone.normalizeForCountry('07 07 07 07 07', 'CIV'), '+2250707070707');
  assert.equal(phone.normalizeForCountry('70123456', 'BFA'), '+22670123456');
  assert.equal(phone.normalizeForCountry('90123456', 'TGO'), '+22890123456');
  assert.equal(phone.normalizeForCountry('01 97 12 34 56', 'BEN'), '+2290197123456');
  assert.equal(phone.normalizeForCountry('90123456', 'NER'), '+22790123456');
  assert.equal(phone.normalizeForCountry('+33612345678', 'CIV'), '');
});

test('a contact number can come from any country when it carries its prefix', () => {
  assert.equal(phone.normalizeInternationalPhone('+33 6 12 34 56 78', 'CIV'), '+33612345678');
  assert.equal(phone.normalizeInternationalPhone('0033612345678', 'BFA'), '+33612345678');
  assert.equal(phone.normalizeInternationalPhone('+226 70 12 34 56', 'CIV'), '+22670123456');
  assert.equal(phone.normalizeInternationalPhone('0707070707', 'CIV'), '+2250707070707');
  for (const invalid of ['', 'abc', '123', '+33 1', 'x'.repeat(50)]) assert.equal(phone.normalizeInternationalPhone(invalid, 'CIV'), '');
  assert.equal(phone.isNationalPhone('+2250707070707', 'CIV'), true);
  assert.equal(phone.isNationalPhone('+22670123456', 'CIV'), false);
  assert.equal(phone.phoneRegion('+33612345678'), 'FR');
});

test('a foreign number is always the WhatsApp number', () => {
  const contact = phone.resolveContactPhones({ phone: '+33612345678', whatsapp: '0707070707', whatsappSameAsPhone: false }, 'CIV');
  assert.deepEqual(contact, { ok: true, phone: '+33612345678', whatsapp: '+33612345678', national: false });
});

test('a national number has an optional, possibly foreign, WhatsApp number', () => {
  assert.equal(phone.resolveContactPhones({ phone: '0707070707', whatsappSameAsPhone: true }, 'CIV').whatsapp, '+2250707070707');
  assert.equal(phone.resolveContactPhones({ phone: '0707070707' }, 'CIV').whatsapp, null);
  assert.equal(phone.resolveContactPhones({ phone: '0707070707', whatsapp: '+33612345678' }, 'CIV').whatsapp, '+33612345678');
  assert.equal(phone.resolveContactPhones({ phone: '0707070707', whatsapp: '12' }, 'CIV').code, 'WHATSAPP_INVALID');
});

test('a missing or invalid phone is refused with a distinct code', () => {
  assert.equal(phone.resolveContactPhones({}, 'CIV').code, 'PHONE_REQUIRED');
  assert.equal(phone.resolveContactPhones({ phone: '+33 1' }, 'CIV').code, 'PHONE_INVALID');
});

function submitHarness(draftPatch = {}) {
  const fs = require('node:fs'), vm = require('node:vm');
  const draft = { id: 'order', countryId: 'ci', fboId: 'fbo', status: 'DRAFT', fboNumero: '225-000-111-222', fboGrade: 'MANAGER', fboNomComplet: 'CLIENT TEST',
    personalDataConsentAccepted: true, deliveryMode: 'RETRAIT_SITE_FLP', preorderPaymentMode: 'WAVE',
    country: { id: 'ci', code: 'CIV', settings: { enablePickup: true, enableWave: true } },
    items: [{ productId: 'product', qty: 1, product: { countryProducts: [{ maxQtyPerOrder: 10, stockQty: 10 }] } }], ...draftPatch };
  const fboWrites = [], notifications = [];
  const db = {
    preorder: { findFirst: async () => draft, update: async ({ data }) => { Object.assign(draft, data); return { ...draft }; } },
    preorderItem: { update: async () => ({}) }, preorderLog: { create: async () => ({}) },
    fbo: { update: async args => { fboWrites.push(args); return {}; } },
  };
  db.$transaction = async fn => fn(db);
  const module = { exports: {} };
  const deps = {
    '../prisma': db, crypto: require('node:crypto'),
    '../services/country-order-options.service': require('./src/services/country-order-options.service'),
    '../services/shipping.service': require('./src/services/shipping.service'),
    '../helpers/countryScope': require('./src/helpers/countryScope'),
    '../services/pricing.service': { computePreorderTotals: async () => ({ preorder: draft, items: [{ productId: 'product', prixUnitaireFcfa: 40000, lineTotalFcfa: 40000 }], totals: { totalFcfa: 40000, totalProduitsFcfa: 40000, fraisLivraisonFcfa: 0 } }) },
    '../services/sms.service': { buildPreorderSmsMessage: () => 'Notification simulée' },
    '../services/preorder-notifications.service': { sendPreorderNotification: async args => { notifications.push(args); return { smsQueued: true, attempts: [] }; } },
    '../services/submission-schedule.service': { computeSubmissionWindow: () => ({}), canSubmitNow: () => true, serializeWindow: () => ({}) },
    '../services/billingQueue.service': { dispatchBillingQueue: async () => {} },
    '../services/realtime-events.service': { publishRealtimeEvent() {} },
    '../utils/phone': phone,
  };
  vm.runInNewContext(fs.readFileSync('./src/controllers/preorders.controller.js', 'utf8'), { module, Date, Map, process: { env: {} }, console: { log() {}, error() {} }, require: name => deps[name] || {} });
  const submit = async body => {
    const req = { params: { id: draft.id }, countryId: 'ci', country: draft.country, headers: {}, body: { paymentMode: 'WAVE', deliveryMode: 'RETRAIT_SITE_FLP', ...body } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(b) { this.body = b; return this; } };
    await module.exports.submit(req, res);
    return res;
  };
  return { draft, fboWrites, notifications, submit };
}

test('an order from abroad keeps the foreign number as phone and WhatsApp, on the order and the FBO record', async () => {
  const h = submitHarness();
  const res = await h.submit({ phoneRaw: '+33 6 12 34 56 78', whatsappSameAsPhone: false });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(h.draft.factureWhatsappTo, '+33612345678');
  assert.equal(h.draft.contactWhatsapp, '+33612345678');
  assert.equal(h.notifications[0].toWhatsapp, '+33612345678');
  assert.equal(h.fboWrites[0].where.id, 'fbo');
  assert.equal(h.fboWrites[0].data.phone, '+33612345678');
  assert.equal(h.fboWrites[0].data.whatsappPhone, '+33612345678');
});

test('an order placed by another FBO does not overwrite the customer contacts', async () => {
  const h = submitHarness({ placedByFboNumero: '225-999-999-999' });
  const res = await h.submit({ phoneRaw: '0707070707', whatsappPhone: '+33612345678' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(h.draft.contactWhatsapp, '+33612345678');
  assert.equal(h.fboWrites.length, 0);
});

test('an invalid number is refused before anything is saved', async () => {
  const h = submitHarness();
  const res = await h.submit({ phoneRaw: '+33 1' });
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'PHONE_INVALID');
  assert.equal(h.draft.status, 'DRAFT');
});
