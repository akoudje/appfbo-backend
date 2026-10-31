const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

// Recouvrement : par facturier d'origine (traitées → payées) et liste
// « À recouvrer » (en attente, et annulées relançables aujourd'hui).

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, exports: module.exports, console, process, Date, Promise, Map, Intl,
    require(id) {
      for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value;
      return {};
    },
  });
  return module.exports;
}

function service(db = {}, register = { isOpen: true }) {
  const followup = load('src/services/payment-followup.service.js', {
    '/cash-register-closure.service': { getCashRegisterStatus: async () => register },
    '/ticket-inventory.service': require('./src/services/ticket-inventory.service'),
  });
  return load('src/services/cash-recovery.service.js', {
    '../prisma': db,
    '/countryScope': require('./src/helpers/countryScope'),
    '/ticket-inventory.service': require('./src/services/ticket-inventory.service'),
    '/cash-register-closure.service': { getCashRegisterStatus: async () => register },
    '/payment-followup.service': followup,
  });
}

const desiree = { id: 'desiree', fullName: 'Désirée' };
const order = (over) => ({
  status: 'INVOICED', paymentStatus: 'UNPAID', as400InvoiceTotalFcfa: 10000, invoicedById: 'desiree', invoicedByAdmin: desiree, ...over,
});

test('par facturier : traitées, payées, en attente, annulées et taux de recouvrement', () => {
  const { totals, byInvoicer } = service().summarizeByInvoicer([
    order({ status: 'FULFILLED', paymentStatus: 'PAID' }),
    order({ status: 'READY', paymentStatus: 'PAID', as400InvoiceTotalFcfa: 30000 }),
    order({ status: 'PAYMENT_PENDING' }),
    order({ status: 'CANCELLED' }),
    order({ status: 'CANCELLED', invoicedById: 'gisele', invoicedByAdmin: { id: 'gisele', fullName: 'Marie Gisèle' } }),
  ]);
  const d = byInvoicer.find((g) => g.key === 'desiree');
  assert.equal(d.processed.count, 4);
  assert.equal(d.paid.count, 2);
  assert.equal(d.paid.amountFcfa, 40000);
  assert.equal(d.pending.count, 1);
  assert.equal(d.cancelled.count, 1);
  assert.equal(d.recoveryRate, 50);
  assert.equal(d.amountRecoveryRate, 67);
  assert.equal(byInvoicer.find((g) => g.key === 'gisele').recoveryRate, 0);
  assert.equal(totals.processed.count, 5);
  assert.equal(totals.recoveryRate, 40);
});

test('à recouvrer : seules les annulations automatiques du jour sont relançables', async () => {
  const now = new Date('2026-10-31T15:00:00Z');
  const cancelled = [
    order({ id: 'auto-today', status: 'CANCELLED', cancelledAt: new Date('2026-10-31T09:00:00Z'), logs: [{ action: 'CANCEL', meta: { mode: 'AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW' } }] }),
    order({ id: 'closure-today', status: 'CANCELLED', cancelledAt: new Date('2026-10-31T12:00:00Z'), logs: [{ action: 'CANCEL', meta: { source: 'CASH_REGISTER_CLOSURE' } }] }),
    order({ id: 'auto-yesterday', status: 'CANCELLED', cancelledAt: new Date('2026-10-30T20:00:00Z'), logs: [{ action: 'CANCEL', meta: { mode: 'AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW' } }] }),
    order({ id: 'manual-today', status: 'CANCELLED', cancelledAt: new Date('2026-10-31T10:00:00Z'), logs: [{ action: 'CANCEL', meta: {} }] }),
  ];
  const seen = [];
  const db = {
    preorder: {
      findMany: async (args) => {
        seen.push(args.where);
        return args.where.status === 'CANCELLED' ? cancelled : [order({ id: 'pending', status: 'PAYMENT_PENDING' })];
      },
    },
  };
  const result = await service(db).loadToRecover({ countryId: 'CIV', country: { id: 'CIV', code: 'CIV' } }, { countryCode: 'CIV', now });
  assert.equal(result.agencyOpen, true);
  assert.deepEqual(result.pending.map((row) => row.id), ['pending']);
  assert.deepEqual(result.relaunchable.map((row) => row.id), ['auto-today', 'closure-today']);
  assert.equal(result.relaunchable[0].kind, 'RELAUNCH');
  assert.equal(result.pending[0].invoicer.label, 'Désirée');
  for (const where of seen) {
    assert.equal(where.isTest, false);
    assert.equal(where.settlementEntity, null);
  }
});

test('à recouvrer : agence fermée signalée', async () => {
  const db = { preorder: { findMany: async () => [] } };
  const result = await service(db, { isOpen: false }).loadToRecover({ countryId: 'CIV' }, { countryCode: 'CIV' });
  assert.equal(result.agencyOpen, false);
});
