// Un paiement Wave confirmé ne doit jamais revenir « en attente » quand une
// autre session Wave (ancien lien ouvert par le client) répond « processing ».
// Cas réels : PO-CIV-20261109-0027, PO-CIV-20260904-0055.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');

require.cache[path.join(__dirname, 'src/utils/phone.js')] = {
  id: 'phone', filename: 'phone', loaded: true, exports: new Proxy({}, { get: () => () => null }),
};
require.cache[path.join(__dirname, 'src/prisma.js')] = { id: 'prisma', filename: 'prisma', loaded: true, exports: {} };

const { applyWaveMappedStateTx, shouldIgnoreWaveStatusAfterPaid } = require('./src/payments/payments.service');
const { mapWaveSessionToInternal } = require('./src/payments/payment-status.mapper');

function fakeTx({ paymentStatus, orderStatus, orderPaymentStatus }) {
  const state = {
    payment: { id: 'pay1', status: paymentStatus, amountExpectedFcfa: 36981, currencyCode: 'XOF', paidAt: null },
    preorder: { id: 'po1', status: orderStatus, paymentStatus: orderPaymentStatus, paidAt: null },
    paymentUpdates: [], preorderUpdates: [], attemptUpdates: [], logs: [],
  };
  const tx = {
    preorder: {
      findUnique: async () => ({ ...state.preorder }),
      update: async ({ data }) => { state.preorderUpdates.push(data); Object.assign(state.preorder, data); return { ...state.preorder }; },
    },
    payment: {
      findUnique: async () => ({ ...state.payment }),
      update: async ({ data }) => { state.paymentUpdates.push(data); Object.assign(state.payment, data); return { ...state.payment }; },
    },
    paymentAttempt: { update: async ({ data }) => { state.attemptUpdates.push(data); return { id: 'att', ...data }; } },
    paymentTransactionLog: { create: async ({ data }) => { state.logs.push(data); return data; } },
    preorderLog: { create: async ({ data }) => { state.logs.push(data); return data; } },
  };
  return { tx, state };
}

const args = (tx, session) => ({
  tx,
  preorder: { id: 'po1' },
  payment: { id: 'pay1', amountExpectedFcfa: 36981, currencyCode: 'XOF' },
  lastAttempt: { id: 'att-old', providerSessionId: 'cos-old', normalizedPayloadJson: {} },
  providerStatusRaw: session,
  mapped: mapWaveSessionToInternal(session),
});

test('shouldIgnoreWaveStatusAfterPaid', () => {
  const processing = mapWaveSessionToInternal({ checkout_status: 'open', payment_status: 'processing' });
  const succeeded = mapWaveSessionToInternal({ payment_status: 'succeeded' });
  assert.equal(shouldIgnoreWaveStatusAfterPaid({ currentPayment: { status: 'SUCCEEDED' }, mapped: processing }), true);
  assert.equal(shouldIgnoreWaveStatusAfterPaid({ currentPreorder: { paymentStatus: 'PAID' }, mapped: processing }), true);
  assert.equal(shouldIgnoreWaveStatusAfterPaid({ currentPayment: { status: 'PROCESSING' }, currentPreorder: { paymentStatus: 'PAYMENT_PENDING' }, mapped: processing }), false);
  assert.equal(shouldIgnoreWaveStatusAfterPaid({ currentPayment: { status: 'SUCCEEDED' }, mapped: succeeded }), false);
});

test('paiement confirmé + ancienne session « processing » : rien ne change', async () => {
  const { tx, state } = fakeTx({ paymentStatus: 'SUCCEEDED', orderStatus: 'PAID', orderPaymentStatus: 'PAID' });
  const result = await applyWaveMappedStateTx(args(tx, { checkout_status: 'open', payment_status: 'processing' }));
  assert.equal(result.ignored, true);
  assert.equal(state.paymentUpdates.length, 0);
  assert.equal(state.preorderUpdates.length, 0);
  assert.equal(state.attemptUpdates.length, 0);
  assert.equal(state.payment.status, 'SUCCEEDED');
  assert.equal(state.preorder.paymentStatus, 'PAID');
  assert.ok(state.logs.some((l) => /ignoré/.test(l.note || '')));
});

test('paiement confirmé + ancienne session expirée : rien ne change', async () => {
  const { tx, state } = fakeTx({ paymentStatus: 'SUCCEEDED', orderStatus: 'PAID', orderPaymentStatus: 'PAID' });
  await applyWaveMappedStateTx(args(tx, { checkout_status: 'expired' }));
  assert.equal(state.payment.status, 'SUCCEEDED');
  assert.equal(state.preorder.paymentStatus, 'PAID');
});

test('paiement pas encore confirmé : « processing » s’applique comme avant', async () => {
  const { tx, state } = fakeTx({ paymentStatus: 'PROCESSING', orderStatus: 'INVOICED', orderPaymentStatus: 'PAYMENT_PENDING' });
  await applyWaveMappedStateTx(args(tx, { checkout_status: 'open', payment_status: 'processing' }));
  assert.equal(state.paymentUpdates.length, 1);
  assert.equal(state.preorder.paymentStatus, 'PAYMENT_PENDING');
});

test('succès Wave : la commande passe toujours en Payée', async () => {
  const { tx, state } = fakeTx({ paymentStatus: 'PROCESSING', orderStatus: 'INVOICED', orderPaymentStatus: 'PAYMENT_PENDING' });
  await applyWaveMappedStateTx(args(tx, { payment_status: 'succeeded', checkout_status: 'complete', transaction_id: 'T1' }));
  assert.equal(state.payment.status, 'SUCCEEDED');
  assert.equal(state.preorder.status, 'PAID');
  assert.equal(state.preorder.paymentStatus, 'PAID');
});
