// Frais d'expédition : une session Wave expirée ne tue plus le lien de
// paiement (cas réel : PO-CIV-20261104-0393, lien renvoyé puis aussitôt
// « expiré »), et le préparateur peut copier le lien.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function waveFixture({ link: initial, order } = {}) {
  let link = {
    id: 'link', source: 'SHIPPING', countryId: 'ci', status: 'ACTIVE', providerStatus: 'PENDING_CUSTOMER_ACTION',
    providerSessionId: 'session', providerCheckoutUrl: 'https://pay.wave.com/c/session', baseAmountFcfa: 3000, amountFcfa: 3030,
    currencyCode: 'XOF', expiresAt: null, ...initial,
  };
  const writes = [];
  const db = {
    externalPaymentLink: {
      findUnique: async () => link,
      updateMany: async (args) => {
        writes.push(args);
        const w = args.where;
        const matches = (!w.status || (typeof w.status === 'string' ? link.status === w.status : !w.status.notIn?.includes(link.status)))
          && (w.providerStatus === undefined || link.providerStatus === w.providerStatus)
          && (w.providerSessionId === undefined || link.providerSessionId === w.providerSessionId);
        if (!matches) return { count: 0 };
        link = { ...link, ...args.data };
        return { count: 1 };
      },
    },
    preorder: { findFirst: async () => (order === undefined ? { shippingFeeFcfa: 3000 } : order) },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('./src/services/external-wave-payment.service.js', 'utf8'), {
    module, Date, process: { env: {} }, console,
    require: (name) => (name === '../prisma' ? db : name === '../payments/payment-status.mapper' ? require('./src/payments/payment-status.mapper') : {}),
  });
  return { api: module.exports, writes, get link() { return link; } };
}

test('session Wave expirée : le lien reste actif, prêt pour une nouvelle session', async () => {
  const f = waveFixture();
  await f.api.syncExternalWaveLinkFromSession({ link: f.link, providerStatusRaw: { id: 'session', checkout_status: 'expired' } });
  assert.equal(f.link.status, 'ACTIVE');
  assert.equal(f.link.providerStatus, 'INITIATED');
  assert.equal(f.link.providerSessionId, null);
  assert.equal(f.link.providerCheckoutUrl, null);
});

test('événement expiré d’une ANCIENNE session : la session en cours n’est pas touchée', async () => {
  const f = waveFixture({ link: { providerSessionId: 'new-session' } });
  await f.api.syncExternalWaveLinkFromSession({ link: f.link, providerStatusRaw: { id: 'old-session', checkout_status: 'expired' } });
  assert.equal(f.writes.length, 0);
  assert.equal(f.link.providerSessionId, 'new-session');
});

test('lien déjà expiré par Wave (avant le correctif) : remis en service', async () => {
  const f = waveFixture({ link: { status: 'EXPIRED', providerStatus: 'EXPIRED' } });
  const revived = await f.api.reviveExpiredShippingLink(f.link);
  assert.equal(revived.status, 'ACTIVE');
  assert.equal(revived.providerSessionId, null);
});

test('pas de remise en service si les frais ont changé, la commande n’attend plus, ou le lien a sa propre échéance', async () => {
  for (const setup of [
    { order: { shippingFeeFcfa: 5000 } },
    { order: null },
    { link: { status: 'EXPIRED', providerStatus: 'EXPIRED', expiresAt: new Date(Date.now() - 1000) } },
  ]) {
    const f = waveFixture({ link: { status: 'EXPIRED', providerStatus: 'EXPIRED', ...setup.link }, order: setup.order });
    await f.api.reviveExpiredShippingLink(f.link);
    assert.equal(f.link.status, 'EXPIRED');
  }
});

test('un paiement confirmé n’est jamais réinitialisé', async () => {
  const f = waveFixture({ link: { status: 'PAID', providerStatus: 'SUCCEEDED' } });
  await f.api.syncExternalWaveLinkFromSession({ link: f.link, providerStatusRaw: { id: 'session', checkout_status: 'expired' } });
  assert.equal(f.link.status, 'PAID');
  await f.api.reviveExpiredShippingLink(f.link);
  assert.equal(f.link.status, 'PAID');
});

test('espace préparateur : lien copiable tant que les frais restent à payer', () => {
  const src = fs.readFileSync('./src/services/shipping-notifications.service.js', 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(src, {
    module, URL, Date, process: { env: { FRONTEND_PUBLIC_URL: 'https://forevercivstore.com' } }, console,
    require: (name) => (name === './shipping.service' ? { isShipping: () => true, carrierLabel: () => 'La Poste' } : name === './preorder-notifications.service' ? { resolveNotificationEmail: () => 'a@b.c', resolveNotificationPhone: () => '0700000000' } : {}),
  });
  const { withShippingNotification } = module.exports;
  const base = { deliveryMode: 'EXPEDITION_POSTE', shippingFeeFcfa: 3000, country: { code: 'CIV' }, messages: [] };
  const active = withShippingNotification({ ...base, shippingPaymentLink: { token: 'tok', status: 'ACTIVE', providerStatus: 'INITIATED', amountFcfa: 3030 } });
  assert.equal(active.shippingPaymentUrl, 'https://forevercivstore.com/external-payment/tok?country=CIV');
  assert.equal(active.shippingPaymentLink.token, undefined);
  const paid = withShippingNotification({ ...base, shippingPaymentLink: { token: 'tok', status: 'PAID', providerStatus: 'SUCCEEDED' } });
  assert.equal(paid.shippingPaymentUrl, null);
  const expired = withShippingNotification({ ...base, shippingPaymentLink: { token: 'tok', status: 'EXPIRED', providerStatus: 'EXPIRED' } });
  assert.equal(expired.shippingPaymentUrl, null);
  assert.equal(expired.shippingPaymentLinkExpired, true);
});
