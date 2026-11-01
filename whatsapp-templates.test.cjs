const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const whatsapp = require('./src/services/whatsapp.service');

const TEMPLATE_ENV = {
  INVOICE_WAVE: 'MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_WAVE',
  INVOICE_CASH: 'MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_CASH',
  INVOICE_BANK: 'MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_BANK',
  REMINDER_WAVE: 'MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_WAVE',
  REMINDER_CASH: 'MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_CASH',
  REMINDER_BANK: 'MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_BANK',
  PAYMENT_CONFIRMED: 'MAILERSEND_WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED',
  PREPARATION_STARTED: 'MAILERSEND_WHATSAPP_TEMPLATE_PREPARATION_STARTED',
  ORDER_READY_PICKUP: 'MAILERSEND_WHATSAPP_TEMPLATE_ORDER_READY_PICKUP',
  ORDER_READY_SHIPPING: 'MAILERSEND_WHATSAPP_TEMPLATE_ORDER_READY_SHIPPING',
  SHIPPING_PAYMENT: 'MAILERSEND_WHATSAPP_TEMPLATE_SHIPPING_PAYMENT',
  ORDER_FULFILLED_PICKUP: 'MAILERSEND_WHATSAPP_TEMPLATE_ORDER_FULFILLED_PICKUP',
  ORDER_FULFILLED_SHIPPING: 'MAILERSEND_WHATSAPP_TEMPLATE_ORDER_FULFILLED_SHIPPING',
};

// Nombre de variables du corps de chaque modèle, d'après docs/whatsapp-templates.md.
const DOC = fs.readFileSync('./docs/whatsapp-templates.md', 'utf8');
function documentedBodyVariableCount(templateKey) {
  const name = `fbo_${templateKey.toLowerCase()}`;
  const section = DOC.split(/\n## \d+\. /).find(part => part.startsWith(`\`${name}\``));
  assert.ok(section, `section ${name} absente du catalogue`);
  const body = section.match(/\*\*Corps\*\*\s*```([\s\S]*?)```/)[1];
  return new Set(body.match(/\{\{\d+\}\}/g)).size;
}
function documentedHasButton(templateKey) {
  const name = `fbo_${templateKey.toLowerCase()}`;
  const section = DOC.split(/\n## \d+\. /).find(part => part.startsWith(`\`${name}\``));
  return /\*\*Bouton\*\* — URL dynamique/.test(section);
}

const BASE = 'https://shop.example.test';
function context(patch = {}) {
  return {
    customerName: 'KOUASSI Aya',
    preorderNumber: 'PO-CIV-20261101-0042',
    parcelNumber: 'COL-0042',
    paymentCollectionCode: 'A7K2Q',
    totalFcfaLabel: '48 500 FCFA',
    paymentExpiryHours: '48',
    paymentLink: '',
    paymentFlow: 'CASH',
    pickupCode: '583920',
    pickupAddress: '',
    bankAccountDetails: 'FLP CI - Ecobank - 0123',
    preorder: { deliveryMode: 'RETRAIT', shippingPaymentLink: null },
    ...patch,
  };
}

const CASES = {
  INVOICE_WAVE: ['INVOICE', { paymentFlow: 'WAVE', paymentLink: `${BASE}/payment/w/tok123` }],
  INVOICE_CASH: ['INVOICE', {}],
  INVOICE_BANK: ['INVOICE', { paymentFlow: 'ECOBANK_PAY', paymentLink: `${BASE}/payment/b/tok456` }],
  REMINDER_WAVE: ['REMINDER', { paymentFlow: 'WAVE', paymentLink: `${BASE}/payment/w/tok123` }],
  REMINDER_CASH: ['REMINDER', {}],
  REMINDER_BANK: ['REMINDER', { paymentFlow: 'BANK_TRANSFER', paymentLink: `${BASE}/payment/b/tok456` }],
  PAYMENT_CONFIRMED: ['PAYMENT_CONFIRMED', {}],
  PREPARATION_STARTED: ['PREPARATION_STARTED', {}],
  ORDER_READY_PICKUP: ['ORDER_READY', {}],
  ORDER_READY_SHIPPING: ['ORDER_READY', { preorder: { deliveryMode: 'EXPEDITION_CODITRANS' } }],
  SHIPPING_PAYMENT: ['SHIPPING_PAYMENT_LINK', {
    paymentLink: `${BASE}/external-payment/abc?country=CIV`,
    preorder: { deliveryMode: 'EXPEDITION_POSTE', shippingPaymentLink: { baseAmountFcfa: 3000, serviceFeeFcfa: 30, amountFcfa: 3030 } },
  }],
  ORDER_FULFILLED_PICKUP: ['ORDER_FULFILLED', {}],
  ORDER_FULFILLED_SHIPPING: ['ORDER_FULFILLED', { preorder: { deliveryMode: 'EXPEDITION_CODITRANS', deliveryTracking: 'CDT-1' } }],
};

test('every documented FBO template is resolved, configured and filled with the documented variable count', () => {
  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(TEMPLATE_ENV).sort());
  for (const [templateKey, [purpose, patch]] of Object.entries(CASES)) {
    const ctx = context(patch);
    assert.equal(whatsapp.resolveWhatsAppTemplateKey(purpose, ctx), templateKey, purpose);
    const vars = whatsapp.buildPreorderTemplateVariables(templateKey, ctx);
    assert.equal(vars.errorCode, undefined, `${templateKey}: ${vars.errorMessage}`);
    assert.equal(vars.body.length, documentedBodyVariableCount(templateKey), `${templateKey}: nombre de variables`);
    assert.equal(Boolean(vars.buttons?.length), documentedHasButton(templateKey), `${templateKey}: bouton`);
    for (const value of vars.body) {
      assert.ok(value && !/[\n\r\t]| {5,}/.test(value), `${templateKey}: valeur invalide pour Meta « ${value} »`);
    }
  }
});

test('.env.example declares exactly the template variables used by the code', () => {
  const declared = fs.readFileSync('./.env.example', 'utf8').match(/^MAILERSEND_WHATSAPP_TEMPLATE_\w+(?==)/gm);
  assert.deepEqual(declared.sort(), Object.values(TEMPLATE_ENV).sort());
});

test('payment buttons carry the link suffix after the fixed URL part', () => {
  const wave = whatsapp.buildPreorderTemplateVariables('INVOICE_WAVE', context(CASES.INVOICE_WAVE[1]));
  assert.deepEqual(wave.buttons, ['w/tok123']);
  const longForm = whatsapp.buildPreorderTemplateVariables('INVOICE_WAVE', context({ paymentFlow: 'WAVE', paymentLink: `${BASE}/payment/wave/order-1?country=BFA` }));
  assert.deepEqual(longForm.buttons, ['wave/order-1?country=BFA']);
  const shipping = whatsapp.buildPreorderTemplateVariables('SHIPPING_PAYMENT', context(CASES.SHIPPING_PAYMENT[1]));
  assert.deepEqual(shipping.buttons, ['abc?country=CIV']);
  // Intl sépare les milliers par une espace fine insécable (U+202F).
  assert.deepEqual(shipping.body.slice(3).map(value => value.replace(/\s/g, ' ')), ['3 000 FCFA', '30 FCFA', '3 030 FCFA']);
  const broken = whatsapp.buildPreorderTemplateVariables('INVOICE_WAVE', context({ paymentLink: 'https://other.example/x' }));
  assert.equal(broken.errorCode, 'WHATSAPP_BUTTON_LINK_INVALID');
});

test('bank invoice names the payment mode and the beneficiary account', () => {
  const vars = whatsapp.buildPreorderTemplateVariables('INVOICE_BANK', context(CASES.INVOICE_BANK[1]));
  assert.equal(vars.body[4], 'Ecobank Pay');
  assert.equal(vars.body[5], 'FLP CI - Ecobank - 0123');
  const noAccount = whatsapp.buildPreorderTemplateVariables('INVOICE_BANK', context({ ...CASES.INVOICE_BANK[1], bankAccountDetails: '' }));
  assert.equal(noAccount.body[5], 'affiché sur la page de dépôt de preuve');
});

test('pickup location uses the country address, else the country city', () => {
  const withAddress = whatsapp.buildPreorderTemplateVariables('ORDER_READY_PICKUP', context({ pickupAddress: 'Bureau FLP\nRue 12,   Zone 4' }));
  assert.equal(withAddress.body[3], 'Bureau FLP, Rue 12, Zone 4');
  const expectedCities = { CIV: 'ABIDJAN', BFA: 'OUAGADOUGOU', BEN: 'COTONOU', NER: 'NIAMEY', TGO: 'LOME' };
  for (const [countryCode, city] of Object.entries(expectedCities)) {
    assert.equal(whatsapp.buildPreorderTemplateVariables('ORDER_READY_PICKUP', context(), { countryCode }).body[3], city);
  }
});

test('purposes without a template never borrow another one', () => {
  for (const purpose of ['PREORDER_SUBMITTED', 'AUTO_CANCEL', 'TICKET_REMINDER', '']) {
    assert.equal(whatsapp.resolveWhatsAppTemplateKey(purpose, context()), null, purpose);
  }
});

async function withEnv(env, fn) {
  const saved = { ...process.env };
  const savedFetch = global.fetch;
  for (const key of Object.keys(process.env)) if (key.startsWith('MAILERSEND_') || key === 'WHATSAPP_PRIMARY_ENABLED') delete process.env[key];
  Object.assign(process.env, env);
  try { return await fn(); } finally { process.env = saved; global.fetch = savedFetch; }
}

test('WhatsApp can be the primary channel only when configured, templated and not switched off', async () => {
  const ctx = context(CASES.INVOICE_WAVE[1]);
  const configured = { MAILERSEND_WHATSAPP_API_KEY: 'k', MAILERSEND_WHATSAPP_SENDER: '+2250100000000' };
  await withEnv({}, () => assert.equal(whatsapp.canSendPreorderWhatsAppTemplate('INVOICE', ctx), false));
  await withEnv(configured, () => assert.equal(whatsapp.canSendPreorderWhatsAppTemplate('INVOICE', ctx), false));
  await withEnv({ ...configured, MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_WAVE: 'tpl' }, () => {
    assert.equal(whatsapp.canSendPreorderWhatsAppTemplate('INVOICE', ctx), true);
    assert.equal(whatsapp.canSendPreorderWhatsAppTemplate('INVOICE', { ...ctx, paymentLink: 'https://x.test/autre' }), false);
    assert.equal(whatsapp.canSendPreorderWhatsAppTemplate('AUTO_CANCEL', ctx), false);
  });
  await withEnv({ ...configured, MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_WAVE: 'tpl', WHATSAPP_PRIMARY_ENABLED: 'false' }, () => {
    assert.equal(whatsapp.canSendPreorderWhatsAppTemplate('INVOICE', ctx), false);
  });
});

test('without MailerSend configuration the channel stays simulated', async () => {
  await withEnv({}, async () => {
    const result = await whatsapp.sendPreorderWhatsAppNotification({ to: '0707070707', purpose: 'INVOICE', context: context(), fallbackMessage: 'x' });
    assert.equal(result.provider, 'SIMULATED');
    assert.equal(result.accepted, true);
  });
});

test('once MailerSend is configured, a missing template is an explicit failure, never a simulated success', async () => {
  await withEnv({ MAILERSEND_WHATSAPP_API_KEY: 'k', MAILERSEND_WHATSAPP_SENDER: '+2250100000000' }, async () => {
    global.fetch = async () => { throw new Error('ne doit pas appeler MailerSend'); };
    const missing = await whatsapp.sendPreorderWhatsAppNotification({ to: '0707070707', purpose: 'INVOICE', context: context(), fallbackMessage: 'x' });
    assert.equal(missing.accepted, false);
    assert.equal(missing.errorCode, 'MAILERSEND_WHATSAPP_TEMPLATE_MISSING');
    assert.match(missing.errorMessage, /MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_CASH/);
    const unknown = await whatsapp.sendPreorderWhatsAppNotification({ to: '0707070707', purpose: 'AUTO_CANCEL', context: context(), fallbackMessage: 'x' });
    assert.equal(unknown.errorCode, 'MAILERSEND_WHATSAPP_TEMPLATE_MISSING');
  });
});

test('a configured template is sent to MailerSend with positional body and button values', async () => {
  await withEnv({ MAILERSEND_WHATSAPP_API_KEY: 'k', MAILERSEND_WHATSAPP_SENDER: '+2250100000000', MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_WAVE: 'tpl-wave' }, async () => {
    let sent = null;
    global.fetch = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 202, text: async () => '', headers: { get: () => 'msg-1' } }; };
    const result = await whatsapp.sendPreorderWhatsAppNotification({ to: '0707070707', purpose: 'PAYMENT_LINK', context: context(CASES.INVOICE_WAVE[1]), countryCode: 'CIV' });
    assert.equal(result.accepted, true);
    assert.equal(result.providerMessageId, 'msg-1');
    assert.equal(sent.template_id, 'tpl-wave');
    assert.deepEqual(sent.to, ['+2250707070707']);
    assert.deepEqual(sent.personalization[0].data, {
      body: ['KOUASSI Aya', 'PO-CIV-20261101-0042', 'A7K2Q', '48 500 FCFA', '48'],
      buttons: ['w/tok123'],
    });
  });
});
