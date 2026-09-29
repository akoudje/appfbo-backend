const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadController(name, prisma) {
  const module = { exports: {} };
  const shared = {
    buildOrdersWhere: (req, filters) => ({ countryId: req.countryId, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) }),
    classifyPaymentMethodCategory: (order) => order.paymentMethod,
  };
  const multer = Object.assign(() => ({ single: () => () => {} }), { memoryStorage: () => ({}) });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/controllers/admin/ticketEvents', name), 'utf8'), {
    module, console, process, Buffer,
    require: (id) => id === '../../../prisma' ? prisma : id === './shared' ? shared :
      id === 'multer' ? multer : id.endsWith('/public-url.service') ? { publicFrontendBaseUrl: () => 'https://public.example' } : {},
  });
  return module.exports;
}
function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('pagination: filtered country/event scope and all pages beyond 200 orders', async () => {
  let query;
  const controller = loadController('orders.js', { ticketOrder: {
    count: async ({ where }) => { assert.equal(where.countryId, 'CIV'); assert.equal(where.eventId, 'event-1'); assert.equal(where.status, 'PAID'); return 260; },
    findMany: async (args) => { query = args; return [{ id: 'last-order' }]; },
  }});
  const res = response();
  await controller.listOrders({ countryId: 'CIV', query: { eventId: 'event-1', status: 'PAID', page: '11', pageSize: '25' } }, res);
  assert.equal(res.code, 200);
  assert.equal(query.skip, 250);
  assert.equal(query.take, 25);
  assert.equal(res.body.pagination.total, 260);
  assert.equal(res.body.pagination.pageCount, 11);
});

test('pagination clamps a page after records are removed', async () => {
  const controller = loadController('orders.js', { ticketOrder: {
    count: async () => 0,
    findMany: async (args) => { assert.equal(args.skip, 0); return []; },
  }});
  const res = response();
  await controller.listOrders({ countryId: 'CIV', query: { page: '8' } }, res);
  assert.equal(res.body.pagination.page, 1);
  assert.equal(res.body.pagination.total, 0);
});

test('invalid pagination is rejected without querying the database', async () => {
  const controller = loadController('orders.js', { ticketOrder: {
    count: async () => { throw new Error('unexpected query'); },
  }});
  for (const query of [{ page: '0' }, { page: '-2' }, { page: '1.5' }, { page: 'abc' }, { page: '1', pageSize: '101' }]) {
    const res = response();
    await controller.listOrders({ countryId: 'CIV', query }, res);
    assert.equal(res.code, 400);
  }
});

test('legacy API clients keep the existing response without pagination', async () => {
  const controller = loadController('orders.js', { ticketOrder: {
    findMany: async (args) => { assert.equal(args.take, 200); assert.equal(args.skip, 0); return []; },
  }});
  const res = response();
  await controller.listOrders({ countryId: 'CIV', query: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.pagination, undefined);
});

function summaryDb(capacity = 500) {
  return {
    ticketEvent: { findFirst: async ({ where }) => {
      assert.equal(where.countryId, 'CIV'); assert.equal(where.id, 'event-1');
      return { id: 'event-1', slug: 'event-one', capacity };
    } },
    ticket: { groupBy: async ({ where }) => {
      assert.equal(where.countryId, 'CIV'); assert.equal(where.eventId, 'event-1');
      return [{ status: 'ACTIVE', _count: { _all: 200 } }, { status: 'USED', _count: { _all: 60 } }, { status: 'RESERVED', _count: { _all: 10 } }];
    } },
    ticketOrder: { findMany: async (query) => {
      assert.equal(query.where.countryId, 'CIV'); assert.equal(query.where.eventId, 'event-1');
      assert.equal(query.take, undefined); assert.equal(query.where.status, undefined); assert.equal(query.where.q, undefined);
      return [...Array.from({ length: 260 }, () => ({ status: 'PAID', paymentMethod: 'WAVE', quantity: 1, totalFcfa: 1000 })), { status: 'PENDING_PAYMENT', quantity: 10, totalFcfa: 10000 }];
    } },
  };
}

test('summary uses all event orders and ignores table filters', async () => {
  const controller = loadController('reports.js', summaryDb());
  const res = response();
  await controller.getEventSummary({ countryId: 'CIV', params: { id: 'event-1' }, query: { q: 'one buyer', status: 'PENDING_PAYMENT', page: '2' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.totals.totalFcfa, 260000);
  assert.equal(res.body.totals.ticketsCount, 260);
  assert.equal(res.body.totals.usedTickets, 60);
  assert.equal(res.body.totals.remainingCapacity, 230);
  assert.equal(res.body.totals.pendingOrdersCount, 1);
  assert.equal(res.body.publicUrl, 'https://public.example/events/event-one');
});

test('undefined capacity stays unknown; exceeded capacity never becomes negative', async () => {
  for (const [capacity, remaining] of [[null, null], [0, 0], [200, 0]]) {
    const controller = loadController('reports.js', summaryDb(capacity));
    const res = response();
    await controller.getEventSummary({ countryId: 'CIV', params: { id: 'event-1' } }, res);
    assert.equal(res.body.totals.remainingCapacity, remaining);
  }
});

test('unknown or out-of-country event returns 404', async () => {
  const controller = loadController('reports.js', { ticketEvent: { findFirst: async () => null } });
  const res = response();
  await controller.getEventSummary({ countryId: 'CIV', params: { id: 'missing' } }, res);
  assert.equal(res.code, 404);
});

