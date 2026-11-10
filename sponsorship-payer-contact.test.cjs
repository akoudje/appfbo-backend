// Payeur tiers de l'achat de parrainage : saisie, notifications de paiement
// en plus du parrain, et bouton « Partager le lien » des emails de paiement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function stubModule(relPath, exports) {
  const file = require.resolve(path.join(__dirname, relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
// Normalisation téléphone simplifiée (libphonenumber absent de l'environnement de test).
const fakePhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+225${digits}`;
  if (digits.length === 13 && digits.startsWith('225')) return `+${digits}`;
  return null;
};
stubModule('src/utils/phone.js', { normalizeInternationalPhone: fakePhone, resolveContactPhones: () => ({ ok: true }), normalizeForCountry: fakePhone });
stubModule('src/prisma.js', {});
stubModule('src/services/cloudinary.js', { cloudinary: {}, uploadFile: async () => ({}) });
stubModule('src/services/sms.service.js', { sendSms: async () => ({ accepted: true }) });

const { normalizePayerContact } = require('./src/services/sponsorship.service');

test('payeur : facultatif, normalisé, au moins un téléphone ou un email', () => {
  assert.deepEqual(normalizePayerContact({}), { purchasePayerName: null, purchasePayerPhone: null, purchasePayerEmail: null });
  assert.deepEqual(normalizePayerContact({ payerName: ' koffi ama ', payerPhone: '07 07 07 07 07', payerEmail: 'AMA@X.CI' }), {
    purchasePayerName: 'KOFFI AMA', purchasePayerPhone: '+2250707070707', purchasePayerEmail: 'ama@x.ci',
  });
  assert.deepEqual(normalizePayerContact({ payerEmail: 'ama@x.ci' }).purchasePayerPhone, null);
  assert.throws(() => normalizePayerContact({ payerName: 'Ama' }), /téléphone ou l'email/);
  assert.throws(() => normalizePayerContact({ payerPhone: '123' }), /téléphone du payeur est invalide/);
  assert.throws(() => normalizePayerContact({ payerEmail: 'pas-un-email' }), /email du payeur est invalide/);
});

function notificationsSetup(sponsorship) {
  const sent = { sms: [], email: [], logs: [] };
  const layout = require('./src/services/email-templates/layout');
  const stubs = {
    '../prisma': {
      sponsorship: { findUnique: async () => sponsorship },
      country: { findUnique: async () => ({ code: 'CIV', name: "Côte d'Ivoire" }) },
      adminUser: { findUnique: async () => null },
    },
    './email.service': { sendEmail: async (args) => { sent.email.push(args); return { accepted: true }; } },
    './sms.service': { sendSms: async (args) => { sent.sms.push(args); return { accepted: true }; } },
    './email-templates/layout': layout,
    './sponsorship.service': {
      addSponsorshipLog: async (_tx, entry) => { sent.logs.push(entry); },
      findSponsorPhone: async () => null,
    },
    './sponsorship-agreement-pdf.service': { buildSponsorshipAgreementPdfBuffer: async () => Buffer.from('pdf') },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/services/sponsorship-notifications.service.js'), 'utf8'), {
    module, exports: module.exports, process, Buffer, Intl, console: { error() {}, warn() {}, info() {} },
    require: (name) => stubs[name] || {},
  });
  return { service: module.exports, sent };
}

const base = {
  id: 's1', countryId: 'civ', firstNames: 'AWA', lastName: 'KONE', mobile: '+2250700000001', email: 'awa@x.ci',
  sponsorNom: 'PARRAIN', sponsorEmail: 'parrain@x.ci', sponsorPhone: '+2250700000002', recruitFboNumero: '225000000001',
};
const order = { preorderNumber: 'PO-CIV-1', amountToPayFcfa: 60122, paymentMode: 'WAVE' };
const link = 'https://forevercivstore.com/payment/w/CIV-1';

test('approbation : le payeur reçoit aussi le lien de paiement (SMS + email), sans la fiche d’agrément', async () => {
  const { service, sent } = notificationsSetup({ ...base, purchasePayerName: 'KOFFI AMA', purchasePayerPhone: '+2250707070707', purchasePayerEmail: 'ama@x.ci' });
  const results = await service.notifySponsorshipApproved({ sponsorshipId: 's1', order, paymentLink: link });
  const payer = results.filter((r) => r.who === 'payeur');
  assert.equal(payer.length, 2);
  const sms = sent.sms.find((m) => m.to === '+2250707070707');
  assert.match(sms.message, /https:\/\/forevercivstore\.com\/payment\/w\/CIV-1/);
  const email = sent.email.find((m) => m.to === 'ama@x.ci');
  assert.match(email.subject, /PO-CIV-1/);
  assert.match(email.html, /Bonjour KOFFI AMA/);
  assert.equal(email.attachments, undefined);
  // Partage WhatsApp sous le bouton de paiement, dans tous les emails.
  for (const message of sent.email) assert.match(message.html, /wa\.me\/\?text=/);
  // Parrain et filleul toujours notifiés.
  assert.ok(sent.sms.some((m) => m.to === base.sponsorPhone));
  assert.ok(sent.email.some((m) => m.to === base.sponsorEmail));
  assert.match(sent.logs[0].note, /payeur : envoyé/);
});

test('sans payeur, ou payeur = parrain : rien de plus', async () => {
  for (const row of [base, { ...base, purchasePayerPhone: base.sponsorPhone, purchasePayerEmail: base.sponsorEmail }]) {
    const { service, sent } = notificationsSetup(row);
    const results = await service.notifySponsorshipApproved({ sponsorshipId: 's1', order, paymentLink: link });
    assert.equal(results.filter((r) => r.who === 'payeur').length, 0);
    assert.equal(sent.sms.length, 2);
    assert.equal(sent.email.length, 2);
  }
});

test('validation : le payeur reçoit la confirmation de paiement', async () => {
  const { service, sent } = notificationsSetup({ ...base, purchasePayerEmail: 'ama@x.ci' });
  await service.notifySponsorshipValidated({ sponsorshipId: 's1', preorderNumber: 'PO-CIV-1' });
  const email = sent.email.find((m) => m.to === 'ama@x.ci');
  assert.match(email.subject, /Paiement reçu/);
  assert.equal(sent.sms.length, 2);
});

test('emails de paiement des précommandes : lien « Partager par WhatsApp » sous le bouton', () => {
  const { renderShareLink, whatsappShareUrl } = require('./src/services/email-templates/layout');
  const html = renderShareLink({ text: `Forever : payer ici : ${link}` });
  assert.match(html, /Partager le lien par WhatsApp/);
  assert.ok(html.includes(whatsappShareUrl(`Forever : payer ici : ${link}`).replace(/&/g, '&amp;')));
  assert.equal(renderShareLink({ text: '' }), '');
  const src = fs.readFileSync('./src/services/preorder-notifications.service.js', 'utf8');
  assert.match(src, /shareText: paymentShareText\(context\)/);
});

test('précommandes : payeur ajouté seulement aux notifications de paiement d’un achat de parrainage', async () => {
  const calls = [];
  const stubs = {
    '../prisma': { sponsorship: { findFirst: async (args) => { calls.push(args); return { purchasePayerPhone: '+2250707070707', purchasePayerEmail: 'AMA@x.ci' }; } } },
    './email.service': { normalizeEmail: (v) => String(v || '').trim().toLowerCase() || null, sendEmail: async () => ({}) },
    './email-templates/layout': require('./src/services/email-templates/layout'),
    '../utils/phone': { normalizeForCountry: fakePhone },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/services/preorder-notifications.service.js'), 'utf8'), {
    module, exports: module.exports, process, Buffer, Intl, URL, console: { error() {}, warn() {}, info() {}, log() {} },
    require: (name) => stubs[name] || new Proxy({}, { get: () => () => ({}) }),
  });
  const { resolveSponsorshipPayerContact: resolve } = module.exports;
  const purchase = { id: 'po1', placedByFboNumero: '225000000009', paymentStatus: 'UNPAID' };
  assert.equal(JSON.stringify(await resolve(purchase, 'PAYMENT_LINK')), JSON.stringify({ phone: '+2250707070707', email: 'ama@x.ci' }));
  assert.ok(await resolve(purchase, 'REMINDER'));
  assert.ok(await resolve({ ...purchase, paymentStatus: 'PAID' }, 'PAYMENT_CONFIRMED'));
  // Pas les messages hors paiement, ni une relance une fois payé, ni une commande ordinaire.
  assert.equal(await resolve(purchase, 'ORDER_READY'), null);
  assert.equal(await resolve({ ...purchase, paymentStatus: 'PAID' }, 'REMINDER'), null);
  const before = calls.length;
  assert.equal(await resolve({ ...purchase, placedByFboNumero: null }, 'PAYMENT_LINK'), null);
  assert.equal(calls.length, before, 'pas de requête pour une commande non passée par un parrain');
});
