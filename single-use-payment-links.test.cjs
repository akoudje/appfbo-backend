// Liens de paiement Wave : valables 3 h, seul le dernier envoyé est valable,
// une seule session Wave ouverte par commande (règles du 2026-11-10).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');

process.env.PUBLIC_PAYMENT_LINK_SECRET = 'test-secret';
process.env.FRONTEND_PUBLIC_URL = 'https://shop.example';
delete process.env.WAVE_SIMULATION;

require.cache[path.join(__dirname, 'src/utils/phone.js')] = {
  id: 'phone', filename: 'phone', loaded: true, exports: new Proxy({}, { get: () => () => null }),
};
const db = {};
require.cache[path.join(__dirname, 'src/prisma.js')] = { id: 'prisma', filename: 'prisma', loaded: true, exports: db };

const win = require('./src/payments/payment-link-window');
const svc = require('./src/payments/payments.service');
const orchestrator = require('./src/payments/payment-orchestrator.service');

const H = 60 * 60 * 1000;
const T0 = new Date('2026-11-10T10:00:00.000Z');
const at = (ms) => new Date(T0.getTime() + ms);
const ORDER_ID = 'cmw8ydju400wb46ac8byr1nw9';
const order = (extra = {}) => ({ id: ORDER_ID, status: 'INVOICED', paymentStatus: 'PAYMENT_PENDING', paymentLinkIssuedAt: T0, ...extra });

test('lien valable 3 h, puis expiré', () => {
  const sec = win.toLinkSecond(T0);
  assert.equal(win.evaluatePaymentLinkWindow(order(), { tokenIssuedSec: sec, now: at(2.9 * H) }).code, 'OK');
  const late = win.evaluatePaymentLinkWindow(order(), { tokenIssuedSec: sec, now: at(3 * H) });
  assert.equal(late.code, 'LINK_EXPIRED');
  assert.equal(late.canRequestNewLink, true);
});

test('un lien plus ancien que le dernier envoyé est refusé', () => {
  const old = win.toLinkSecond(at(-30 * 60 * 1000));
  const r = win.evaluatePaymentLinkWindow(order(), { tokenIssuedSec: old, now: at(60 * 1000) });
  assert.equal(r.code, 'LINK_REPLACED');
  assert.equal(r.canRequestNewLink, true);
});

test('ancien format non daté : remplacé dès qu’un lien daté existe, sinon 3 h après le dernier envoi', () => {
  assert.equal(win.evaluatePaymentLinkWindow(order(), { legacyToken: true, now: at(60 * 1000) }).code, 'LINK_REPLACED');
  const legacyOrder = order({ paymentLinkIssuedAt: null });
  assert.equal(win.evaluatePaymentLinkWindow(legacyOrder, { legacyToken: true, legacyIssuedAt: T0, now: at(2 * H) }).code, 'OK');
  assert.equal(win.evaluatePaymentLinkWindow(legacyOrder, { legacyToken: true, legacyIssuedAt: T0, now: at(4 * H) }).code, 'LINK_EXPIRED');
  assert.equal(win.evaluatePaymentLinkWindow(legacyOrder, { legacyToken: true, now: at(1) }).code, 'LINK_EXPIRED');
});

test('commande payée ou annulée : plus aucun paiement, pas de nouveau lien', () => {
  const paid = win.evaluatePaymentLinkWindow(order({ status: 'PAID', paymentStatus: 'PAID' }), { now: at(1) });
  assert.equal(paid.code, 'ORDER_PAID');
  assert.equal(paid.canRequestNewLink, false);
  const succeeded = win.evaluatePaymentLinkWindow(order({ activePayment: { status: 'SUCCEEDED' } }), { now: at(1) });
  assert.equal(succeeded.code, 'ORDER_PAID');
  assert.equal(win.evaluatePaymentLinkWindow(order({ status: 'CANCELLED' }), { now: at(1) }).code, 'ORDER_CANCELLED');
  assert.equal(win.isPreorderPayableOnline(order({ status: 'CANCELLED' })), false);
  assert.equal(win.isPreorderPayableOnline(order({ paymentLinkIssuedAt: at(-10 * H) })), true);
});

test('réémission : lien gardé dans les 15 min du même envoi, sinon nouveau lien', () => {
  const sec = win.toLinkSecond(T0);
  assert.equal(win.shouldReissuePaymentLink(order(), [sec], at(5 * 60 * 1000)), false);
  assert.equal(win.shouldReissuePaymentLink(order(), [sec], at(20 * 60 * 1000)), true);
  assert.equal(win.shouldReissuePaymentLink(order(), [-1], at(60 * 1000)), true);
  assert.equal(win.shouldReissuePaymentLink(order({ paymentLinkIssuedAt: null }), [sec], at(1)), true);
});

test('jeton daté : signé, daté, et non falsifiable', () => {
  const token = svc.buildShortWavePaymentToken(ORDER_ID, 'CIV', 'AB12', T0);
  const parsed = svc.parseShortWavePaymentToken(token);
  assert.equal(parsed.legacy, false);
  assert.equal(parsed.issuedSec, win.toLinkSecond(T0));
  assert.ok(ORDER_ID.endsWith(parsed.orderSuffix));
  const parts = token.split('.');
  parts[3] = (parsed.issuedSec + 3600).toString(36); // date repoussée
  assert.equal(svc.parseShortWavePaymentToken(parts.join('.')), null);
  const legacy = svc.parseShortWavePaymentToken(svc.buildShortWavePaymentToken(ORDER_ID, 'CIV', 'AB12'));
  assert.equal(legacy.legacy, true);
  assert.equal(svc.parseShortWavePaymentToken(`${token}.`)?.issuedSec, parsed.issuedSec); // ponctuation du SMS
});

test('session Wave reprise si ouverte, récente et au même montant', () => {
  const attempt = { status: 'REDIRECT_READY', checkoutUrl: 'https://pay.wave.com/c/cos-1', providerSessionId: 'cos-1', createdAt: at(0) };
  const payment = { provider: 'WAVE', amountExpectedFcfa: 36981, attempts: [attempt] };
  assert.equal(svc.findReusableWaveAttempt(payment, 36981, at(5 * 60 * 1000)), attempt);
  assert.equal(svc.findReusableWaveAttempt(payment, 40000, at(5 * 60 * 1000)), null);
  assert.equal(svc.findReusableWaveAttempt(payment, 36981, at(25 * 60 * 1000)), null);
  assert.equal(svc.findReusableWaveAttempt({ ...payment, attempts: [{ ...attempt, status: 'EXPIRED' }] }, 36981, at(1)), null);
});

function resetDb() {
  for (const key of Object.keys(db)) delete db[key];
  const state = { preorder: order({ paymentLinkIssuedAt: at(-2 * H), paymentCollectionCode: 'AB12', country: { code: 'CIV' } }), attempts: [], updates: [] };
  db.preorder = {
    findUnique: async () => ({ ...state.preorder }),
    findFirst: async () => ({ ...state.preorder }),
    update: async ({ data }) => { state.updates.push(data); Object.assign(state.preorder, data); return { ...state.preorder }; },
  };
  db.paymentAttempt = {
    findMany: async () => state.attempts.filter((a) => ['CREATED', 'PROVIDER_SESSION_CREATED', 'REDIRECT_READY', 'PENDING'].includes(a.status)),
    update: async ({ where, data }) => { const a = state.attempts.find((x) => x.id === where.id); Object.assign(a, data); return a; },
  };
  db.orderMessage = { findFirst: async () => null };
  return state;
}

test('envoi d’un rappel : l’ancien lien est remplacé par un lien neuf, l’ancienne session Wave est fermée', async () => {
  const state = resetDb();
  state.attempts.push({ id: 'att1', providerSessionId: 'cos-old', status: 'REDIRECT_READY' });
  const expired = [];
  orchestrator.expireCheckoutSession = async (_p, { providerSessionId }) => { expired.push(providerSessionId); return {}; };
  const oldUrl = svc.buildShortWavePaymentUrl(ORDER_ID, 'CIV', 'AB12', state.preorder.paymentLinkIssuedAt);
  const fields = { message: `Rappel : payez ici ${oldUrl}.`, emailMessage: null, paymentLinkTarget: oldUrl, paymentLinkTracked: oldUrl };

  const next = await svc.refreshWavePaymentLinksForSend({ preorderId: ORDER_ID, fields });
  assert.notEqual(next.paymentLinkTarget, oldUrl);
  assert.ok(next.message.includes(next.paymentLinkTarget));
  assert.ok(!next.message.includes(oldUrl));
  assert.ok(next.message.endsWith('.'));
  assert.equal(state.updates.length, 1);
  assert.deepEqual(expired, ['cos-old']);
  assert.equal(state.attempts[0].status, 'EXPIRED');
  const parsed = svc.parseShortWavePaymentToken(next.paymentLinkTarget.split('/payment/w/')[1]);
  assert.equal(parsed.issuedSec, win.toLinkSecond(state.preorder.paymentLinkIssuedAt));
});

test('commande annulée : le message part tel quel, aucun lien neuf', async () => {
  const state = resetDb();
  state.preorder.status = 'CANCELLED';
  const oldUrl = svc.buildShortWavePaymentUrl(ORDER_ID, 'CIV', 'AB12', state.preorder.paymentLinkIssuedAt);
  const fields = { message: `Annulée ${oldUrl}`, paymentLinkTarget: oldUrl };
  assert.deepEqual(await svc.refreshWavePaymentLinksForSend({ preorderId: ORDER_ID, fields }), fields);
  assert.equal(state.updates.length, 0);
});

test('session déjà payée chez Wave : jamais fermée, signalée', async () => {
  const state = resetDb();
  state.attempts.push({ id: 'att1', providerSessionId: 'cos-paid', status: 'REDIRECT_READY' });
  orchestrator.expireCheckoutSession = async () => { throw Object.assign(new Error('already complete'), { statusCode: 409 }); };
  orchestrator.getCheckoutSession = async () => ({ paymentStatus: 'succeeded', checkoutStatus: 'complete' });
  const result = await svc.expireOpenWaveSessions({ preorderId: ORDER_ID });
  assert.equal(result.paidSessionFound, true);
  assert.equal(result.expired, 0);
  assert.equal(state.attempts[0].status, 'REDIRECT_READY');
});

test('paiement client avec un lien de plus de 3 h : refusé (410)', async () => {
  const state = resetDb();
  state.preorder.paymentLinkIssuedAt = new Date(Date.now() - 4 * H);
  state.preorder.activePayment = null;
  const token = svc.buildShortWavePaymentToken(ORDER_ID, 'CIV', 'AB12', state.preorder.paymentLinkIssuedAt);
  await assert.rejects(
    svc.initiateWavePayment({ req: { headers: {}, country: { id: 'civ' } }, preorderId: ORDER_ID, linkToken: token }),
    (e) => e.statusCode === 410 && e.code === 'LINK_EXPIRED',
  );
});

test('paiement client avec un lien remplacé : refusé (410)', async () => {
  const state = resetDb();
  state.preorder.paymentLinkIssuedAt = new Date(Date.now() - 10 * 60 * 1000);
  state.preorder.activePayment = null;
  const token = svc.buildShortWavePaymentToken(ORDER_ID, 'CIV', 'AB12', new Date(Date.now() - 60 * 60 * 1000));
  await assert.rejects(
    svc.initiateWavePayment({ req: { headers: {}, country: { id: 'civ' } }, preorderId: ORDER_ID, linkToken: token }),
    (e) => e.statusCode === 410 && e.code === 'LINK_REPLACED',
  );
});

// ── Liens hors précommande (EXT, QR) et frais d'expédition ──────────────────
const ext = require('./src/services/external-wave-payment.service');
const { closeWaveCheckoutSession } = require('./src/payments/wave-session-close');

test('lien externe : échéance plafonnée à 3 h', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  assert.equal(ext.capExternalLinkExpiry(null, now).toISOString(), '2026-11-10T13:00:00.000Z');
  assert.equal(ext.capExternalLinkExpiry('2026-11-12T10:00:00Z', now).toISOString(), '2026-11-10T13:00:00.000Z');
  assert.equal(ext.capExternalLinkExpiry('2026-11-10T11:00:00Z', now).toISOString(), '2026-11-10T11:00:00.000Z');
});

test('lien externe : session reprise seulement si ouverte et récente', () => {
  const now = new Date('2026-11-10T10:20:00Z');
  const link = { providerSessionId: 'cos-1', providerCheckoutUrl: 'https://pay.wave.com/c/cos-1', providerStatus: 'PENDING_CUSTOMER_ACTION', updatedAt: new Date('2026-11-10T10:10:00Z') };
  assert.equal(ext.isReusableExternalSession(link, now), true);
  assert.equal(ext.isReusableExternalSession({ ...link, updatedAt: new Date('2026-11-10T09:50:00Z') }, now), false);
  assert.equal(ext.isReusableExternalSession({ ...link, providerStatus: 'EXPIRED' }, now), false);
});

test('fermeture de session : payée ou en cours jamais fermée', async () => {
  orchestrator.expireCheckoutSession = async () => { throw new Error('refusé'); };
  orchestrator.getCheckoutSession = async () => ({ paymentStatus: 'processing', checkoutStatus: 'open' });
  assert.equal((await closeWaveCheckoutSession('cos-1')).processing, true);
  orchestrator.getCheckoutSession = async () => ({ paymentStatus: 'cancelled', checkoutStatus: 'expired' });
  assert.equal((await closeWaveCheckoutSession('cos-1')).closed, true);
  orchestrator.expireCheckoutSession = async () => ({});
  assert.equal((await closeWaveCheckoutSession('cos-2')).closed, true);
});

test('lien échu (ou ancien lien sans échéance de plus de 3 h) : session fermée, lien expiré', async () => {
  resetDb();
  const writes = [];
  db.externalPaymentLink = { updateMany: async ({ data }) => { writes.push(data); return { count: 1 }; } };
  orchestrator.expireCheckoutSession = async () => ({});
  const now = new Date('2026-11-10T14:00:00Z');
  const fresh = { id: 'l1', status: 'ACTIVE', expiresAt: new Date('2026-11-10T15:00:00Z'), createdAt: now };
  assert.equal((await ext.expireExternalLinkIfDue(fresh, now)).expired, false);
  const due = { id: 'l2', status: 'ACTIVE', providerSessionId: 'cos-9', expiresAt: new Date('2026-11-10T13:00:00Z'), createdAt: now };
  assert.equal((await ext.expireExternalLinkIfDue(due, now)).expired, true);
  const legacy = { id: 'l3', status: 'ACTIVE', expiresAt: null, createdAt: new Date('2026-11-10T09:00:00Z') };
  const r = await ext.expireExternalLinkIfDue(legacy, now);
  assert.equal(r.expired, true);
  assert.equal(writes[1].expiresAt.toISOString(), '2026-11-10T12:00:00.000Z'); // échéance fixée : le lien d'expédition n'est plus « remis en service »
  assert.equal(writes[0].status, 'EXPIRED');
});
