const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const {
  saveManagedUser,
  assertSuperAdminSurvives,
} = require("./src/services/admin-user-management.service");
const { resolveAdminSession } = require("./src/services/admin-session.service");
const { completeAdminLogin } = require("./src/services/admin-login.service");
const permissions = require("./src/auth/permissions"),
  security = require("./src/services/admin-security.service");
const stamp = new Date("2026-10-06T10:00:00Z");
function account(id, role = "ORDER_PREPARER", extra = {}) {
  return {
    id,
    email: id + "@example.test",
    fullName: id,
    role,
    actif: true,
    countryId: role === "SUPER_ADMIN" ? null : "civ",
    permissionAllow: [],
    permissionDeny: [],
    sessionVersion: 0,
    password: "hash",
    failedLoginCount: 0,
    lockedUntil: null,
    updatedAt: stamp,
    createdAt: stamp,
    ...extra,
  };
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) =>
    key === "OR"
      ? value.some((item) => matches(row, item))
      : value instanceof Date
        ? row[key]?.getTime() === value.getTime()
        : value && typeof value === "object"
          ? "not" in value
            ? row[key] !== value.not
            : "contains" in value
              ? String(row[key] || "")
                  .toLowerCase()
                  .includes(value.contains.toLowerCase())
              : true
          : row[key] === value,
  );
}
function memory(initial) {
  let rows = structuredClone(initial),
    logs = [],
    queue = Promise.resolve(),
    auditFailure = false;
  const countries = [
    { id: "civ", code: "CIV", name: "Côte d’Ivoire" },
    { id: "ben", code: "BEN", name: "Bénin" },
  ];
  const decorate = (row) =>
    row
      ? {
          ...structuredClone(row),
          country: countries.find((item) => item.id === row.countryId) || null,
        }
      : null;
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data))
      row[key] =
        value && typeof value === "object" && "increment" in value
          ? (row[key] || 0) + value.increment
          : value;
    row.updatedAt =
      data.updatedAt ||
      new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
    return decorate(row);
  };
  const db = {
    adminUser: {
      findUnique: async ({ where }) =>
        decorate(rows.find((row) => matches(row, where))),
      findMany: async ({ where = {}, skip = 0, take = 100 }) =>
        rows
          .filter((row) => matches(row, where))
          .slice(skip, skip + take)
          .map(decorate),
      count: async ({ where = {} }) =>
        rows.filter((row) => matches(row, where)).length,
      updateMany: async ({ where, data }) => {
        const found = rows.filter((row) => matches(row, where));
        found.forEach((row) => apply(row, data));
        return { count: found.length };
      },
      update: async ({ where, data }) =>
        apply(
          rows.find((row) => matches(row, where)),
          data,
        ),
      create: async ({ data }) => {
        if (rows.some((row) => row.email === data.email))
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        const row = account("new-" + rows.length, data.role, data);
        rows.push(row);
        return decorate(row);
      },
    },
    country: {
      findUnique: async ({ where }) =>
        countries.find((row) => matches(row, where)) || null,
    },
    adminUserAuditLog: {
      create: async ({ data }) => {
        if (auditFailure) throw new Error("audit failed");
        const row = {
          id: "log-" + logs.length,
          createdAt: new Date(),
          ...data,
        };
        logs.push(row);
        return row;
      },
      findMany: async ({ where }) => logs.filter((row) => matches(row, where)),
    },
  };
  db.$transaction = (fn, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    const run = queue.then(async () => {
      const beforeRows = structuredClone(rows),
        beforeLogs = structuredClone(logs);
      try {
        return await fn(db);
      } catch (error) {
        rows = beforeRows;
        logs = beforeLogs;
        throw error;
      }
    });
    queue = run.catch(() => {});
    return run;
  };
  return {
    db,
    rows: () => rows,
    logs: () => logs,
    failAudit: () => {
      auditFailure = true;
    },
    countries,
  };
}
function request(actor = "root", extra = {}) {
  return {
    user: {
      id: actor,
      role: "SUPER_ADMIN",
      countryId: null,
      email: actor + "@example.test",
      tokenSessionVersion: 0,
    },
    country: { id: "civ", code: "CIV" },
    params: { id: "target" },
    body: {},
    query: {},
    ...extra,
  };
}
function res() {
  return {
    code: 200,
    status(value) {
      this.code = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
function controller(db) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "src/controllers/users.controller.js"),
      "utf8",
    ),
    {
      module,
      Date,
      console: { error() {} },
      require: (name) =>
        name === "../prisma"
          ? db
          : name === "bcryptjs"
            ? { ...require("bcryptjs"), hash: async (value) => "hash:" + value }
            : require(path.join(__dirname, "src/controllers", name)),
    },
  );
  return module.exports;
}
const options = (id, data) => ({
  id,
  data,
  expectedUpdatedAt: stamp.toISOString(),
});
test("all general updates reject self-deactivation and self-role changes", async () => {
  for (const data of [
    { actif: false },
    { role: "TECH_ADMIN", countryId: "civ" },
  ]) {
    const mem = memory([account("root", "SUPER_ADMIN")]);
    await assert.rejects(
      () => saveManagedUser(mem.db, request(), options("root", data)),
      (error) => error.statusCode === 400,
    );
    assert.equal(mem.rows()[0].actif, true);
    assert.equal(mem.logs().length, 0);
  }
});
test("actor must manage the current role as well as the proposed role", async () => {
  const mem = memory([
    account("ops", "OPERATIONS_DIRECTOR"),
    account("tech", "TECH_ADMIN"),
  ]);
  await assert.rejects(
    () =>
      saveManagedUser(
        mem.db,
        request("ops"),
        options("tech", { role: "ORDER_PREPARER" }),
      ),
    (error) => error.statusCode === 403,
  );
  assert.equal(mem.rows()[1].role, "TECH_ADMIN");
});
test("a manager cannot update another country even through a general update", async () => {
  const mem = memory([
    account("tech", "TECH_ADMIN"),
    account("target", "ORDER_PREPARER", { countryId: "ben" }),
  ]);
  await assert.rejects(
    () =>
      saveManagedUser(
        mem.db,
        request("tech"),
        options("target", { fullName: "Other" }),
      ),
    (error) => error.statusCode === 403,
  );
});
test("self removal of user-management permission is refused", async () => {
  const mem = memory([account("root", "SUPER_ADMIN")]);
  await assert.rejects(
    () =>
      saveManagedUser(
        mem.db,
        request(),
        options("root", { permissionDeny: ["USER_ADMIN"] }),
      ),
    (error) => error.statusCode === 400,
  );
});
test("the last usable Super Admin cannot be removed or stripped of management rights", async () => {
  const only = account("target", "SUPER_ADMIN"),
    mem = memory([only]);
  for (const data of [
    { actif: false },
    { role: "TECH_ADMIN" },
    { permissionDeny: ["USER_ADMIN"] },
  ])
    await assert.rejects(
      () => assertSuperAdminSurvives(mem.db, only, { ...only, ...data }),
      (error) => error.statusCode === 409,
    );
});
test("concurrent cross-deactivations preserve one active Super Admin", async () => {
  const mem = memory([
    account("one", "SUPER_ADMIN"),
    account("two", "SUPER_ADMIN"),
  ]);
  const result = await Promise.allSettled([
    saveManagedUser(mem.db, request("one"), options("two", { actif: false })),
    saveManagedUser(mem.db, request("two"), options("one", { actif: false })),
  ]);
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(
    mem.rows().filter((row) => row.role === "SUPER_ADMIN" && row.actif).length,
    1,
  );
});
test("all security changes revoke sessions, while name changes do not", async () => {
  for (const data of [
    { email: "new@example.test" },
    { role: "INVOICER" },
    { countryId: "ben" },
    { actif: false },
    { permissionDeny: ["PREORDER_READ"] },
    { password: "new-hash" },
  ]) {
    const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
    await saveManagedUser(mem.db, request(), options("target", data));
    assert.equal(mem.rows()[1].sessionVersion, 1);
  }
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  await saveManagedUser(
    mem.db,
    request(),
    options("target", { fullName: "Changed" }),
  );
  assert.equal(mem.rows()[1].sessionVersion, 0);
});
test("password resets never put passwords or hashes into audit logs", async () => {
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  await saveManagedUser(
    mem.db,
    request(),
    options("target", {
      password: "SECRET-HASH",
      passwordChangedAt: new Date(),
    }),
  );
  assert.equal(JSON.stringify(mem.logs()).includes("SECRET-HASH"), false);
  assert.equal(mem.logs()[0].meta.passwordChanged, true);
  assert.equal(mem.logs()[0].action, "ADMIN_USER_UPDATED_PASSWORD");
});
test("audit failure rolls back the account update and session version", async () => {
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  mem.failAudit();
  await assert.rejects(() =>
    saveManagedUser(
      mem.db,
      request(),
      options("target", { email: "changed@example.test" }),
    ),
  );
  assert.equal(mem.rows()[1].email, "target@example.test");
  assert.equal(mem.rows()[1].sessionVersion, 0);
});
test("stale user version refuses updates without losing stored data", async () => {
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  mem.rows()[1] = account("target");
  await assert.rejects(
    () =>
      saveManagedUser(mem.db, request(), {
        id: "target",
        data: { fullName: "old draft" },
        expectedUpdatedAt: "2020-01-01",
      }),
    (error) => error.statusCode === 409,
  );
  assert.equal(mem.logs().length, 0);
});
test("actor revoked during a pending operation cannot finish the mutation", async () => {
  const mem = memory([
    account("root", "SUPER_ADMIN", { sessionVersion: 1 }),
    account("target"),
  ]);
  await assert.rejects(
    () =>
      saveManagedUser(
        mem.db,
        request(),
        options("target", { fullName: "Changed" }),
      ),
    (error) => error.statusCode === 401,
  );
});
test("duplicate account creation returns 409 and does not write an audit", async () => {
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  await assert.rejects(
    () =>
      saveManagedUser(mem.db, request(), {
        data: account("new", "ORDER_PREPARER", {
          email: "target@example.test",
        }),
      }),
    (error) => error.statusCode === 409,
  );
  assert.equal(mem.logs().length, 0);
});
test("manual session revocation increments the version and records an event", async () => {
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  await saveManagedUser(mem.db, request(), {
    ...options("target", {}),
    forceRevoke: true,
    action: "ADMIN_USER_SESSIONS_REVOKED",
  });
  assert.equal(mem.rows()[1].sessionVersion, 1);
  assert.equal(mem.logs()[0].meta.sessionsRevoked, true);
});
test("disabled, deleted and revoked accounts cannot authenticate", async () => {
  for (const row of [
    account("target", "ORDER_PREPARER", { actif: false }),
    account("target", "ORDER_PREPARER", { sessionVersion: 1 }),
    null,
  ]) {
    const mem = memory(row ? [row] : []);
    await assert.rejects(
      () =>
        resolveAdminSession(mem.db, { id: "target", tokenSessionVersion: 0 }),
      (error) => error.statusCode === 401,
    );
  }
});
test("old tokens never retain their previous role or country", async () => {
  const mem = memory([account("target", "INVOICER", { countryId: "ben" })]);
  const user = await resolveAdminSession(mem.db, {
    id: "target",
    role: "SUPER_ADMIN",
    countryId: null,
    tokenSessionVersion: 0,
  });
  assert.equal(user.role, "INVOICER");
  assert.equal(user.countryId, "ben");
  assert.equal(user.permissions.includes("USER_ADMIN"), false);
});
test("legacy tokens remain accepted at version zero but fail after a password change", async () => {
  const mem = memory([
    account("target", "ORDER_PREPARER", { passwordChangedAt: stamp }),
  ]);
  await resolveAdminSession(mem.db, {
    id: "target",
    tokenIssuedAt: Math.floor(stamp.getTime() / 1000),
  });
  await assert.rejects(
    () => resolveAdminSession(mem.db, { id: "target", tokenIssuedAt: 1 }),
    (error) => error.statusCode === 401,
  );
});
test("reactivating an account does not revive its previous tokens", async () => {
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  const off = await saveManagedUser(
    mem.db,
    request(),
    options("target", { actif: false }),
  );
  await saveManagedUser(mem.db, request(), {
    id: "target",
    data: { actif: true },
    expectedUpdatedAt: off.updatedAt.toISOString(),
  });
  await assert.rejects(
    () => resolveAdminSession(mem.db, { id: "target", tokenSessionVersion: 0 }),
    (error) => error.statusCode === 401,
  );
});
test("login cannot issue a token after credentials or status changed during password comparison", async () => {
  for (const data of [
    { actif: false },
    { password: "changed" },
    { sessionVersion: 1 },
  ]) {
    const original = account("target"),
      mem = memory([{ ...original, ...data }]);
    const result = await completeAdminLogin(mem.db, original, true);
    assert.equal(result.status, "INVALID");
  }
});
test("concurrent failed logins trigger the lock without losing increments", async () => {
  const original = account("target"),
    mem = memory([original]);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      completeAdminLogin(mem.db, original, false),
    ),
  );
  assert.equal(mem.rows()[0].failedLoginCount, 5);
  assert.ok(mem.rows()[0].lockedUntil > new Date());
  assert.equal(
    (await completeAdminLogin(mem.db, original, true)).status,
    "LOCKED",
  );
});
test("successful login and audit are one atomic operation", async () => {
  const original = account("target"),
    mem = memory([original]);
  mem.failAudit();
  await assert.rejects(() => completeAdminLogin(mem.db, original, true));
  assert.equal(mem.rows()[0].lastLoginAt, undefined);
});
test("general update endpoint rejects self deactivation through the form", async () => {
  const mem = memory([account("root", "SUPER_ADMIN")]),
    response = res();
  await controller(mem.db).updateUser(
    request("root", { params: { id: "root" }, body: { actif: false } }),
    response,
  );
  assert.equal(response.code, 400);
  assert.equal(mem.rows()[0].actif, true);
});
test("general update endpoint cannot downgrade an unmanageable existing role", async () => {
  const mem = memory([
      account("ops", "OPERATIONS_DIRECTOR"),
      account("target", "TECH_ADMIN"),
    ]),
    response = res();
  await controller(mem.db).updateUser(
    request("ops", {
      user: { id: "ops", role: "OPERATIONS_DIRECTOR", countryId: "civ" },
      body: { role: "ORDER_PREPARER" },
    }),
    response,
  );
  assert.equal(response.code, 403);
});
test("create endpoint validates email, status type and password limit", async () => {
  for (const body of [
    { email: "invalid" },
    { actif: "false" },
    { password: "Abc123!".repeat(20) },
  ]) {
    const mem = memory([account("root", "SUPER_ADMIN")]),
      response = res();
    await controller(mem.db).createUser(
      request("root", {
        body: {
          fullName: "Name",
          email: "new@example.test",
          password: "ValidPassword123!",
          role: "ORDER_PREPARER",
          countryCode: "CIV",
          ...body,
        },
      }),
      response,
    );
    assert.equal(response.code, 400);
    assert.equal(mem.rows().length, 1);
    assert.ok(response.body.errors);
  }
});
test("non-super managers cannot submit custom permission overrides", async () => {
  const mem = memory([account("ops", "OPERATIONS_DIRECTOR")]),
    response = res();
  await controller(mem.db).createUser(
    request("ops", {
      user: { id: "ops", role: "OPERATIONS_DIRECTOR", countryId: "civ" },
      body: {
        fullName: "Name",
        email: "new@example.test",
        password: "ValidPassword123!",
        role: "ORDER_PREPARER",
        countryCode: "CIV",
        permissionAllow: ["USER_ADMIN"],
      },
    }),
    response,
  );
  assert.equal(response.code, 403);
});
test("server pagination and country scope include metadata and restricted row actions", async () => {
  const mem = memory([
      account("ops", "OPERATIONS_DIRECTOR"),
      ...Array.from({ length: 22 }, (_, index) => account("person-" + index)),
      account("tech", "TECH_ADMIN"),
    ]),
    response = res();
  await controller(mem.db).listUsers(
    request("ops", {
      user: { id: "ops", role: "OPERATIONS_DIRECTOR", countryId: "civ" },
      query: { page: "2", pageSize: "20" },
    }),
    response,
  );
  assert.equal(response.code, 200);
  assert.equal(response.body.page, 2);
  assert.equal(response.body.totalCount, 24);
  assert.equal(response.body.data.length, 4);
  const tech = response.body.data.find((row) => row.role === "TECH_ADMIN");
  assert.equal(tech.actions.canEdit, false);
  assert.equal(JSON.stringify(response.body).includes('"password"'), false);
});
test("invalid role filter yields 400 rather than an ORM error", async () => {
  const mem = memory([account("root", "SUPER_ADMIN")]),
    response = res();
  await controller(mem.db).listUsers(
    request("root", { query: { role: "INVALID" } }),
    response,
  );
  assert.equal(response.code, 400);
});
test("history refuses another country and never returns raw sensitive audit metadata", async () => {
  const mem = memory([account("root", "SUPER_ADMIN"), account("target")]);
  await mem.db.adminUserAuditLog.create({
    data: {
      targetAdminId: "target",
      meta: {
        password: "SECRET",
        changes: {
          password: { before: "HASH", after: "HASH" },
          email: { before: "old", after: "new" },
        },
      },
    },
  });
  const response = res();
  await controller(mem.db).getUserHistory(request(), response);
  assert.equal(response.code, 200);
  assert.equal(JSON.stringify(response.body).includes("SECRET"), false);
  assert.equal(JSON.stringify(response.body).includes("HASH"), false);
});

function middleware(db, payload, env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "src/middlewares/rbac.js"), "utf8"),
    {
      module,
      process: { env: { JWT_SECRET: "test", NODE_ENV: "production", ...env } },
      require: (name) =>
        name === "../prisma"
          ? db
          : name === "jsonwebtoken"
            ? { verify: () => payload }
            : name === "../auth/permissions"
              ? permissions
              : name === "../services/admin-session.service"
                ? { resolveAdminSession }
                : null,
    },
  );
  return module.exports;
}
test("authentication refreshes role before enforcing country scope", async () => {
  const mem = memory([account("target", "INVOICER", { countryId: "ben" })]),
    api = middleware(mem.db, {
      sub: "target",
      role: "SUPER_ADMIN",
      countryId: null,
      sessionVersion: 0,
    });
  const req = {
      header: (key) => (key === "Authorization" ? "Bearer token" : undefined),
      country: { id: "civ" },
      query: {},
      path: "/users",
    },
    response = res();
  let next = 0;
  await api.requireAuth(req, response, () => {
    next++;
  });
  assert.equal(next, 1);
  assert.equal(req.user.role, "INVOICER");
  api.requireCountryScope(req, response, () => {
    next++;
  });
  assert.equal(response.code, 403);
  assert.equal(next, 1);
});
test("authentication blocks a revoked token before any permission check", async () => {
  const mem = memory([account("target", "SUPER_ADMIN", { sessionVersion: 1 })]),
    api = middleware(mem.db, {
      sub: "target",
      role: "SUPER_ADMIN",
      sessionVersion: 0,
    }),
    response = res();
  let reached = false;
  await api.requireAuth(
    { header: () => "Bearer token", query: {}, path: "/users" },
    response,
    () => {
      reached = true;
    },
  );
  assert.equal(response.code, 401);
  assert.equal(reached, false);
});
test("legacy header authentication is never enabled in production", async () => {
  const mem = memory([]),
    api = middleware(mem.db, null, { ALLOW_HEADER_AUTH: "true" }),
    response = res();
  await api.requireAuth(
    {
      header: (key) => (key === "X-Admin-Role" ? "SUPER_ADMIN" : undefined),
      query: {},
      path: "/users",
    },
    response,
    () => assert.fail("header login accepted"),
  );
  assert.equal(response.code, 401);
});
test("history cannot be read across country boundaries", async () => {
  const mem = memory([
      account("ops", "OPERATIONS_DIRECTOR"),
      account("target", "ORDER_PREPARER", { countryId: "ben" }),
    ]),
    response = res();
  await controller(mem.db).getUserHistory(
    request("ops", {
      user: { id: "ops", role: "OPERATIONS_DIRECTOR", countryId: "civ" },
    }),
    response,
  );
  assert.equal(response.code, 403);
});
test("successful login issues a token with the current session version", async () => {
  const mem = memory([account("target", "INVOICER", { sessionVersion: 4 })]);
  const module = { exports: {} };
  let claims;
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "src/controllers/adminAuth.controller.js"),
      "utf8",
    ),
    {
      module,
      process: { env: { JWT_SECRET: "test" } },
      Date,
      console: { error() {} },
      require: (name) =>
        name === "../prisma"
          ? mem.db
          : name === "jsonwebtoken"
            ? {
                sign: (payload) => {
                  claims = payload;
                  return "signed";
                },
              }
            : name === "bcryptjs"
              ? { compare: async () => true }
              : name === "../auth/permissions"
                ? permissions
                : name === "../services/admin-security.service"
                  ? security
                  : name === "../services/admin-login.service"
                    ? { completeAdminLogin }
                    : null,
    },
  );
  const response = res();
  await module.exports.adminLogin(
    { body: { email: "target@example.test", password: "Password123!" } },
    response,
  );
  assert.equal(response.code, 200);
  assert.equal(claims.sessionVersion, 4);
  assert.equal(response.body.token, "signed");
});

function realtimeFixture(rows) {
  let tick;
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "src/services/realtime-events.service.js"),
      "utf8",
    ),
    {
      module,
      Date,
      console: { error() {} },
      setInterval: (callback) => {
        tick = callback;
        return { unref() {} };
      },
      require: (name) =>
        name === "../prisma"
          ? { adminUser: { findMany: async () => rows } }
          : permissions,
    },
  );
  return {
    api: module.exports,
    tick: async () => {
      tick();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
function stream(id, version = 0) {
  const request = {
    user: { id, tokenSessionVersion: version },
    country: { id: "civ" },
    on() {},
  };
  const response = {
    closed: false,
    status() {},
    setHeader() {},
    write() {},
    on() {},
    end() {
      this.closed = true;
    },
  };
  return { req: request, res: response };
}
test("explicit revocation closes only the affected live event stream", () => {
  const fixture = realtimeFixture([]),
    one = stream("one"),
    two = stream("two");
  fixture.api.subscribeRealtimeEvents(one);
  fixture.api.subscribeRealtimeEvents(two);
  fixture.api.disconnectRealtimeUser("one");
  assert.equal(one.res.closed, true);
  assert.equal(two.res.closed, false);
  assert.equal(fixture.api.getRealtimeHealth().activeListeners, 1);
});
test("live event streams close when a remote session version changes", async () => {
  const fixture = realtimeFixture([
      account("one", "ORDER_PREPARER", { sessionVersion: 1 }),
    ]),
    one = stream("one");
  fixture.api.subscribeRealtimeEvents(one);
  await fixture.tick();
  assert.equal(one.res.closed, true);
});
