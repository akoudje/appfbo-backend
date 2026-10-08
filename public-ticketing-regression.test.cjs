const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  { createRequire } = require("node:module");
process.env.CUSTOMER_JWT_SECRET = "isolated-ticket-test-secret";
function response() {
  return {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
function fixture(capacity = 3) {
  let state = {
    events: [
      {
        id: "event",
        countryId: "CIV",
        slug: "test",
        title: "Événement test",
        startsAt: new Date("2030-01-01"),
        status: "PUBLISHED",
        capacity,
        country: { code: "CIV", name: "Côte d’Ivoire" },
      },
    ],
    types: [
      {
        id: "type",
        eventId: "event",
        active: true,
        priceFcfa: 10000,
        maxPerOrder: 10,
        capacity,
      },
    ],
    orders: [],
    tickets: [],
    providerCreates: 0,
    emails: 0,
    providerStatus: {
      id: "session",
      payment_status: "processing",
      checkout_status: "open",
    },
  };
  let serial = Promise.resolve();
  function match(where, row, kind) {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (key === "OR") return value.some((w) => match(w, row, kind));
      if (key === "AND")
        return (Array.isArray(value) ? value : [value]).every((w) =>
          match(w, row, kind),
        );
      if (key === "countryId_clientRequestId") return match(value, row, kind);
      if (key === "event")
        return match(
          value.is || value,
          state.events.find((e) => e.id === row.eventId),
          "event",
        );
      if (key === "order")
        return match(
          value.is,
          state.orders.find((o) => o.id === row.orderId),
          "order",
        );
      if (key === "tickets") {
        const related = state.tickets.filter((t) => t.orderId === row.id);
        return value.none !== undefined
          ? !related.some((t) => match(value.none, t, "ticket"))
          : related.some((t) => match(value.some, t, "ticket"));
      }
      const actual = row?.[key];
      if (value instanceof Date)
        return new Date(actual).getTime() === value.getTime();
      if (value && typeof value === "object") {
        if ("in" in value) return value.in.includes(actual);
        if ("not" in value) return actual !== value.not;
        if ("gt" in value) return new Date(actual) > new Date(value.gt);
        if ("lt" in value) return new Date(actual) < new Date(value.lt);
      }
      return actual === value;
    });
  }
  function event(row) {
    return {
      ...structuredClone(row),
      ticketTypes: state.types
        .filter((t) => t.eventId === row.id)
        .map((t) => structuredClone(t)),
    };
  }
  function type(row) {
    return row
      ? {
          ...structuredClone(row),
          event: event(state.events.find((e) => e.id === row.eventId)),
        }
      : null;
  }
  function order(row) {
    return row
      ? {
          ...structuredClone(row),
          country: { code: "CIV" },
          event: event(state.events.find((e) => e.id === row.eventId)),
          ticketType: type(state.types.find((t) => t.id === row.ticketTypeId)),
          tickets: state.tickets
            .filter((t) => t.orderId === row.id)
            .map((t) => ({
              ...structuredClone(t),
              ticketType: type(
                state.types.find((v) => v.id === t.ticketTypeId),
              ),
            })),
        }
      : null;
  }
  function group(rows, by, sum = false) {
    const values = new Map();
    for (const row of rows) {
      const key = by.map((k) => row[k]).join(":");
      if (!values.has(key))
        values.set(key, {
          ...Object.fromEntries(by.map((k) => [k, row[k]])),
          ...(sum ? { _sum: { quantity: 0 } } : { _count: { _all: 0 } }),
        });
      sum
        ? (values.get(key)._sum.quantity += row.quantity)
        : values.get(key)._count._all++;
    }
    return [...values.values()];
  }
  const db = {
    $queryRaw: async () => [],
    ticketEvent: {
      findMany: async ({ where }) =>
        state.events.filter((e) => match(where, e, "event")).map(event),
    },
    ticketType: {
      findFirst: async ({ where }) =>
        type(state.types.find((t) => match(where, t, "type"))),
      findUnique: async ({ where }) =>
        type(state.types.find((t) => match(where, t, "type"))),
    },
    ticketOrder: {
      findUnique: async ({ where }) =>
        order(state.orders.find((o) => match(where, o, "order"))),
      findFirst: async ({ where }) =>
        order(state.orders.find((o) => match(where, o, "order"))),
      findMany: async ({ where }) =>
        state.orders.filter((o) => match(where, o, "order")).map(order),
      aggregate: async ({ where }) => ({
        _sum: {
          quantity: state.orders
            .filter((o) => match(where, o, "order"))
            .reduce((sum, o) => sum + o.quantity, 0),
        },
      }),
      groupBy: async ({ where, by }) =>
        group(
          state.orders.filter((o) => match(where, o, "order")),
          by,
          true,
        ),
      create: async ({ data }) => {
        const row = {
          ticketIssueCode:null,
          ...data,
          id: "order" + state.orders.length,
          updatedAt: new Date(),
        };
        state.orders.push(row);
        return order(row);
      },
      update: async ({ where, data }) => {
        const row = state.orders.find((o) => match(where, o, "order"));
        Object.assign(row, data, { updatedAt: new Date(Date.now() + 1) });
        return order(row);
      },
    },
    ticket: {
      count: async ({ where }) =>
        state.tickets.filter((t) => match(where, t, "ticket")).length,
      groupBy: async ({ where, by }) =>
        group(
          state.tickets.filter((t) => match(where, t, "ticket")),
          by,
        ),
      create: async ({ data }) => {
        const row = { ...data, id: "ticket" + state.tickets.length };
        state.tickets.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const rows = state.tickets.filter((t) => match(where, t, "ticket"));
        rows.forEach((t) => Object.assign(t, data));
        return { count: rows.length };
      },
    },
  };
  db.$transaction = (fn) => {
    const work = serial.then(async () => {
      const before = structuredClone(state);
      try {
        return await fn(db);
      } catch (e) {
        state = before;
        throw e;
      }
    });
    serial = work.catch(() => {});
    return work;
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve("src", file),
      real = createRequire(filename),
      module = { exports: {} };
    cache.set(file, module.exports);
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      module,
      console: { error() {}, warn() {} },
      process,
      Buffer,
      Date,
      require(id) {
        if (id === "../prisma") return db;
        const normalized = path
          .relative(
            path.resolve("src"),
            path.resolve(path.dirname(filename), id + ".js"),
          )
          .replaceAll("\\", "/");
        if (
          [
            "services/ticket-inventory.service.js",
            "services/ticket-order-ticketing.service.js",
            "services/ticket-wave-payment.service.js",
          ].includes(normalized)
        )
          return load(normalized);
        if (id.endsWith("/ticket-email-notifications.service"))
          return {
            sendTicketOrderEmail: async () => {
              state.emails++;
              return { sent: true };
            },
            sendTicketOrderAccessEmail: async () => {
              state.emails++;
            },
          };
        if (id.endsWith("/payment-orchestrator.service"))
          return {
            createCheckoutSession: async () => {
              state.providerCreates++;
              return {
                providerSessionId: "session" + state.providerCreates,
                checkoutUrl: "https://pay.test/" + state.providerCreates,
                raw: { id: "session" + state.providerCreates },
              };
            },
            getCheckoutSession: async () => ({ raw: state.providerStatus }),
            getCheckoutSessionDetails: async () => ({
              raw: state.providerStatus,
            }),
          };
        if (id.endsWith("/public-url.service"))
          return { publicFrontendBaseUrl: () => "https://tickets.test" };
        return real(id);
      },
    });
    cache.set(file, module.exports);
    return module.exports;
  }
  const api = load("controllers/ticketing.controller.js"),
    wave = load("services/ticket-wave-payment.service.js");
  const request = (patch = {}) => ({
    countryId: "CIV",
    country: { code: "CIV" },
    query: {},
    params: { slug: "test" },
    body: {
      eventSlug: "test",
      ticketTypeId: "type",
      quantity: 1,
      buyerFullName: "Client test",
      buyerPhone: "0700000000",
      buyerEmail: "client@example.test",
      clientRequestId: "request_test_000001",
      ...patch,
    },
  });
  async function buy(patch) {
    const r = response();
    await api.createTicketOrder(request(patch), r);
    return r;
  }
  return {
    db,
    api,
    wave,
    request,
    buy,
    get state() {
      return state;
    },
  };
}
test("two buyers compete for one place, with exactly one reservation", async () => {
  const f = fixture(1),
    results = await Promise.all([
      f.buy(),
      f.buy({ clientRequestId: "request_test_000002" }),
    ]);
  assert.deepEqual(results.map((r) => r.code).sort(), [201, 409]);
  assert.equal(f.state.orders.length, 1);
  assert.equal(f.state.providerCreates, 1);
});
test("a repeated client request reuses the same order and checkout", async () => {
  const f = fixture(),
    results = await Promise.all([f.buy(), f.buy()]);
  assert.equal(results[0].body.orderNumber, results[1].body.orderNumber);
  assert.equal(f.state.orders.length, 1);
  assert.equal(f.state.providerCreates, 1);
});
test("changing identity or quantity with an existing request key is refused", async () => {
  const f = fixture();
  await f.buy();
  const r = await f.buy({ quantity: 2 });
  assert.equal(r.code, 409);
  assert.equal(f.state.orders.length, 1);
});
test("price is confirmed by the server before any reservation or checkout", async () => {
  const f = fixture(),
    r = await f.buy({ expectedAmountToPayFcfa: 10000 });
  assert.equal(r.code, 409);
  assert.equal(r.body.code, "PRICE_CHANGED");
  assert.equal(f.state.orders.length, 0);
});
test("creation returns complete pricing and a possession token", async () => {
  const f = fixture(),
    r = await f.buy({ expectedAmountToPayFcfa: 10100 });
  assert.equal(r.code, 201);
  assert.equal(r.body.totalFcfa, 10000);
  assert.equal(r.body.paymentServiceFeeFcfa, 100);
  assert.equal(r.body.amountToPayFcfa, 10100);
  assert.ok(r.body.accessToken);
  assert.equal("providerPayloadJson" in r.body, false);
  assert.equal("providerSessionId" in r.body, false);
  assert.equal(r.body.tickets.length, 0);
});
test("a Wave failure leaves a resumable order rather than a duplicate purchase", async () => {
  const f = fixture();
  f.wave.initiateTicketWavePayment = async () => {
    throw Error("Wave offline");
  };
  const r = await f.buy();
  assert.equal(r.code, 201);
  assert.equal(r.body.paymentInitiated, false);
  assert.ok(r.body.accessToken);
  assert.ok(r.body.paymentError);
  const resume = response();
  await f.api.resumeTicketOrder(f.request(), resume);
  assert.equal(resume.code, 200);
  assert.equal(resume.body.orderNumber, r.body.orderNumber);
});
test("free purchases issue active tickets without contacting Wave", async () => {
  const f = fixture(1);
  f.state.types[0].priceFcfa = 0;
  const r = await f.buy();
  assert.equal(r.code, 201);
  assert.equal(r.body.status, "PAID");
  assert.equal(r.body.amountToPayFcfa, 0);
  assert.equal(r.body.tickets.length, 1);
  assert.equal(f.state.providerCreates, 0);
});
test("event capacity is shared across ticket categories", async () => {
  const f = fixture(1);
  f.state.types.push({ ...f.state.types[0], id: "vip" });
  await f.buy();
  const r = await f.buy({
    ticketTypeId: "vip",
    clientRequestId: "request_test_000002",
  });
  assert.equal(r.code, 409);
});
test("availability includes held seats and remaining global capacity", async () => {
  const f = fixture(1);
  await f.buy();
  const r = response();
  await f.api.listPublicEvents(f.request(), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.data[0].remaining, 0);
  assert.equal(r.body.data[0].salesStatus, "SOLD_OUT");
});
test("expired holds beyond the grace period release seats", async () => {
  const f = fixture(1);
  await f.buy();
  f.state.orders[0].expiresAt = new Date(Date.now() - 60 * 60000);
  const r = await f.buy({ clientRequestId: "request_test_000002" });
  assert.equal(r.code, 201);
});
test("invalid quantities, emails and phones do not create purchases", async () => {
  for (const patch of [
    { quantity: 1.5 },
    { quantity: 0 },
    { quantity: "bad" },
    { buyerEmail: "bad" },
    { buyerPhone: "1" },
  ]) {
    const f = fixture(),
      r = await f.buy(patch);
    assert.equal(r.code, 400);
    assert.equal(f.state.orders.length, 0);
  }
});
test("closed or finished events refuse checkout creation", async () => {
  for (const patch of [
    { salesCloseAt: new Date("2020-01-01") },
    { startsAt: new Date("2020-01-01") },
  ]) {
    const f = fixture();
    Object.assign(f.state.events[0], patch);
    const r = await f.buy();
    assert.equal(r.code, 409);
  }
});
test("quote returns exact price and refuses unavailable places", async () => {
  const f = fixture(1),
    r = response();
  await f.api.quote(f.request(), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.amountToPayFcfa, 10100);
  await f.buy();
  const sold = response();
  await f.api.quote(f.request(), sold);
  assert.equal(sold.code, 409);
});
test("public lookup and sync require the possession token", async () => {
  const f = fixture(),
    created = await f.buy();
  for (const action of [
    "getTicketOrder",
    "syncTicketWavePaymentStatus",
    "initiateTicketWavePayment",
  ]) {
    const r = response();
    await f.api[action](
      { ...f.request(), params: { orderNumber: created.body.orderNumber } },
      r,
    );
    assert.equal(r.code, 404);
  }
});
test("checkout cannot be relaunched after its payment deadline", async () => {
  const f = fixture();
  const r = await f.buy();
  f.state.orders[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(
    () =>
      f.wave.initiateTicketWavePayment({
        req: f.request(),
        orderNumber: r.body.orderNumber,
      }),
    (e) => e.statusCode === 409,
  );
  assert.equal(f.state.providerCreates, 1);
});
test("payment confirmation issues tickets once despite repeated sync", async () => {
  const f = fixture(),
    r = await f.buy();
  f.state.providerStatus = {
    payment_status: "succeeded",
    checkout_status: "complete",
  };
  await Promise.all([
    f.wave.syncTicketWavePaymentStatus({
      req: f.request(),
      orderNumber: r.body.orderNumber,
    }),
    f.wave.syncTicketWavePaymentStatus({
      req: f.request(),
      orderNumber: r.body.orderNumber,
    }),
  ]);
  assert.equal(f.state.tickets.length, 1);
  assert.equal(f.state.orders[0].status, "PAID");
  assert.equal(f.state.emails, 1);
});
test("a delayed provider cancellation cannot regress a paid purchase", async () => {
  const f = fixture(),
    r = await f.buy();
  f.state.providerStatus = {
    payment_status: "succeeded",
    checkout_status: "complete",
  };
  await f.wave.syncTicketWavePaymentStatus({
    req: f.request(),
    orderNumber: r.body.orderNumber,
  });
  f.state.providerStatus = { payment_status: "cancelled" };
  await f.wave.syncTicketWavePaymentStatus({
    req: f.request(),
    orderNumber: r.body.orderNumber,
  });
  assert.equal(f.state.orders[0].status, "PAID");
  assert.equal(f.state.tickets[0].status, "ACTIVE");
});
test("late payment records success but cannot issue over-capacity tickets", async () => {
  const f = fixture(1),
    a = await f.buy();
  f.state.orders[0].expiresAt = new Date(Date.now() - 60 * 60000);
  await f.buy({ clientRequestId: "request_test_000002" });
  f.state.providerStatus = {
    payment_status: "succeeded",
    checkout_status: "complete",
  };
  await f.wave.syncTicketWavePaymentStatus({
    req: f.request(),
    orderNumber: a.body.orderNumber,
  });
  assert.equal(f.state.orders[0].status, "PAID");
  assert.equal(f.state.orders[0].ticketIssueCode, "CAPACITY_CONFLICT");
  assert.equal(f.state.tickets.length, 0);
});
test("expiration cannot overwrite a confirmed payment", async () => {
  const f = fixture();
  const r = await f.buy();
  f.state.providerStatus = {
    payment_status: "succeeded",
    checkout_status: "complete",
  };
  await f.wave.syncTicketWavePaymentStatus({
    req: f.request(),
    orderNumber: r.body.orderNumber,
  });
  await f.wave.expireTicketOrder(f.state.orders[0].id);
  assert.equal(f.state.orders[0].status, "PAID");
  assert.equal(f.state.tickets[0].status, "ACTIVE");
});

test("repeating a free purchase does not duplicate tickets or confirmation email", async () => {
  const f = fixture();
  f.state.types[0].priceFcfa = 0;
  await f.buy();
  await f.buy();
  assert.equal(f.state.tickets.length, 1);
  assert.equal(f.state.emails, 1);
});

test('a paid purchase without issued tickets can be repaired without another checkout',async()=>{const f=fixture(1),r=await f.buy();f.state.orders[0].status='PAID';f.state.orders[0].paymentStatus='SUCCEEDED';const result=await f.wave.syncTicketWavePaymentStatus({req:f.request(),orderNumber:r.body.orderNumber});assert.equal(result.order.tickets.length,1);assert.equal(f.state.providerCreates,1);assert.equal(f.state.emails,1);});
test('paid purchases awaiting ticket issuance still consume their places',async()=>{const f=fixture(1);await f.buy();f.state.orders[0].status='PAID';f.state.orders[0].ticketIssueCode=null;const r=await f.buy({clientRequestId:'request_test_000002'});assert.equal(r.code,409);});
