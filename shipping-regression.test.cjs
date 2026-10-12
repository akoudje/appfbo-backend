const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shipping = require('./src/services/shipping.service');
const options = require('./src/services/country-order-options.service');
const { customerOrderResponse } = require('./src/utils/customerOrderResponse');
const recipient = { shippingRecipientName: 'AMENAN KOUADIO', shippingRecipientPhone: '07 00 00 00 00', shippingDestinationCity: 'Bouaké' };
const order = { id: 'order', countryId: 'ci', country: { code: 'CIV', settings: { enableWave: true } }, preorderNumber: 'CIV-001', fboNomComplet: 'CLIENT TEST', status: 'PAID', paymentStatus: 'PAID', preparationLaunchedAt: new Date(), updatedAt: new Date(), deliveryMode: 'EXPEDITION_POSTE', ...recipient, totalFcfa: 40000, as400InvoiceTotalFcfa: 40000 };

function fixture(overrides = {}) {
  const writes = [];
  const db = {
    preorder: { findUnique: async () => ({ ...order, ...overrides.current }), updateMany: async args => { writes.push(['lock', args]); return { count: overrides.claimCount ?? 1 }; }, update: async args => { writes.push(['order', args]); return { ...order, ...args.data }; } },
    preparationChecklistItem: { findMany: async () => overrides.lines || [{ checked: true }] },
    preparationAnomaly: { count: async () => overrides.blocking || 0 },
    externalPaymentLink: { findUnique: async () => overrides.link || null, updateMany: async args => { writes.push(['cancel',args]); return { count: overrides.cancelCount ?? 1 }; }, create: async args => { writes.push(['link',args]); return { id: 'link', ...args.data }; } },
    preorderLog: { create: async args => { writes.push(['log',args]); return {}; } },
  };
  return { db, writes };
}

test('payment modes preserve carrier selection without breaking the legacy pickup policy', () => {
  for (const payment of ['ESPECES','WAVE','BANK_TRANSFER','ECOBANK_PAY']) {
    assert.equal(options.resolveDeliveryModeForPayment(payment, 'EXPEDITION_POSTE'), 'EXPEDITION_POSTE');
    assert.equal(options.resolveDeliveryModeForPayment(payment, 'EXPEDITION_CODITRANS'), 'EXPEDITION_CODITRANS');
    assert.equal(options.resolveDeliveryModeForPayment(payment, null), 'RETRAIT_SITE_FLP');
  }
});
test('disabling legacy home delivery keeps both carriers available and preserves pickup settings', () => {
  const settings = { enableDelivery: false, enablePickup: true };
  for (const deliveryMode of ['RETRAIT_SITE_FLP', 'EXPEDITION_POSTE', 'EXPEDITION_CODITRANS']) {
    assert.equal(options.validateCountryOrderOptions({ settings, paymentMode: 'WAVE', deliveryMode }).ok, true);
  }
  assert.equal(options.validateCountryOrderOptions({ settings, deliveryMode: 'LIVRAISON' }).ok, false);
  assert.equal(options.validateCountryOrderOptions({ settings: { ...settings, enablePickup: false }, deliveryMode: 'RETRAIT_SITE_FLP' }).ok, false);
  assert.equal(options.validateCountryOrderOptions({ settings, deliveryMode: 'UNKNOWN' }).ok, false);
});
test('shipping requires separate recipient coordinates and pickup discards them', () => {
  assert.equal(shipping.recipientInput(recipient, 'EXPEDITION_POSTE').shippingRecipientPhone, '+2250700000000');
  for (const key of Object.keys(recipient)) assert.throws(() => shipping.recipientInput({...recipient,[key]:''}, 'EXPEDITION_CODITRANS'));
  assert.throws(() => shipping.recipientInput({...recipient,shippingRecipientPhone:'letters0700000000'}, 'EXPEDITION_POSTE'));
  assert.throws(() => shipping.recipientInput({...recipient,shippingDestinationCity:'Bouaké\ncommande'}, 'EXPEDITION_POSTE'));
  assert.equal(shipping.recipientInput(recipient,'RETRAIT_SITE_FLP').shippingRecipientName,null);
});
test('the invoicer cannot determine shipping fees, while the preparer can', () => {
  const { getRolePermissions, Permission } = require('./src/auth/permissions');
  assert.equal(getRolePermissions('INVOICER').includes(Permission.PREPARATION_UPDATE), false);
  assert.equal(getRolePermissions('ORDER_PREPARER').includes(Permission.PREPARATION_UPDATE), true);
});
test('quotes require the actual postal weight or an integer carton count, and distinguish free from unknown', () => {
  for (const amount of ['',null,-1,1.5,true,' ','1e3','0x10',[],[123],{}]) assert.throws(() => shipping.quoteInput({shippingFeeFcfa:amount,shippingWeightKg:2}, 'EXPEDITION_POSTE'));
  for (const weight of [0,-1,'',1.0001]) assert.throws(() => shipping.quoteInput({shippingFeeFcfa:2000,shippingWeightKg:weight}, 'EXPEDITION_POSTE'));
  assert.throws(() => shipping.quoteInput({shippingFeeFcfa:2000,shippingParcelCount:1.5}, 'EXPEDITION_CODITRANS'));
  assert.equal(shipping.quoteInput({shippingFeeFcfa:0,shippingWeightKg:1.235}, 'EXPEDITION_POSTE').shippingFeeFcfa,0);
  assert.equal(shipping.shippingPaymentSummary({...order,shippingFeeFcfa:null}).status,'TO_QUOTE');
  assert.equal(shipping.shippingPaymentSummary({...order,shippingFeeFcfa:0}).status,'PAID');
});
test('a preparer quote creates a separate payment and cannot alter the paid product invoice', async () => {
  const {db,writes}=fixture();
  await shipping.setShippingQuote(db,order,{shippingFeeFcfa:2500,shippingWeightKg:2.4,totalFcfa:1,as400InvoiceTotalFcfa:1},'preparer');
  const payment=writes.find(([kind])=>kind==='link')[1].data;
  assert.equal(payment.source,'SHIPPING'); assert.equal(payment.baseAmountFcfa,2500); assert.equal(payment.serviceFeeFcfa,25); assert.equal(payment.amountFcfa,2525); assert.equal(payment.countryId,'ci');
  const data=writes.find(([kind])=>kind==='order')[1].data;
  for(const key of ['totalFcfa','as400InvoiceTotalFcfa','fraisLivraisonFcfa','paymentStatus','status']) assert.equal(data[key],undefined);
  assert.equal(data.shippingQuotedById,'preparer'); assert.equal(data.shippingPaymentLinkId,'link');
  assert.equal(writes.find(([kind])=>kind==='log')[1].data.actorAdminId,'preparer');
});
test('incomplete preparation, unpaid products, disabled Wave and stale snapshots never create payment links', async () => {
  for(const setup of [{lines:[{checked:false}]},{blocking:1},{claimCount:0},{modified:{status:'INVOICED'}},{modified:{country:{code:'CIV',settings:{enableWave:false}}}}]) {
    const {db,writes}=fixture(setup);
    await assert.rejects(shipping.setShippingQuote(db,{...order,...setup.modified},{shippingFeeFcfa:2500,shippingWeightKg:2.4},'preparer'));
    assert.equal(writes.some(([kind])=>kind==='link'),false);
  }
});
test('a payment initiation locks the quote even before a provider session id exists', async () => {
  const {db,writes}=fixture({link:{id:'link',status:'ACTIVE',providerStatus:'PROCESSING'}});
  await assert.rejects(shipping.setShippingQuote(db,{...order,shippingPaymentLinkId:'link'},{shippingFeeFcfa:1,shippingWeightKg:2},'preparer'));
  assert.equal(writes.length,0);
});
test('late payment initiation prevents replacing a quote even after the order lock succeeds', async () => {
  const {db,writes}=fixture({link:{id:'old',status:'ACTIVE',providerStatus:'INITIATED'},cancelCount:0});
  await assert.rejects(shipping.setShippingQuote(db,{...order,shippingPaymentLinkId:'old'},{shippingFeeFcfa:1000,shippingWeightKg:1},'preparer'));
  assert.equal(writes.some(([kind])=>kind==='link'),false);
});
test('shipping handover requires a matching successful fee payment, and reads the fresh quote under the lock', async () => {
  const valid={id:'link',source:'SHIPPING',countryId:'ci',baseAmountFcfa:2000,status:'PAID',providerStatus:'SUCCEEDED'};
  for(const link of [null,{...valid,status:'ACTIVE'},{...valid,baseAmountFcfa:1999},{...valid,countryId:'other'}]) {
    const {db}=fixture({current:{shippingFeeFcfa:2000,shippingPaymentLinkId:'link'},link});
    await assert.rejects(shipping.assertShippingPaid(db,{...order,shippingFeeFcfa:0}));
  }
  const {db}=fixture({current:{shippingFeeFcfa:2000,shippingPaymentLinkId:'link'},link:valid});
  await shipping.assertShippingPaid(db,order);
  const free=fixture({current:{shippingFeeFcfa:0}}); await shipping.assertShippingPaid(free.db,order);
  const refunded=fixture({current:{shippingFeeFcfa:0,paymentStatus:'REFUNDED'}}); await assert.rejects(shipping.assertShippingPaid(refunded.db,order));
});
test('customer shipping responses include only the payment action and recipient fields', () => {
  const result=customerOrderResponse({...order,shippingFeeFcfa:2000,shippingQuotedById:'private-user',shippingPaymentLinkId:'private-link',shippingPaymentLink:{id:'private-link',token:'unguessable-token',countryId:'ci',status:'ACTIVE',baseAmountFcfa:2000,amountFcfa:2020,serviceFeeFcfa:20,providerPayloadJson:{private:true}}});
  assert.equal(result.shippingPayment.path,'/external-payment/unguessable-token?country=CIV');
  assert.equal(result.shippingRecipientName,recipient.shippingRecipientName);
  for (const key of ['shippingQuotedById','shippingPaymentLinkId','shippingPaymentLink','countryId']) assert.equal(result[key],undefined);
});

function waveFixture() {
  let link={id:'link',source:'SHIPPING',countryId:'ci',status:'ACTIVE',providerStatus:'PROCESSING',providerSessionId:'session',baseAmountFcfa:2000,amountFcfa:2020,currencyCode:'XOF'};
  const writes=[];
  const db={externalPaymentLink:{findUnique:async()=>link,updateMany:async args=>{writes.push(args);link={...link,...args.data};return{count:1};}}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('./src/services/external-wave-payment.service.js','utf8'),{module,Date,process:{env:{}},require:name=>name==='../prisma'?db:name==='../payments/payment-status.mapper'?require('./src/payments/payment-status.mapper'):{} });
  return{api:module.exports,writes,get link(){return link;}};
}
const confirmation={id:'session',client_reference:'link',amount:'2020',currency:'XOF',payment_status:'succeeded',checkout_status:'complete'};
test('Wave cannot confirm shipping with a different amount, currency, session or reference', async () => {
  for (const patch of [{amount:1},{currency:'USD'},{id:'wrong'},{client_reference:'another-order'},{payment_status:'pending'}]) {
    const f=waveFixture(); await assert.rejects(f.api.syncExternalWaveLinkFromSession({link:f.link,providerStatusRaw:{...confirmation,...patch}})); assert.equal(f.writes.length,0);
  }
});
test('a verified shipping payment remains paid when an older pending event arrives', async () => {
  const f=waveFixture();
  await f.api.syncExternalWaveLinkFromSession({link:f.link,providerStatusRaw:confirmation});
  assert.equal(f.link.status,'PAID');
  await f.api.syncExternalWaveLinkFromSession({link:f.link,providerStatusRaw:{id:'session',payment_status:'pending'}});
  assert.equal(f.link.status,'PAID'); assert.equal(f.writes.length,1);
  assert.deepEqual(Array.from(f.writes[0].where.status.notIn),['PAID','CANCELLED']);
});
