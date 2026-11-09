// Pastilles du menu latéral (navBadges.controller).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');

const db = {};
require.cache[path.join(__dirname, 'src/prisma.js')] = {
  id: 'prisma', filename: 'prisma', loaded: true, exports: db,
};

const { getNavBadges, launchLevel } = require('./src/controllers/admin/navBadges.controller');
const { Permission } = require('./src/auth/permissions');

function response() {
  return {
    code: 200, headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(v) { this.code = v; return this; },
    json(v) { this.body = v; return this; },
  };
}

const minutesAgo = (m) => new Date(Date.now() - m * 60000);

function fixture({ orders = [], sponsorships = 0 } = {}) {
  const calls = [];
  const matches = (o, where) => {
    if (where.assignedInvoicerId && o.assignedInvoicerId !== where.assignedInvoicerId) return false;
    if (where.billingWorkStatus === 'ESCALATED') return o.billingWorkStatus === 'ESCALATED';
    if (where.status?.in) return where.status.in.includes(o.status);
    if (where.status === 'SUBMITTED') return o.status === 'SUBMITTED';
    if (where.status === 'PAID') return o.status === 'PAID' && !o.launched;
    return false;
  };
  Object.assign(db, {
    preorder: {
      count: async ({ where }) => { calls.push(where); return orders.filter((o) => matches(o, where)).length; },
      findFirst: async ({ where }) => {
        const rows = orders.filter((o) => matches(o, where)).sort((a, b) => a.paidAt - b.paidAt);
        return rows[0] ? { paidAt: rows[0].paidAt } : null;
      },
    },
    sponsorship: { count: async () => sponsorships },
    countrySettings: {
      findUnique: async () => ({ cashierLaunchWarnAfterMinutes: 15, cashierLaunchAlertAfterMinutes: 25 }),
    },
  });
  return calls;
}

function req(role, permissions, id = 'agent-1') {
  return { user: { id, role, countryId: 'CIV', permissions }, countryId: 'CIV', query: {} };
}

const AGENT_PERMS = [Permission.INVOICE_CREATE, Permission.PAYMENT_VALIDATE, Permission.SPONSORSHIP_REVIEW];

test('launchLevel : neutre, orange puis rouge selon les seuils', () => {
  const settings = { warnAfterMinutes: 15, alertAfterMinutes: 25 };
  const now = new Date();
  assert.equal(launchLevel(null, settings, now), 'none');
  assert.equal(launchLevel(minutesAgo(5), settings, now), 'none');
  assert.equal(launchLevel(minutesAgo(16), settings, now), 'warn');
  assert.equal(launchLevel(minutesAgo(30), settings, now), 'alert');
});

test("agent de vente : seulement ses dossiers, détail caisse et urgence", async () => {
  fixture({
    sponsorships: 2,
    orders: [
      { status: 'SUBMITTED', assignedInvoicerId: 'agent-1' },
      { status: 'SUBMITTED', assignedInvoicerId: 'other' },
      { status: 'INVOICED', assignedInvoicerId: 'agent-1' },
      { status: 'PAID', assignedInvoicerId: 'agent-1', paidAt: minutesAgo(40) },
      { status: 'PAID', assignedInvoicerId: 'agent-1', paidAt: minutesAgo(3) },
      { status: 'PAID', assignedInvoicerId: 'other', paidAt: minutesAgo(90) },
      { status: 'INVOICED', assignedInvoicerId: 'other', billingWorkStatus: 'ESCALATED' },
    ],
  });
  const res = response();
  await getNavBadges(req('FACTURIER_CAISSIER', AGENT_PERMS), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.billing, 1);
  assert.equal(res.body.cashier, 3);
  assert.equal(res.body.sponsorships, 2);
  // Urgences partagées : comptées même si attribuées à un autre agent.
  assert.equal(res.body.escalations, 1);
  assert.equal(res.body.levels.cashier, 'alert');
  assert.equal(res.body.cashierDetail.toCollect, 1);
  assert.equal(res.body.cashierDetail.toLaunch, 2);
});

test('colis récent seulement : pastille neutre', async () => {
  fixture({ orders: [{ status: 'PAID', assignedInvoicerId: 'agent-1', paidAt: minutesAgo(2) }] });
  const res = response();
  await getNavBadges(req('FACTURIER_CAISSIER', AGENT_PERMS), res);
  assert.equal(res.body.cashier, 1);
  assert.equal(res.body.levels.cashier, 'none');
});

test('sans droit caisse ni parrainage : compteurs à 0', async () => {
  fixture({ sponsorships: 5, orders: [{ status: 'PAID', assignedInvoicerId: 'agent-1', paidAt: minutesAgo(60) }] });
  const res = response();
  await getNavBadges(req('INVOICER', [Permission.INVOICE_CREATE]), res);
  assert.equal(res.body.cashier, 0);
  assert.equal(res.body.sponsorships, 0);
  assert.equal(res.body.escalations, 0);
  assert.equal(res.body.levels.cashier, 'none');
});

test('caissière classique : pot commun', async () => {
  fixture({
    orders: [
      { status: 'PAID', assignedInvoicerId: 'a', paidAt: minutesAgo(20) },
      { status: 'PAID', assignedInvoicerId: 'b', paidAt: minutesAgo(1) },
    ],
  });
  const res = response();
  await getNavBadges(req('CAISSIERE', [Permission.PAYMENT_VALIDATE], 'cashier-9'), res);
  assert.equal(res.body.cashier, 2);
  assert.equal(res.body.levels.cashier, 'warn');
});
