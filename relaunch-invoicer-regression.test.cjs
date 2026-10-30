const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

// Une commande relancée doit toujours rester chez le facturier qui l'a traitée
// à l'origine, et la relance ne doit pas compter l'emballage deux fois.

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, exports: module.exports, console: { log() {}, error() {}, warn() {} }, process, Buffer, Date, Promise,
    require(id) {
      for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value;
      return {};
    },
  });
  return module.exports;
}

function invoiceService(order) {
  let current = structuredClone(order);
  const logs = [];
  const matches = (where) => where.status === current.status
    && where.OR.some((cond) => cond.assignedInvoicerId === current.assignedInvoicerId);
  const tx = {
    preorder: {
      updateMany: async ({ where, data }) => { if (!matches(where)) return { count: 0 }; current = { ...current, ...data }; return { count: 1 }; },
      findUnique: async () => ({ ...structuredClone(current), settlementEntity: null, settlementReference: null, assignedInvoicer: { fullName: 'Autre' } }),
      update: async ({ data }) => { current = { ...current, ...data }; return { ...structuredClone(current), fbo: {}, items: current.items, country: { code: 'CIV' } }; },
    },
    preorderItem: { update: async () => ({}) },
    preorderLog: { create: async ({ data }) => { logs.push(data); return data; } },
  };
  const db = {
    ...tx,
    preorder: { ...tx.preorder, findUnique: async () => ({ ...structuredClone(current), fbo: {}, country: { code: 'CIV' }, messages: [] }) },
    orderMessage: { findUnique: async () => null },
    $transaction: async (fn) => fn(tx),
  };
  const service = load('src/services/invoiceAndSendPreorder.service.js', {
    '../prisma': db,
    '/payments.service': { buildShortBankProofUploadUrl: () => 'https://pay/link', buildShortWavePaymentUrl: () => 'https://pay/wave' },
    '/sms.orange.service': { MAX_SMS_LENGTH: 480 },
    '/pricing.service': { computePreorderTotalsForGrade: async () => ({ items: [{ productId: 'p', prixUnitaireFcfa: 1000, lineTotalFcfa: 1000 }], totals: { totalProduitsFcfa: 1000, timbreEtatFcfa: 0, fraisLivraisonFcfa: 0, emballageFcfa: 100, totalFcfa: 1100 } }) },
    '/payment-pricing': require('./src/payments/payment-pricing'),
    '/preorder-notifications.service': { sendPreorderNotification: async () => ({ sent: true, smsSent: true, attempts: [] }) },
    '/email.service': { normalizeEmail: (v) => v || null },
    '/settlement.service': { settledPreorderData: () => ({}), logSettlementPaymentTx: async () => {}, settlementLabel: () => '' },
  });
  return { service, state: () => current, logs };
}

const submitted = {
  id: 'order', countryId: 'CIV', status: 'SUBMITTED', preorderPaymentMode: 'BANK_TRANSFER', fboGrade: 'MANAGER',
  fboEmail: 'client@example.com', factureWhatsappTo: '+2250700000000', items: [{ productId: 'p', qty: 1 }],
  assignedInvoicerId: 'desiree', invoicedById: 'desiree', as400InvoiceTotalFcfa: 1100, totalFcfa: 1100,
};

test('invoiceAndSendPreorder : preserveInvoicerId garde le facturier d\'origine comme auteur et titulaire', async () => {
  const { service, state, logs } = invoiceService(submitted);
  await service.invoiceAndSendPreorder({
    req: {}, preorderId: 'order', actorAdminId: 'admin', actorName: 'Admin', invoiceRefInput: '123',
    invoiceAmountOverrideInput: 1000, preserveInvoicerId: 'desiree',
  });
  assert.equal(state().invoicedById, 'desiree');
  assert.equal(state().assignedInvoicerId, 'desiree');
  assert.equal(state().totalFcfa, 1100);
  assert.ok(logs.some((log) => log.action === 'INVOICE' && log.actorAdminId === 'admin'), 'l\'admin qui relance reste tracé');
});

test('invoiceAndSendPreorder : sans preserveInvoicerId, la garde refuse un dossier attribué à un autre facturier', async () => {
  const { service } = invoiceService(submitted);
  await assert.rejects(
    service.invoiceAndSendPreorder({ req: {}, preorderId: 'order', actorAdminId: 'admin', invoiceRefInput: '123' }),
    /PREORDER_ALREADY_ASSIGNED/,
  );
});

function relaunchController(order, invoiceImpl) {
  let current = structuredClone(order);
  const calls = [];
  const tx = {
    payment: { updateMany: async () => ({ count: 0 }) },
    preorder: { update: async ({ data }) => { current = { ...current, ...data }; return current; } },
    preorderLog: { create: async ({ data }) => data },
  };
  const db = {
    ...tx,
    preorder: { ...tx.preorder, findFirst: async () => structuredClone(current) },
    countrySettings: { findUnique: async () => ({ bankPaymentDueHours: 6 }) },
    $transaction: async (fn) => fn(tx),
  };
  const controller = load('src/controllers/admin/orders.controller.js', {
    '../../prisma': db,
    '/invoiceAndSendPreorder.service': {
      invoiceAndSendPreorder: async (args) => {
        calls.push({ args, stateAtCall: structuredClone(current) });
        return invoiceImpl(args);
      },
    },
    '/preorder-expiration.service': { isBankProofPaymentMode: (mode) => mode === 'BANK_TRANSFER' },
    '/countryScope': require('./src/helpers/countryScope'),
    '/permissions': require('./src/auth/permissions'),
    '/realtime-events.service': { publishRealtimeEvent: () => {} },
  });
  return { controller, calls, state: () => current };
}

const cancelled = {
  ...submitted, status: 'CANCELLED', paymentStatus: 'UNPAID', factureReference: '123337', billingGrade: 'ANIMATEUR_ADJOINT',
  assignedInvoicerId: 'desiree', invoicedById: 'desiree', assignedAt: new Date('2026-10-30T08:00:00Z'),
  as400InvoiceTotalFcfa: 136746, totalFcfa: 136746, emballageFcfa: 100, fraisLivraisonFcfa: 0,
  cancelReason: 'Précommande préfacturée annulée automatiquement après 6H sans paiement confirmé.',
  logs: [{ action: 'CANCEL', meta: { mode: 'AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW' } }],
};
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = { countryId: 'CIV', country: { id: 'CIV' }, params: { id: 'order' }, body: {}, user: { id: 'admin', role: 'SUPER_ADMIN', fullName: 'Super Admin' } };

test('relaunchPayment : la commande reste chez le facturier d\'origine et l\'emballage n\'est pas compté deux fois', async () => {
  const { controller, calls } = relaunchController(cancelled, async () => ({ preorder: { id: 'order', status: 'INVOICED' } }));
  const response = res();
  await controller.relaunchPayment(req, response);
  assert.equal(response.code, 200);
  assert.equal(calls.length, 1);
  const { args, stateAtCall } = calls[0];
  assert.equal(args.preserveInvoicerId, 'desiree');
  assert.equal(args.actorAdminId, 'admin');
  assert.equal(args.invoiceAmountOverrideInput, 136646, 'montant AS400 sans l\'emballage, rajouté par la facturation');
  assert.equal(stateAtCall.assignedInvoicerId, 'desiree', 'jamais remis en file sans titulaire');
  assert.equal(stateAtCall.billingWorkStatus, 'IN_PROGRESS');
});

test('relaunchPayment : en cas d\'échec, l\'attribution d\'origine est restaurée', async () => {
  const { controller, state } = relaunchController(cancelled, async () => { throw new Error('SMS_DOWN'); });
  const response = res();
  await controller.relaunchPayment(req, response);
  assert.equal(response.code, 500);
  assert.equal(state().status, 'CANCELLED');
  assert.equal(state().assignedInvoicerId, 'desiree');
});
