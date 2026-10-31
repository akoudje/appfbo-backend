const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

// Suivi des paiements par la responsable caisse : droit dédié, et relance
// seulement agence ouverte, le jour même de l'annulation.

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, exports: module.exports, console: { log() {}, error() {}, warn() {} }, process, Buffer, Date, Promise, Intl,
    require(id) {
      for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value;
      return {};
    },
  });
  return module.exports;
}

const { AdminRole, Permission, hasPermission } = require('./src/auth/permissions');

test('permissions : la responsable caisse peut relancer sans pouvoir facturer', () => {
  assert.ok(hasPermission(AdminRole.COUNTER_MANAGER, Permission.PAYMENT_FOLLOWUP));
  assert.ok(!hasPermission(AdminRole.COUNTER_MANAGER, Permission.INVOICE_CREATE));
  assert.ok(hasPermission(AdminRole.SUPER_ADMIN, Permission.PAYMENT_FOLLOWUP));
});

test('routes : relance et renvoi de notification ouverts au droit PAYMENT_FOLLOWUP', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src/routes/admin/orders.routes.js'), 'utf8');
  for (const route of ['relaunch-payment', 'resend-invoice-sms']) {
    assert.match(
      source,
      new RegExp(`"/:id/${route}",\\s*requireAnyPermission\\(\\[Permission\\.INVOICE_CREATE, Permission\\.PAYMENT_FOLLOWUP\\]\\)`),
    );
  }
});

function windowService(register) {
  return load('src/services/payment-followup.service.js', {
    '/cash-register-closure.service': { getCashRegisterStatus: async () => register },
    '/ticket-inventory.service': require('./src/services/ticket-inventory.service'),
  });
}

test('fenêtre de relance : caisse ouverte et annulation du jour', async () => {
  const { checkRelaunchWindow } = windowService({ isOpen: true });
  const now = new Date('2026-10-31T17:00:00Z');
  const today = await checkRelaunchWindow({ countryId: 'c', countryCode: 'CIV', cancelledAt: new Date('2026-10-31T09:00:00Z'), now });
  assert.equal(today.ok, true);
  const yesterday = await checkRelaunchWindow({ countryId: 'c', countryCode: 'CIV', cancelledAt: new Date('2026-10-30T18:00:00Z'), now });
  assert.equal(yesterday.code, 'RELAUNCH_WINDOW_EXPIRED');
});

test('fenêtre de relance : refusée caisse fermée', async () => {
  const { checkRelaunchWindow } = windowService({ isOpen: false });
  const result = await checkRelaunchWindow({ countryId: 'c', countryCode: 'CIV', cancelledAt: new Date(), now: new Date() });
  assert.equal(result.code, 'RELAUNCH_AGENCY_CLOSED');
});

test('fenêtre de relance : le jour est celui du pays, pas celui du serveur', async () => {
  const { checkRelaunchWindow } = windowService({ isOpen: true });
  // 23:30 UTC le 30/10 = 00:30 le 31/10 à Douala (UTC+1).
  const result = await checkRelaunchWindow({
    countryId: 'c', countryCode: 'CMR',
    cancelledAt: new Date('2026-10-30T23:30:00Z'), now: new Date('2026-10-31T10:00:00Z'),
  });
  assert.equal(result.ok, true);
});

function relaunchController(order, windowResult) {
  let current = structuredClone(order);
  const calls = { invoice: 0, window: [] };
  const tx = {
    payment: { updateMany: async () => ({ count: 0 }) },
    preorder: { update: async ({ data }) => { current = { ...current, ...data }; return current; } },
    preorderLog: { create: async ({ data }) => data },
  };
  const db = {
    ...tx,
    preorder: { ...tx.preorder, findFirst: async () => structuredClone(current) },
    countrySettings: { findUnique: async () => ({ bankPaymentDueHours: 72 }) },
    $transaction: async (fn) => fn(tx),
  };
  const controller = load('src/controllers/admin/orders.controller.js', {
    '../../prisma': db,
    '/invoiceAndSendPreorder.service': {
      invoiceAndSendPreorder: async () => { calls.invoice += 1; return { preorder: { id: 'order', status: 'INVOICED' } }; },
    },
    '/payment-followup.service': {
      checkRelaunchWindow: async (args) => { calls.window.push(args); return windowResult; },
    },
    '/preorder-expiration.service': { isBankProofPaymentMode: (mode) => mode === 'BANK_TRANSFER' },
    '/countryScope': require('./src/helpers/countryScope'),
    '/permissions': require('./src/auth/permissions'),
    '/realtime-events.service': { publishRealtimeEvent: () => {} },
  });
  return { controller, calls };
}

const cancelledAt = new Date('2026-10-31T09:00:00Z');
const cancelledOrder = (cancelLog) => ({
  id: 'order', countryId: 'CIV', status: 'CANCELLED', paymentStatus: 'UNPAID', preorderPaymentMode: 'WAVE',
  factureReference: '123337', items: [{ productId: 'p', qty: 1 }], country: { code: 'CIV' },
  invoicedById: 'desiree', assignedInvoicerId: 'desiree', as400InvoiceTotalFcfa: 1100, totalFcfa: 1100, emballageFcfa: 100,
  cancelledAt, cancelReason: 'Fermeture de caisse', logs: [cancelLog],
});
const autoCancel = { action: 'CANCEL', meta: { mode: 'AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW' } };
const closureCancel = { action: 'CANCEL', meta: { source: 'CASH_REGISTER_CLOSURE', fromStatus: 'INVOICED' } };
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const reqAs = (role) => ({
  countryId: 'CIV', country: { id: 'CIV', code: 'CIV' }, params: { id: 'order' }, body: {},
  user: { id: 'u', role, fullName: 'Responsable caisse' },
});

test('relaunchPayment : la responsable caisse relance dans la fenêtre', async () => {
  const { controller, calls } = relaunchController(cancelledOrder(autoCancel), { ok: true });
  const response = res();
  await controller.relaunchPayment(reqAs('COUNTER_MANAGER'), response);
  assert.equal(response.code, 200);
  assert.equal(calls.invoice, 1);
  assert.equal(calls.window[0].countryCode, 'CIV');
  assert.equal(calls.window[0].cancelledAt.getTime(), cancelledAt.getTime());
});

test('relaunchPayment : hors fenêtre, la relance est refusée sans rien modifier', async () => {
  const { controller, calls } = relaunchController(cancelledOrder(autoCancel), {
    ok: false, code: 'RELAUNCH_WINDOW_EXPIRED', message: 'à reprendre entièrement',
  });
  const response = res();
  await controller.relaunchPayment(reqAs('COUNTER_MANAGER'), response);
  assert.equal(response.code, 409);
  assert.equal(response.body.code, 'RELAUNCH_WINDOW_EXPIRED');
  assert.equal(calls.invoice, 0);
});

test('relaunchPayment : un admin global peut relancer hors fenêtre', async () => {
  const { controller, calls } = relaunchController(cancelledOrder(autoCancel), { ok: false, code: 'RELAUNCH_AGENCY_CLOSED' });
  const response = res();
  await controller.relaunchPayment(reqAs('SUPER_ADMIN'), response);
  assert.equal(response.code, 200);
  assert.equal(calls.window.length, 0);
});

test('relaunchPayment : une commande annulée par fermeture de caisse est relançable', async () => {
  const { controller, calls } = relaunchController(cancelledOrder(closureCancel), { ok: true });
  const response = res();
  await controller.relaunchPayment(reqAs('COUNTER_MANAGER'), response);
  assert.equal(response.code, 200);
  assert.equal(calls.invoice, 1);
});

test('relaunchPayment : une annulation manuelle reste non relançable', async () => {
  const manual = { ...cancelledOrder({ action: 'CANCEL', meta: { fromStatus: 'INVOICED' } }), cancelReason: 'Client a renoncé' };
  const { controller, calls } = relaunchController(manual, { ok: true });
  const response = res();
  await controller.relaunchPayment(reqAs('COUNTER_MANAGER'), response);
  assert.equal(response.code, 400);
  assert.equal(calls.invoice, 0);
});
