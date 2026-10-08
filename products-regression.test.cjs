const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const domain = require("./src/helpers/product-domain"),
  query = require("./src/helpers/order-query");
function response() {
  return {
    code: 200,
    headers: {},
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
}
function api(db, file = "products.controller.js") {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "src/controllers/admin", file),
      "utf8",
    ),
    {
      module,
      console: { error() {} },
      process: { env: {} },
      Buffer,
      Date,
      require(id) {
        if (id === "../../prisma") return db;
        if (id.endsWith("/product-domain")) return domain;
        if (id.endsWith("/order-query")) return query;
        if (id.endsWith("/countryScope"))
          return require("./src/helpers/countryScope");
        if (id === "cloudinary") return { v2: { config() {} } };
        if (id === "multer")
          return Object.assign(() => ({}), { memoryStorage() {} });
        if (id === "node:crypto") return require(id);
        throw Error(id);
      },
    },
  );
  return module.exports;
}
function req(body = {}, query = {}) {
  return {
    countryId: "CIV",
    user: { id: "actor", fullName: "Test", role: "SUPER_ADMIN" },
    params: { id: "p", packagingId: "pack" },
    body,
    query,
  };
}
const matches = (where, row) =>
  Object.entries(where).every(
    ([key, value]) =>
      value === undefined ||
      (value instanceof Date
        ? new Date(row[key]).getTime() === value.getTime()
        : value && typeof value === "object"
          ? "in" in value
            ? value.in.includes(row[key])
            : true
          : row[key] === value),
  );
function fixture() {
  let state = {
    p: {
      id: "p",
      sku: "SKU",
      nom: "Produit",
      cc: "0.123",
      poidsKg: "0.300",
      prixBaseFcfa: 100,
      stockQty: 0,
      actif: true,
      category: "NUTRITION",
      imageUrl: "https://example.test/image.png",
      details: "Description",
      updatedAt: new Date("2026-01-01"),
    },
    a: {
      id: "a",
      countryId: "CIV",
      productId: "p",
      stockQty: 7,
      prixBaseFcfa: 100,
      actif: true,
      maxQtyPerOrder: 2,
      updatedAt: new Date("2026-01-01"),
    },
    grades: [
      { countryId: "CIV", productId: "p", grade: "MANAGER", prixFcfa: 80 },
    ],
    audit: [],
    movements: [],
    pack: {
      id: "pack",
      productId: "p",
      label: "Carton",
      unitsPerPackage: 12,
      prixFcfa: null,
      actif: true,
    },
  };
  const readProduct = () => ({
    ...structuredClone(state.p),
    countryProducts: [structuredClone(state.a)],
    gradePrices: structuredClone(state.grades),
    packagings: [structuredClone(state.pack)],
  });
  const tx = {
    product: {
      findUnique: async ({ where }) =>
        matches(where, state.p) ? readProduct() : null,
      findFirst: async ({ where }) =>
        where.countryProducts?.some.countryId === "CIV" ? readProduct() : null,
      findMany: async () => [readProduct()],
      updateMany: async ({ where, data }) => {
        if (!matches(where, state.p)) return { count: 0 };
        Object.assign(state.p, data);
        return { count: 1 };
      },
      update: async ({ data }) => {
        Object.assign(state.p, data);
        return readProduct();
      },
      create: async ({ data }) => {
        state.p = { ...data, id: "new" };
        return readProduct();
      },
    },
    countryProduct: {
      findUnique: async () => ({
        ...structuredClone(state.a),
        product: readProduct(),
      }),
      findMany: async () => [
        { ...structuredClone(state.a), product: readProduct() },
      ],
      count: async () => 85,
      updateMany: async ({ where, data }) => {
        if (!matches(where, state.a)) return { count: 0 };
        Object.assign(state.a, data);
        return { count: 1 };
      },
      update: async ({ data }) => {
        Object.assign(state.a, data);
        return structuredClone(state.a);
      },
      create: async ({ data }) => {
        state.a = { ...data, id: "new-a", updatedAt: new Date() };
        return state.a;
      },
      upsert: async ({ update }) => {
        Object.assign(state.a, update);
        return state.a;
      },
    },
    productGradePrice: {
      deleteMany: async ({ where }) => {
        state.grades = state.grades.filter((row) => !matches(where, row));
        return { count: 1 };
      },
      upsert: async ({ create }) => {
        state.grades = state.grades
          .filter((row) => row.grade !== create.grade)
          .concat(create);
      },
    },
    productAuditLog: {
      create: async ({ data }) => {
        state.audit.push(data);
        return data;
      },
      findMany: async () => state.audit,
      count: async () => state.audit.length,
    },
    stockMovement: {
      create: async ({ data }) => {
        state.movements.push(data);
        return data;
      },
    },
    productPackaging: {
      findFirst: async () => state.pack,
      findMany: async () => [state.pack],
      update: async ({ data }) => {
        Object.assign(state.pack, data);
        return state.pack;
      },
      create: async ({ data }) => {
        state.pack = { ...data, id: "new-pack" };
        return state.pack;
      },
    },
    country: {
      findUnique: async () => ({ id: "CIV", code: "CIV" }),
      findMany: async () => [{ id: "BFA", code: "BFA", name: "Burkina Faso" }],
    },
  };
  let serial = Promise.resolve();
  const db = {
    ...tx,
    $transaction(fn) {
      const work = serial.then(async () => {
        const before = structuredClone(state);
        try {
          return await fn(tx);
        } catch (e) {
          state = before;
          throw e;
        }
      });
      serial = work.catch(() => {});
      return work;
    },
  };
  return {
    db,
    get state() {
      return state;
    },
    api: api(db),
    readProduct,
  };
}
test("a metadata edit preserves stock, untouched price, activation and limits", async () => {
  const f = fixture(),
    r = response();
  await f.api.updateProduct(req({ nom: "Nouveau nom" }), r);
  assert.equal(r.code, 200);
  assert.equal(f.state.a.stockQty, 7);
  assert.equal(f.state.a.prixBaseFcfa, 100);
  assert.equal(f.state.a.maxQtyPerOrder, 2);
  assert.equal(f.state.audit.length, 1);
});
test("product update refuses direct stock overwrite", async () => {
  const f = fixture(),
    r = response();
  await f.api.updateProduct(req({ nom: "Nouveau", stockQty: 10 }), r);
  assert.equal(r.code, 400);
  assert.equal(f.state.a.stockQty, 7);
  assert.equal(f.state.p.nom, "Produit");
});
test("explicit blank grade removes the stored price without changing other fields", async () => {
  const f = fixture(),
    r = response();
  await f.api.updateProduct(req({ gradePrices: { MANAGER: "" } }), r);
  assert.equal(r.code, 200);
  assert.equal(f.state.grades.length, 0);
  assert.equal(r.body.gradePrices.MANAGER, "");
});
test("grade price zero remains valid", async () => {
  const f = fixture(),
    r = response();
  await f.api.updateProduct(req({ gradePrices: { MANAGER: 0 } }), r);
  assert.equal(r.code, 200);
  assert.equal(f.state.grades[0].prixFcfa, 0);
});
test("an obsolete country or global version rejects the entire change", async () => {
  for (const key of ["expectedUpdatedAt", "expectedCountryUpdatedAt"]) {
    const f = fixture(),
      r = response();
    await f.api.updateProduct(req({ nom: "Nouveau", [key]: "2025-01-01" }), r);
    assert.equal(r.code, 409);
    assert.equal(f.state.p.nom, "Produit");
    assert.equal(f.state.audit.length, 0);
  }
});
test("two concurrent edits with the same version have only one winner", async () => {
  const f = fixture(),
    responses = [response(), response()];
  await Promise.all(
    responses.map((r, i) =>
      f.api.updateProduct(
        req({
          nom: "Nom " + i,
          expectedUpdatedAt: "2026-01-01",
          expectedCountryUpdatedAt: "2026-01-01",
        }),
        r,
      ),
    ),
  );
  assert.deepEqual(responses.map((r) => r.code).sort(), [200, 409]);
  assert.equal(f.state.audit.length, 1);
});
test("a SKU collision on create leaves shared fields and stock unchanged", async () => {
  const f = fixture(),
    r = response();
  await f.api.createProduct(
    req({ sku: "SKU", nom: "Autre", cc: "0", poidsKg: "0", prixBaseFcfa: 1 }),
    r,
  );
  assert.equal(r.code, 409);
  assert.equal(f.state.p.nom, "Produit");
  assert.equal(f.state.a.stockQty, 7);
});
test("invalid values are refused consistently at the backend boundary", async () => {
  for (const body of [
    { cc: -1 },
    { poidsKg: -2 },
    { prixBaseFcfa: 1.5 },
    { actif: "non" },
    { category: "INCORRECT" },
    { sku: " " },
    { maxQtyPerOrder: 0 },
    { gradePrices: { MANAGER: -1 } },
    { details: 3 },
    { prixBaseFcfa: null },
    { cc: "NaN" },
  ]) {
    const f = fixture(),
      r = response();
    await f.api.updateProduct(req(body), r);
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.equal(f.state.audit.length, 0);
  }
});
test("text false is decoded as false rather than truthy", async () => {
  const f = fixture(),
    r = response();
  await f.api.updateProduct(req({ actif: "false" }), r);
  assert.equal(r.code, 200);
  assert.equal(f.state.a.actif, false);
});
test("deactivation retains availability, grade prices and stock", async () => {
  const f = fixture(),
    r = response();
  await f.api.deleteProduct(req(), r);
  assert.equal(r.code, 200);
  assert.equal(f.state.a.actif, false);
  assert.equal(f.state.a.stockQty, 7);
  assert.equal(f.state.grades.length, 1);
  assert.equal(f.state.audit[0].action, "DEACTIVATE");
});
test("cross-country metadata updates do not write a foreign product", async () => {
  const f = fixture();
  f.db.countryProduct.updateMany = async () => ({ count: 0 });
  const r = response();
  await f.api.updateProduct(
    { ...req({ nom: "Nouveau" }), countryId: "BFA" },
    r,
  );
  assert.equal(r.code, 409);
  assert.equal(f.state.p.nom, "Produit");
});
test("import dry run does not write and identifies shared metadata changes", async () => {
  const f = fixture(),
    r = response();
  await f.api.importProductsCsv(
    req({ rows: [{ sku: "SKU", nom: "Nouveau" }], dryRun: true }),
    r,
  );
  assert.equal(r.code, 200);
  assert.equal(r.body.updated, 1);
  assert.deepEqual(Array.from(r.body.rows[0].sharedChanges), ["nom"]);
  assert.equal(f.state.audit.length, 0);
});
test("import preserves absent or blank fields and never overwrites existing stock", async () => {
  for (const stock of [undefined, "", 50]) {
    const f = fixture(),
      r = response();
    await f.api.importProductsCsv(
      req({ rows: [{ sku: "SKU", prixBaseFcfa: 200, stockQty: stock }] }),
      r,
    );
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(f.state.a.stockQty, 7);
    assert.equal(f.state.a.prixBaseFcfa, 200);
    assert.equal(f.state.p.imageUrl, "https://example.test/image.png");
    assert.equal(f.state.a.maxQtyPerOrder, 2);
  }
});
test("import rejects all writes when there are invalid rows or duplicate SKUs", async () => {
  for (const rows of [
    [
      { sku: "SKU", prixBaseFcfa: 300 },
      { sku: "OTHER", cc: -1 },
    ],
    [{ sku: "SKU" }, { sku: "SKU" }],
  ]) {
    const f = fixture(),
      r = response();
    await f.api.importProductsCsv(req({ rows }), r);
    assert.equal(r.code, 400);
    assert.equal(f.state.a.prixBaseFcfa, 100);
    assert.equal(f.state.audit.length, 0);
  }
});
test("import shared changes require explicit acknowledgement", async () => {
  const f = fixture(),
    r = response();
  await f.api.importProductsCsv(
    req({ rows: [{ sku: "SKU", nom: "Autre" }] }),
    r,
  );
  assert.equal(r.code, 400);
  assert.equal(f.state.p.nom, "Produit");
});
test("copy requires a global role and explicit destinations", async () => {
  for (const request of [
    { ...req({ destinationCodes: ["BFA"] }), user: { role: "STOCK_MANAGER" } },
    req(),
    req({ destinationCodes: ["CIV"] }),
  ]) {
    const f = fixture(),
      r = response();
    await f.api.copyProductsFromCountry(request, r);
    assert.ok([400, 403].includes(r.code));
    assert.equal(f.state.audit.length, 0);
  }
});
test("country copy overwrite preserves existing stock and copies grade prices", async () => {
  const f = fixture(),
    r = response();
  await f.api.copyProductsFromCountry(
    req({ destinationCodes: ["BFA"], overwrite: true }),
    r,
  );
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(f.state.a.stockQty, 7);
  assert.equal(f.state.audit[0].countryId, "BFA");
  assert.equal(f.state.grades[0].countryId, "BFA");
});
test("copy preview makes no writes", async () => {
  const f = fixture(),
    r = response();
  await f.api.copyProductsFromCountry(
    req({ destinationCodes: ["BFA"], overwrite: true, dryRun: true }),
    r,
  );
  assert.equal(r.code, 200);
  assert.equal(f.state.audit.length, 0);
});
test("paginated list retains country scope, stable sorting and global filtered counts", async () => {
  const f = fixture();
  let seen;
  f.db.countryProduct.findMany = async (args) => {
    seen = args;
    return [{ product: f.readProduct() }];
  };
  const r = response();
  await f.api.listProducts(
    req(
      {},
      {
        page: "2",
        pageSize: "20",
        sort: "stockQty",
        dir: "desc",
        stock: "low",
      },
    ),
    r,
  );
  assert.equal(r.code, 200);
  assert.equal(seen.skip, 20);
  assert.equal(seen.where.countryId, "CIV");
  assert.equal(seen.where.stockQty.lte, 5);
  assert.equal(seen.orderBy[0].stockQty, "desc");
  assert.equal(r.body.totalCount, 85);
});
test("legacy list consumers continue receiving an array", async () => {
  const f = fixture(),
    r = response();
  await f.api.listProducts(req({}, { take: "500" }), r);
  assert.equal(r.code, 200);
  assert.equal(Array.isArray(r.body), true);
});
test("invalid filters are rejected", async () => {
  for (const query of [
    { page: "1.5" },
    { category: "BAD" },
    { stock: "BAD" },
    { sort: "anything" },
    { actif: "anything" },
  ]) {
    const f = fixture(),
      r = response();
    await f.api.listProducts(req({}, query), r);
    assert.equal(r.code, 400);
  }
});
test("CSV export includes country values, formula escaping and zero values", async () => {
  const f = fixture();
  f.state.p.nom = "=SUM(A1)";
  f.state.a.prixBaseFcfa = 0;
  const r = response();
  await f.api.exportProducts(req(), r);
  assert.equal(r.code, 200);
  assert.ok(r.body.startsWith("\uFEFF"));
  assert.ok(r.body.includes("'=SUM(A1)"));
  assert.ok(r.body.includes('"0"'));
});
test("history and conditionnements require product availability in the current country", async () => {
  const f = fixture(),
    foreign = { ...req(), countryId: "BFA" };
  for (const [file, method] of [
    ["products.controller.js", "history"],
    ["productPackagings.controller.js", "listPackagings"],
    ["productPackagings.controller.js", "createPackaging"],
    ["productPackagings.controller.js", "deletePackaging"],
  ]) {
    const r = response();
    await api(f.db, file)[method](foreign, r);
    assert.equal(r.code, 404);
  }
});
test("packaging rejects decimal unit counts and invalid price values", async () => {
  for (const body of [
    { label: "Carton", unitsPerPackage: 1.5 },
    { label: "Carton", unitsPerPackage: 12, prixFcfa: -2 },
    { label: "Carton", unitsPerPackage: 12, prixFcfa: "ABC" },
  ]) {
    const f = fixture(),
      r = response();
    await api(f.db, "productPackagings.controller.js").createPackaging(
      req(body),
      r,
    );
    assert.equal(r.code, 400);
  }
});
test("packaging deactivation preserves its history and order references", async () => {
  const f = fixture(),
    r = response();
  await api(f.db, "productPackagings.controller.js").deletePackaging(req(), r);
  assert.equal(r.code, 204);
  assert.equal(f.state.pack.actif, false);
  assert.equal(f.state.audit[0].action, "PACKAGING_DEACTIVATE");
});
test("stock adjustments record both quantities and require a reason", async () => {
  const f = fixture(),
    r = response();
  await api(f.db, "stock.controller.js").adjustStock(
    req({
      productId: "p",
      targetStockQty: 10,
      expectedStockQty: 7,
      note: "Inventaire",
    }),
    r,
  );
  assert.equal(r.code, 200);
  assert.equal(f.state.a.stockQty, 10);
  assert.equal(f.state.movements[0].qty, 3);
  assert.equal(f.state.movements[0].meta.previousQty, 7);
});
test("concurrent stock adjustments cannot overwrite one another", async () => {
  const f = fixture(),
    responses = [response(), response()];
  await Promise.all(
    responses.map((r, i) =>
      api(f.db, "stock.controller.js").adjustStock(
        req({
          productId: "p",
          targetStockQty: 10 + i,
          expectedStockQty: 7,
          note: "Inventaire",
        }),
        r,
      ),
    ),
  );
  assert.deepEqual(responses.map((r) => r.code).sort(), [200, 409]);
  assert.equal(f.state.movements.length, 1);
});
test("invalid or excessive stock adjustments have no side effects", async () => {
  for (const body of [
    { targetStockQty: 10 },
    { targetStockQty: 1.5, note: "Motif" },
    { deltaQty: -20, note: "Motif" },
    { targetStockQty: 10, deltaQty: 1, note: "Motif" },
  ]) {
    const f = fixture(),
      r = response();
    await api(f.db, "stock.controller.js").adjustStock(
      req({ productId: "p", ...body }),
      r,
    );
    assert.equal(r.code, 400);
    assert.equal(f.state.a.stockQty, 7);
    assert.equal(f.state.movements.length, 0);
  }
});

test("an import preview token refuses changes made after review", async () => {
  const f = fixture(),
    preview = response(),
    rows = [{ sku: "SKU", prixBaseFcfa: 200 }];
  await f.api.importProductsCsv(req({ rows, dryRun: true }), preview);
  f.state.a.updatedAt = new Date("2026-02-01");
  const r = response();
  await f.api.importProductsCsv(
    req({ rows, previewToken: preview.body.previewToken }),
    r,
  );
  assert.equal(r.code, 409);
  assert.equal(f.state.a.prixBaseFcfa, 100);
  assert.equal(f.state.audit.length, 0);
});
test("audit failure rolls back product changes and versions", async () => {
  const f = fixture();
  f.db.productAuditLog.create = async () => {
    throw Error("Audit unavailable");
  };
  const r = response();
  await f.api.updateProduct(req({ nom: "Nouveau" }), r);
  assert.equal(r.code, 500);
  assert.equal(f.state.p.nom, "Produit");
  assert.equal(f.state.a.stockQty, 7);
  assert.equal(f.state.p.updatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("country copy refuses a destination changed after preview", async () => {
  const f = fixture(),
    preview = response();
  await f.api.copyProductsFromCountry(
    req({ destinationCodes: ["BFA"], overwrite: true, dryRun: true }),
    preview,
  );
  f.state.a.updatedAt = new Date("2026-02-01");
  const r = response();
  await f.api.copyProductsFromCountry(
    req({
      destinationCodes: ["BFA"],
      overwrite: true,
      previewToken: preview.body.previewToken,
    }),
    r,
  );
  assert.equal(r.code, 409);
  assert.equal(f.state.audit.length, 0);
  assert.equal(f.state.a.stockQty, 7);
});

test("server pagination clamps a page after products disappear from a view", async () => {
  const f = fixture();
  f.db.countryProduct.count = async () => 2;
  let skip;
  f.db.countryProduct.findMany = async (args) => {
    skip = args.skip;
    return [{ product: f.readProduct() }];
  };
  const r = response();
  await f.api.listProducts(req({}, { page: "9", pageSize: "20" }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.page, 1);
  assert.equal(skip, 0);
});
