// Rappels « colis payés à lancer » et confirmation exigée à la fermeture de
// caisse (cashier-launch-alerts.service, cashRegisterStatus.controller).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');

// Client Prisma factice injecté à la place de src/prisma.js.
const db = {};
require.cache[path.join(__dirname, 'src/prisma.js')] = {
  id: 'prisma', filename: 'prisma', loaded: true, exports: db,
};

const alerts = require('./src/services/cashier-launch-alerts.service');
const closure = require('./src/services/cash-register-closure.service');
const controller = require('./src/controllers/admin/cashRegisterStatus.controller');
const { validateCountrySettings } = require('./src/services/country-settings-validation');

function response() { return { code: 200, status(v) { this.code = v; return this; }, json(v) { this.body = v; return this; } }; }

function fixture({ pending = [], paid = [] } = {}) {
  const state = { cancelled: [], logs: [], findManyCalls: [] };
  const preorder = {
    findMany: async (args) => {
      state.findManyCalls.push(args);
      if (args.where.status?.in) {
        return pending
          .filter((o) => !args.where.assignedInvoicerId || o.assignedInvoicerId === args.where.assignedInvoicerId)
          .filter((o) => !state.cancelled.includes(o.id))
          .map((o) => ({ items: [], ...o }));
      }
      return paid.filter((o) => !args.where.assignedInvoicerId || o.assignedInvoicerId === args.where.assignedInvoicerId);
    },
    update: async ({ where }) => { state.cancelled.push(where.id); return {}; },
  };
  const register = {
    findFirst: async () => null,
    create: async ({ data }) => ({ id: 'reg', ...data }),
    update: async ({ data }) => ({ id: 'reg', ...data }),
  };
  Object.assign(db, {
    preorder,
    cashRegisterStatus: register,
    preorderLog: { create: async ({ data }) => { state.logs.push(data); return data; } },
    countryProduct: { update: async () => ({}) },
    stockMovement: { create: async () => ({}) },
    async $transaction(fn) { return fn(db); },
  });
  return state;
}

const AGENT = { id: 'agent', role: 'FACTURIER_CAISSIER' };
const pendingCash = { id: 'p1', status: 'INVOICED', assignedInvoicerId: 'agent', preorderPaymentMode: 'ESPECES', totalFcfa: 50000, as400InvoiceTotalFcfa: 49000, preorderNumber: 'PO-1' };
const pendingWave = { id: 'p2', status: 'PAYMENT_PENDING', assignedInvoicerId: 'agent', preorderPaymentMode: 'WAVE', totalFcfa: 20000, preorderNumber: 'PO-2' };
const otherAgent = { id: 'p3', status: 'INVOICED', assignedInvoicerId: 'other', preorderPaymentMode: 'ESPECES', totalFcfa: 10000 };
const paidOrder = { id: 'paid', paidAt: new Date('2026-11-08T09:00:00Z'), parcelNumber: 'COL-1', assignedInvoicerId: 'agent' };

test('réglages : valeurs par défaut 15 / 25 / 10 / 3', () => {
  assert.deepEqual(alerts.normalizeLaunchAlertSettings(null), { warnAfterMinutes: 15, alertAfterMinutes: 25, reminderIntervalMinutes: 10, maxReminders: 3 });
});

test('réglages : 0 rappel accepté, alerte visuelle ramenée sous le seuil si incohérente', () => {
  const s = alerts.normalizeLaunchAlertSettings({ cashierLaunchWarnAfterMinutes: 40, cashierLaunchAlertAfterMinutes: 30, cashierLaunchMaxReminders: 0, cashierLaunchReminderIntervalMinutes: 0 });
  assert.equal(s.warnAfterMinutes, 29);
  assert.equal(s.alertAfterMinutes, 30);
  assert.equal(s.maxReminders, 0);
  assert.equal(s.reminderIntervalMinutes, 10);
});

test('validation des paramètres : alerte visuelle avant le seuil, bornes', () => {
  assert.ok(validateCountrySettings({ cashierLaunchWarnAfterMinutes: 25 }, { cashierLaunchAlertAfterMinutes: 25 }).cashierLaunchWarnAfterMinutes);
  assert.ok(validateCountrySettings({ cashierLaunchAlertAfterMinutes: 10 }, {}).cashierLaunchWarnAfterMinutes);
  assert.deepEqual(validateCountrySettings({ cashierLaunchWarnAfterMinutes: 10, cashierLaunchAlertAfterMinutes: 20 }, {}), {});
  assert.ok(validateCountrySettings({ cashierLaunchMaxReminders: 21 }, {}).cashierLaunchMaxReminders);
  assert.ok(validateCountrySettings({ cashierLaunchReminderIntervalMinutes: 0 }, {}).cashierLaunchReminderIntervalMinutes);
});

test('colis à lancer : payés, non lancés, hors contentieux AS400, périmètre agent', () => {
  const where = alerts.buildPendingLaunchWhere('CIV', { ownerId: 'agent' });
  assert.equal(where.status, 'PAID');
  assert.equal(where.paymentStatus, 'PAID');
  assert.equal(where.preparationLaunchedAt, null);
  assert.deepEqual(where.paidAt, { not: null });
  assert.equal(where.assignedInvoicerId, 'agent');
  assert.equal(alerts.buildPendingLaunchWhere('CIV').assignedInvoicerId, undefined);
});

test('aperçu de fermeture : préfactures à annuler (montant AS400) et colis payés non lancés', async () => {
  fixture({ pending: [pendingCash, pendingWave, otherAgent], paid: [paidOrder] });
  const preview = await closure.getClosurePreview(db, { countryId: 'CIV', assignedInvoicerId: 'agent' });
  assert.equal(preview.toCancelCount, 2);
  assert.equal(preview.toCancelCashCount, 1);
  assert.equal(preview.toCancelAmountFcfa, 69000);
  assert.equal(preview.paidNotLaunchedCount, 1);
  assert.equal(preview.paidNotLaunched[0].label, 'COL-1');
});

test('fermeture sans confirmation refusée (409) quand des préfactures seraient annulées', async () => {
  const state = fixture({ pending: [pendingCash] });
  const res = response();
  await controller.closeRegister({ countryId: 'CIV', user: AGENT, body: {} }, res);
  assert.equal(res.code, 409);
  assert.equal(res.body.code, 'CLOSURE_CONFIRMATION_REQUIRED');
  assert.equal(res.body.preview.toCancelCount, 1);
  assert.deepEqual(state.cancelled, []);
});

test('fermeture confirmée : annule et trace la confirmation dans l\'historique', async () => {
  const state = fixture({ pending: [pendingCash, otherAgent] });
  const res = response();
  await controller.closeRegister({ countryId: 'CIV', user: AGENT, body: { confirmNoUnrecordedCash: true } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.cancelledPreordersCount, 1);
  assert.deepEqual(state.cancelled, ['p1']);
  assert.equal(state.logs[0].meta.confirmedNoUnrecordedCash, true);
  assert.equal(state.logs[0].meta.source, 'CASH_REGISTER_CLOSURE');
});

test('fermeture sans préfacture à annuler : pas de confirmation exigée', async () => {
  const state = fixture({ pending: [otherAgent] });
  const res = response();
  await controller.closeRegister({ countryId: 'CIV', user: AGENT, body: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.cancelledPreordersCount, 0);
  assert.deepEqual(state.cancelled, []);
});

test('aperçu via l\'API : périmètre personnel pour un agent de vente', async () => {
  fixture({ pending: [pendingCash, otherAgent], paid: [paidOrder] });
  const res = response();
  await controller.getPreview({ countryId: 'CIV', user: AGENT }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.scope, 'personal');
  assert.equal(res.body.preview.toCancelCount, 1);
});
