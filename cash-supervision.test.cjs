const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

// Point de caisse : une ligne par encaissement, toutes sources confondues,
// avec les mêmes montants que les clôtures de caisse.

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, exports: module.exports, console, process, Date, Promise, Map,
    require(id) {
      for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value;
      return {};
    },
  });
  return module.exports;
}

const closures = load('src/controllers/admin/cashClosures.controller.js', { '/permissions': require('./src/auth/permissions') });

function service(db = {}) {
  return load('src/services/cash-supervision.service.js', {
    '../prisma': db,
    '/countryScope': require('./src/helpers/countryScope'),
    '/cashClosures.controller': closures,
  });
}

const desiree = { id: 'desiree', fullName: 'Désirée' };
const wavePreorder = {
  id: 'p1', preorderNumber: 'PO-1', fboNumero: '225-1', fboNomComplet: 'KONE', factureReference: '123',
  preorderPaymentMode: 'WAVE', totalFcfa: 74363, as400InvoiceTotalFcfa: 74363, emballageFcfa: 100,
  paidAt: new Date('2026-10-30T10:00:00Z'), invoicedByAdmin: desiree, manualPaymentValidatedBy: null,
  activePayment: { provider: 'WAVE', amountPaidFcfa: 75107, amountExpectedFcfa: 75107, status: 'SUCCEEDED' },
  cashierTransactions: [],
};

test('précommande Wave : encaissé = facture + frais Wave, attribuée au facturier', () => {
  const row = service().preorderRow(wavePreorder);
  assert.equal(row.amountFcfa, 75107);
  assert.equal(row.baseAmountFcfa, 74363);
  assert.equal(row.serviceFeeFcfa, 744);
  assert.equal(row.packagingFcfa, 100);
  assert.equal(row.paymentMode, 'WAVE');
  assert.equal(row.invoicer.label, 'Désirée');
});

test('précommande en caisse : montant reçu au comptoir et caissier', () => {
  const row = service().preorderRow({
    ...wavePreorder, preorderPaymentMode: 'ESPECES', activePayment: null,
    manualPaymentValidatedAt: new Date('2026-10-30T11:00:00Z'), manualPaymentValidatedBy: { id: 'c', fullName: 'Awa' },
    cashierTransactions: [{ paymentMode: 'ESPECES', amountExpectedFcfa: 74363, amountReceivedFcfa: 74363 }],
  });
  assert.equal(row.amountFcfa, 74363);
  assert.equal(row.serviceFeeFcfa, 0);
  assert.equal(row.paymentMode, 'ESPECES');
  assert.equal(row.cashier.label, 'Awa');
  assert.equal(row.invoicer.label, 'Désirée', 'la caisse ne change pas le facturier');
  assert.equal(row.paidAt.toISOString(), '2026-10-30T11:00:00.000Z');
});

test('lien : frais d\'expédition à part des liens hors précommande', () => {
  const s = service();
  const shipping = s.linkRow({
    id: 'l1', reference: 'SHIP-1', amountFcfa: 12423, baseAmountFcfa: 12300, serviceFeeFcfa: 123, paymentMethod: 'WAVE',
    paidAt: new Date(), source: 'SHIPPING', shippingOrder: { preorderNumber: 'PO-9', shippingDestinationCity: 'Bouaké' },
  });
  assert.equal(shipping.source, 'SHIPPING');
  assert.equal(shipping.reference, 'PO-9');
  const qr = s.linkRow({
    id: 'l2', reference: 'QR-1', amountFcfa: 39390, baseAmountFcfa: 39000, serviceFeeFcfa: 390, paymentMethod: 'WAVE',
    paidAt: new Date(), source: 'QR_FORM', invoiceReference: '126646', shippingOrder: null, createdBy: null,
  });
  assert.equal(qr.source, 'EXTERNAL_LINK');
  assert.equal(qr.detail, 'Paiement QR · 126646');
  assert.equal(qr.invoicer, null);
});

test('synthèse : totaux par source, moyen de paiement, facturier, emballage, événement', () => {
  const s = service();
  const rows = [
    s.preorderRow(wavePreorder),
    s.ticketRow({ id: 't1', orderNumber: 'TK-1', eventId: 'e1', event: { title: 'Gala' }, quantity: 2, totalFcfa: 20000, amountToPayFcfa: 20200, paymentServiceFeeFcfa: 200, paymentMethod: 'WAVE', paidAt: new Date() }),
    s.linkRow({ id: 'l2', reference: 'QR-1', amountFcfa: 39390, baseAmountFcfa: 39000, serviceFeeFcfa: 390, paymentMethod: 'WAVE', paidAt: new Date(), source: 'QR_FORM', shippingOrder: null }),
  ];
  const summary = s.summarize(rows);
  assert.equal(summary.totals.count, 3);
  assert.equal(summary.totals.amountFcfa, 75107 + 20200 + 39390);
  assert.equal(summary.totals.serviceFeeFcfa, 744 + 200 + 390);
  assert.equal(JSON.stringify(summary.bySource.map((g) => [g.key, g.count])), JSON.stringify([['PREORDER', 1], ['TICKET', 1], ['EXTERNAL_LINK', 1], ['SHIPPING', 0]]));
  assert.equal(summary.byPaymentMode.length, 1);
  assert.equal(summary.byInvoicer.find((g) => g.key === 'desiree').amountFcfa, 75107);
  assert.equal(summary.byInvoicer.find((g) => g.key === 'UNASSIGNED').count, 2);
  assert.equal(summary.packaging.amountFcfa, 100);
  assert.equal(summary.ticketsByEvent[0].label, 'Gala');
});

test('requêtes : précommandes de test et billets gratuits exclus, filtre facturier', async () => {
  const seen = {};
  const db = {
    preorder: {
      findMany: async (args) => { seen.preorder = args.where; return [wavePreorder]; },
      aggregate: async (args) => { seen.settled = args.where; return { _count: { _all: 0 }, _sum: {} }; },
    },
    ticketOrder: { findMany: async (args) => { seen.ticket = args.where; return []; } },
    externalPaymentLink: { findMany: async (args) => { seen.link = args.where; return []; } },
  };
  const s = service(db);
  const period = { start: new Date('2026-10-30T00:00:00Z'), end: new Date('2026-10-30T23:59:59Z') };
  period.previous = period;
  const req = { countryId: 'CIV' };

  await s.buildCashSupervisionReport(req, period, s.normalizeFilters({}));
  assert.equal(seen.preorder.isTest, false);
  assert.equal(seen.preorder.settlementEntity, null);
  assert.deepEqual([...seen.ticket.NOT.paymentMethod.in], ['FREE', 'TICKET_CREDIT']);

  seen.ticket = undefined;
  const report = await s.buildCashSupervisionReport(req, period, s.normalizeFilters({ invoicerId: 'desiree' }));
  assert.equal(seen.preorder.invoicedById, 'desiree');
  assert.equal(seen.link.createdById, 'desiree');
  assert.equal(seen.ticket, undefined, 'les billets n\'ont pas de facturier');
  assert.equal(report.totals.count, 1);
});

test('évolution par jour : total, emballage, billets', () => {
  const s = service();
  const rows = [
    s.preorderRow({ ...wavePreorder, paidAt: new Date('2026-10-29T10:00:00Z') }),
    s.preorderRow({ ...wavePreorder, paidAt: new Date('2026-10-30T10:00:00Z') }),
    s.ticketRow({ id: 't1', orderNumber: 'TK-1', eventId: 'e1', event: { title: 'Gala' }, quantity: 3, totalFcfa: 30000, amountToPayFcfa: 30300, paymentMethod: 'WAVE', paidAt: new Date('2026-10-30T12:00:00Z') }),
  ];
  const summary = s.summarize(rows);
  assert.equal(JSON.stringify(summary.byDay.map((d) => [d.key, d.count, d.packagingFcfa, d.ticketCount])),
    JSON.stringify([['2026-10-29', 1, 100, 0], ['2026-10-30', 2, 100, 3]]));
  assert.equal(summary.ticketsByEvent[0].ticketCount, 3);
});

test('clôtures : attendu par caissier et par jour, clôture manquante ou avec écart', async () => {
  const awa = { id: 'awa', fullName: 'Awa' };
  const db = {
    preorder: {
      findMany: async () => [
        { manualPaymentValidatedAt: new Date('2026-10-30T09:00:00Z'), manualPaymentValidatedBy: awa, preorderPaymentMode: 'ESPECES', as400InvoiceTotalFcfa: 50000, cashierTransactions: [{ paymentMode: 'ESPECES', amountReceivedFcfa: 50000 }] },
        { manualPaymentValidatedAt: new Date('2026-10-31T09:00:00Z'), manualPaymentValidatedBy: awa, preorderPaymentMode: 'ESPECES', as400InvoiceTotalFcfa: 20000, cashierTransactions: [] },
      ],
    },
    cashClosure: {
      findMany: async () => [
        { id: 'c1', dateKey: '2026-10-30', status: 'SUBMITTED', totalExpectedFcfa: 50000, totalDeclaredFcfa: 49000, discrepancyFcfa: -1000, cashier: awa },
      ],
    },
    cashRegisterStatus: { findMany: async () => [{ userId: null, isOpen: true }] },
  };
  const period = { start: new Date('2026-10-30T00:00:00Z'), end: new Date('2026-10-31T23:59:59Z') };
  const report = await service(db).buildClosuresReport({ countryId: 'CIV' }, period);
  const byDay = Object.fromEntries(report.rows.map((row) => [row.dateKey, row]));
  assert.equal(byDay['2026-10-30'].state, 'SUBMITTED');
  assert.equal(byDay['2026-10-30'].closure.discrepancyFcfa, -1000);
  assert.equal(byDay['2026-10-31'].state, 'MISSING');
  assert.equal(byDay['2026-10-31'].expectedFcfa, 20000);
  assert.equal(report.summary.missing, 1);
  assert.equal(report.summary.toReview, 1);
  assert.equal(report.summary.withDiscrepancy, 1);
  assert.equal(report.registers[0].label, 'Caisse du comptoir');
});

test('clôtures : un jour de virements uniquement n\'attend pas de clôture', async () => {
  const awa = { id: 'awa', fullName: 'Awa' };
  const transfer = (day, amount) => ({ manualPaymentValidatedAt: new Date(`${day}T09:00:00Z`), manualPaymentValidatedBy: awa, preorderPaymentMode: 'BANK_TRANSFER', as400InvoiceTotalFcfa: amount, cashierTransactions: [] });
  const db = {
    preorder: {
      findMany: async () => [
        transfer('2026-10-30', 150000),
        transfer('2026-10-30', 300000),
        transfer('2026-10-31', 80000),
        { manualPaymentValidatedAt: new Date('2026-10-31T10:00:00Z'), manualPaymentValidatedBy: awa, preorderPaymentMode: 'ESPECES', as400InvoiceTotalFcfa: 20000, cashierTransactions: [] },
      ],
    },
    cashClosure: {
      findMany: async () => [
        { id: 'd1', dateKey: '2026-10-30', status: 'DRAFT', totalExpectedFcfa: 0, totalDeclaredFcfa: 0, discrepancyFcfa: 0, cashier: awa },
        { id: 'd2', dateKey: '2026-10-31', status: 'DRAFT', totalExpectedFcfa: 0, totalDeclaredFcfa: 0, discrepancyFcfa: 0, cashier: { id: 'julie', fullName: 'Julie' } },
      ],
    },
    cashRegisterStatus: { findMany: async () => [] },
  };
  const period = { start: new Date('2026-10-30T00:00:00Z'), end: new Date('2026-10-31T23:59:59Z') };
  const report = await service(db).buildClosuresReport({ countryId: 'CIV' }, period);
  const state =(day, cashier) => report.rows.find((row) => row.dateKey === day && row.cashier.id === cashier).state;
  assert.equal(state('2026-10-30', 'awa'), 'TRANSFER_ONLY', 'un brouillon un jour de virements ne compte pas');
  assert.equal(report.rows.find((row) => row.dateKey === '2026-10-30').transferFcfa, 450000);
  assert.equal(state('2026-10-31', 'awa'), 'MISSING', 'des espèces le même jour exigent la clôture');
  assert.equal(state('2026-10-31', 'julie'), 'NOTHING_TO_CLOSE', 'brouillon vide sans paiement');
  assert.equal(report.summary.missing, 1);
  assert.equal(report.summary.transferOnly, 1);
});
