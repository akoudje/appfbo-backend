const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Renvoi depuis l'admin des notifications de complément demandé et de refus.
function setup(sponsorship) {
  const sent = { sms: [], email: [], logs: [] };
  const stubs = {
    '../prisma': {
      sponsorship: { findUnique: async () => sponsorship },
      country: { findUnique: async () => ({ code: 'CIV', name: "Côte d'Ivoire" }) },
    },
    './email.service': { sendEmail: async (args) => { sent.email.push(args); return { accepted: true }; } },
    './sms.service': { sendSms: async (args) => { sent.sms.push(args); return { accepted: true }; } },
    './email-templates/layout': { BRAND: {}, renderLayout: ({ bodyHtml }) => bodyHtml, renderButton: ({ href }) => href },
    './sponsorship.service': {
      addSponsorshipLog: async (_tx, entry) => { sent.logs.push(entry); },
      findSponsorPhone: async () => '0700000002',
    },
    './sponsorship-agreement-pdf.service': {},
    './sponsorship-correction.service': {
      correctionUrl: (token) => `https://x.test/c/${token}`,
      createCorrectionToken: () => 'TOKEN',
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/services/sponsorship-notifications.service.js'), 'utf8'), {
    module, exports: module.exports, process, Buffer, Intl, console: { error() {}, warn() {}, info() {} },
    require: (name) => stubs[name] || {},
  });
  return { service: module.exports, sent };
}

const base = {
  id: 's1', countryId: 'civ', firstNames: 'Awa', lastName: 'Kone', mobile: '0700000001', email: 'awa@x.test',
  sponsorNom: 'Parrain', sponsorEmail: 'parrain@x.test', sponsorPhone: '0700000002',
};

test('resending a changes-requested notification sends a fresh correction link with the stored note', async () => {
  const row = { ...base, status: 'CHANGES_REQUESTED', reviewNote: 'Photo CNI illisible' };
  const { service, sent } = setup(row);
  const { kind, results } = await service.resendSponsorshipNotification({ sponsorship: row, channels: ['SMS'], resentBy: 'Admin', actorAdminId: 'a1' });
  assert.equal(kind, 'CHANGES_REQUESTED');
  assert.equal(results.length, 2);
  assert.equal(sent.email.length, 0);
  assert.equal(sent.sms.length, 2);
  assert.match(sent.sms[0].message, /https:\/\/x\.test\/c\/TOKEN/);
  assert.match(sent.sms[0].message, /Photo CNI illisible/);
  assert.equal(sent.logs[0].action, 'CHANGES_REQUESTED_NOTIFICATION_RESENT');
  assert.equal(sent.logs[0].actorAdminId, 'a1');
  assert.match(sent.logs[0].note, /Renvoi .* par Admin/);
});

test('resending a rejection notification uses the rejection reason on every channel', async () => {
  const row = { ...base, status: 'REJECTED', rejectionReason: 'Doublon' };
  const { service, sent } = setup(row);
  const { kind, results } = await service.resendSponsorshipNotification({ sponsorship: row, channels: ['SMS', 'EMAIL'], resentBy: 'Admin' });
  assert.equal(kind, 'REJECTED');
  assert.equal(results.length, 4);
  assert.equal(sent.email.length, 2);
  assert.ok(sent.sms.every((m) => /Doublon/.test(m.message) || /refuse/.test(m.message)));
  assert.equal(sent.logs[0].action, 'REJECTION_NOTIFICATION_RESENT');
});

test('statuses without a notification are refused with a clear message', async () => {
  const row = { ...base, status: 'SUBMITTED' };
  const { service } = setup(row);
  await assert.rejects(
    service.resendSponsorshipNotification({ sponsorship: row, channels: ['SMS'] }),
    (error) => error.statusCode === 409 && /Aucune notification/.test(error.message),
  );
});
