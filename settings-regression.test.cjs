const test = require("node:test");
const assert = require("node:assert/strict");
const {
  persistCountrySettings,
} = require("./src/services/country-settings-save");
const {
  validateCountrySettings,
} = require("./src/services/country-settings-validation");
const old = new Date("2026-10-06T10:00:00Z");
function db() {
  let row = {
    countryId: "civ",
    updatedAt: old,
    supportPhone: "old",
    enableCash: true,
  };
  const logs = [];
  const database = {
    countrySettings: {
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }) => {
        if (row.updatedAt.getTime() !== where.updatedAt.getTime())
          return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      },
      create: async ({ data }) => {
        row = { ...data, updatedAt: new Date() };
        return row;
      },
    },
    countrySettingsChange: {
      create: async ({ data }) => {
        logs.push(data);
        return data;
      },
    },
  };
  database.$transaction = async (fn, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    return fn(database);
  };
  return { database, logs, row: () => row };
}
const options = {
  where: { countryId: "civ" },
  create: { countryId: "civ" },
  select: { supportPhone: true, updatedAt: true },
};
const req = {
  body: { expectedUpdatedAt: old.toISOString() },
  user: { id: "admin", email: "admin@example.test" },
};
test("save updates only changed fields and records author and exact before/after", async () => {
  const { database, logs, row } = db();
  const result = await persistCountrySettings(
    database,
    req,
    { ...row() },
    options,
    { supportPhone: "new" },
  );
  assert.equal(result.enableCash, true);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].changes, {
    supportPhone: { before: "old", after: "new" },
  });
  assert.equal(logs[0].actorId, "admin");
  assert.equal(logs[0].countryId, "civ");
  assert.ok(result.updatedAt > old);
});
test("stale expected version is refused before writes", async () => {
  const { database, logs, row } = db();
  await assert.rejects(
    () =>
      persistCountrySettings(
        database,
        { ...req, body: { expectedUpdatedAt: "2020-01-01" } },
        row(),
        options,
        { supportPhone: "new" },
      ),
    (error) => error.statusCode === 409,
  );
  assert.equal(logs.length, 0);
  assert.equal(row().supportPhone, "old");
});
test("concurrent saves of the same version cannot overwrite each other", async () => {
  const { database, logs, row } = db();
  const snapshot = row();
  const results = await Promise.allSettled([
    persistCountrySettings(database, req, snapshot, options, {
      supportPhone: "first",
    }),
    persistCountrySettings(database, req, snapshot, options, {
      supportPhone: "second",
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.statusCode,
    409,
  );
  assert.equal(logs.length, 1);
});
test("new country settings retain supplied notification templates", async () => {
  const { database, logs } = db();
  const templates = { sms: { INVOICE: "Bonjour" } };
  const result = await persistCountrySettings(
    database,
    { ...req, body: { expectedUpdatedAt: null } },
    null,
    options,
    { notificationTemplates: templates },
  );
  assert.deepEqual(result.notificationTemplates, templates);
  assert.equal(logs.length, 1);
});
test("creating settings cannot replace a version that appeared since load", async () => {
  const { database, row } = db();
  await assert.rejects(
    () =>
      persistCountrySettings(
        database,
        { ...req, body: { expectedUpdatedAt: null } },
        row(),
        options,
        { supportPhone: "new" },
      ),
    (error) => error.statusCode === 409,
  );
});
test("no-op save leaves the version and audit unchanged", async () => {
  const { database, logs, row } = db();
  await persistCountrySettings(database, req, row(), options, {
    supportPhone: "old",
  });
  assert.equal(logs.length, 0);
  assert.equal(row().updatedAt.getTime(), old.getTime());
});
test("transaction conflict and unique creation races return 409", async () => {
  for (const code of ["P2002", "P2034"]) {
    const { database, row } = db();
    database.$transaction = async () => {
      throw Object.assign(new Error("race"), { code });
    };
    await assert.rejects(
      () =>
        persistCountrySettings(database, req, row(), options, {
          supportPhone: "new",
        }),
      (error) => error.statusCode === 409,
    );
  }
});
test("invalid version is refused with a validation error", async () => {
  const { database, row } = db();
  await assert.rejects(
    () =>
      persistCountrySettings(
        database,
        { ...req, body: { expectedUpdatedAt: "bad" } },
        row(),
        options,
        {},
      ),
    (error) => error.statusCode === 400,
  );
});
test("settings reject fractional or malformed integers and string booleans", () => {
  for (const value of [1.5, "10abc", "10", NaN, -1, 2147483648])
    assert.ok(validateCountrySettings({ minCartFcfa: value }).minCartFcfa);
  assert.ok(validateCountrySettings({ enableCash: "false" }).enableCash);
});
test("reminder must precede cancellation, including partial updates", () => {
  assert.ok(
    validateCountrySettings(
      { preinvoicedAutoReminderAfterMinutes: 120 },
      { preinvoicedAutoCancelAfterMinutes: 120 },
    ).preinvoicedAutoReminderAfterMinutes,
  );
});
test("payment activation needs complete account information", () => {
  assert.ok(validateCountrySettings({ enableBankTransfer: true }).bankName);
  assert.ok(
    validateCountrySettings({ enableBankTransfer: true }).bankAccountNumber,
  );
  assert.ok(
    validateCountrySettings({ enableEcobankPay: true }).ecobankPayQrImageUrl,
  );
  assert.ok(validateCountrySettings({ enablePiSpi: true }).piSpiAlias);
});
test("unrelated partial updates remain possible for legacy incomplete accounts", () => {
  assert.deepEqual(
    validateCountrySettings(
      { supportPhone: "+2250102030405" },
      { enableBankTransfer: true },
    ),
    {},
  );
});
test("at least one payment and fulfillment mode stays enabled", () => {
  assert.ok(
    validateCountrySettings(
      { enableCash: false },
      {
        enableWave: false,
        enableOrangeMoney: false,
        enableBankTransfer: false,
        enableEcobankPay: false,
        enablePiSpi: false,
      },
    ).enableCash,
  );
  assert.ok(
    validateCountrySettings({ enablePickup: false }, { enableDelivery: false })
      .enablePickup,
  );
});
test("theme URL and color validation rejects executable or malformed values", () => {
  assert.ok(
    validateCountrySettings({ themePrimaryColor: "red" }).themePrimaryColor,
  );
  assert.ok(
    validateCountrySettings({ themeLogoPath: "javascript:alert(1)" })
      .themeLogoPath,
  );
  assert.deepEqual(
    validateCountrySettings({
      themeLogoPath: "/logo.png",
      themePrimaryColor: "#FFC600",
    }),
    {},
  );
});
test("notification templates validate shape and detect mistyped variables", () => {
  assert.ok(
    validateCountrySettings({
      notificationTemplates: { sms: { INVOICE: "Bonjour {{custmerName}}" } },
    }).notificationTemplates,
  );
  assert.deepEqual(
    validateCountrySettings({
      notificationTemplates: { sms: { INVOICE: "Bonjour {{customerName}}" } },
    }),
    {},
  );
  assert.ok(
    validateCountrySettings({
      notificationTemplates: { email: { INVOICE: "plain text" } },
    }).notificationTemplates,
  );
});
