// Simulation de commande : même total que la vraie commande, aucun contrôle
// de stock ni de quantité maximale, grade figé par un jeton signé.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.SIMULATION_TOKEN_SECRET = 'test-secret';

// Faux Prisma : produits d'un pays, remise par grade, réglages pays et une
// précommande portant les mêmes articles (pour comparer les totaux).
const db = { products: [], discounts: {}, settings: { packagingFeeFcfa: 100 }, preorder: null };
const fakePrisma = {
  product: { findMany: async () => db.products },
  gradeDiscount: {
    findUnique: async ({ where }) => {
      const value = db.discounts[where.countryId_grade.grade];
      return value == null ? null : { discountPercent: value };
    },
  },
  countrySettings: { findUnique: async () => db.settings },
  preorder: { findFirst: async () => db.preorder },
};
const prismaFile = require.resolve(path.join(__dirname, 'src/prisma.js'));
require.cache[prismaFile] = { id: prismaFile, filename: prismaFile, loaded: true, exports: fakePrisma };
// Réglages du parrainage (module lourd : multer, Cloudinary…) remplacés.
const sponsorshipSettings = { enabled: true, minPurchaseFcfa: 53000 };
const sponsorshipFile = require.resolve(path.join(__dirname, 'src/services/sponsorship.service.js'));
require.cache[sponsorshipFile] = {
  id: sponsorshipFile, filename: sponsorshipFile, loaded: true,
  exports: { getSponsorshipSettings: async () => ({ ...sponsorshipSettings }) },
};

const pricing = require('./src/services/pricing.service');
const simulation = require('./src/services/order-simulation.service');

function product(id, { prix, stock = 10, cc = 0.05, max = null, gradePrices = [] }) {
  return {
    id, sku: `SKU-${id}`, nom: `Produit ${id}`, imageUrl: null, category: 'DRINKS', details: null,
    cc, poidsKg: 1,
    countryProducts: [{ countryId: 'c1', prixBaseFcfa: prix, stockQty: stock, actif: true, maxQtyPerOrder: max }],
    gradePrices: gradePrices.map(([grade, prixFcfa]) => ({ countryId: 'c1', grade, prixFcfa })),
    packagings: [],
  };
}

function setup(countryCode, grade) {
  db.preorder = {
    id: 'po1', countryId: 'c1', fboGrade: grade, deliveryMode: 'RETRAIT',
    country: { code: countryCode, settings: db.settings },
    items: [],
  };
  return { id: 'c1', code: countryCode };
}

async function compareWithOrder(country, grade, items) {
  db.preorder.items = items.map(({ productId, qty }) => ({
    productId, qty, product: db.products.find((p) => p.id === productId),
  }));
  const order = await pricing.computePreorderTotals('po1', 'c1');
  const token = simulation.createSimulationToken({ countryId: 'c1', grade });
  const quote = await simulation.quoteSimulation({ token, items, country });
  return { order: order.totals, quote: quote.totals, quoteResult: quote };
}

test('CIV (prix direct par grade) : total identique à la commande, timbre et emballage compris', async () => {
  db.products = [
    product('a', { prix: 25000, gradePrices: [['MANAGER', 17333.3333], ['CLIENT_PRIVILEGIE', 21000]] }),
    product('b', { prix: 9000, stock: 0, max: 2, gradePrices: [['MANAGER', 6100.5], ['CLIENT_PRIVILEGIE', 7800]] }),
  ];
  const country = setup('CIV', 'MANAGER');
  // Quantité au-delà du maximum par commande et produit en rupture : acceptés.
  const { order, quote } = await compareWithOrder(country, 'MANAGER', [
    { productId: 'a', qty: 7 },
    { productId: 'b', qty: 5 },
  ]);
  assert.equal(quote.totalProduitsFcfa, order.totalProduitsFcfa);
  assert.equal(quote.emballageFcfa, order.emballageFcfa);
  assert.equal(quote.timbreEtatFcfa, order.timbreEtatFcfa);
  assert.equal(quote.totalFcfa, order.totalFcfa);
  assert.equal(quote.totalCc, order.totalCc);
  assert.equal(quote.itemCount, 12);
  assert.ok(quote.timbreEtatFcfa > 0);
});

test('pays à remise par grade : total identique à la commande', async () => {
  db.products = [product('a', { prix: 25000 }), product('b', { prix: 9000, stock: 0 })];
  db.discounts = { MANAGER: 30 };
  const country = setup('SEN', 'MANAGER');
  const { order, quote } = await compareWithOrder(country, 'MANAGER', [
    { productId: 'a', qty: 3 },
    { productId: 'b', qty: 1 },
  ]);
  assert.equal(quote.totalFcfa, order.totalFcfa);
  assert.equal(quote.totalProduitsFcfa, 3 * 17500 + 6300);
  assert.equal(quote.timbreEtatFcfa, 0);
});

test('rupture signalée, produit retiré du catalogue listé à part, panier vide à 0', async () => {
  db.products = [product('a', { prix: 1000, stock: 0 })];
  db.discounts = {};
  const country = setup('SEN', 'CLIENT_PRIVILEGIE');
  const token = simulation.createSimulationToken({ countryId: 'c1', grade: 'CLIENT_PRIVILEGIE' });
  const quote = await simulation.quoteSimulation({
    token, country,
    items: [{ productId: 'a', qty: 2 }, { productId: 'a', qty: 1 }, { productId: 'disparu', qty: 1 }, { productId: 'a', qty: -4 }],
  });
  assert.equal(quote.lines.length, 1);
  assert.equal(quote.lines[0].qty, 3);
  assert.equal(quote.lines[0].inStock, false);
  assert.deepEqual(quote.unavailable, ['disparu']);

  const empty = await simulation.quoteSimulation({ token, country, items: [] });
  assert.equal(empty.totals.totalFcfa, 0);
  assert.equal(empty.totals.emballageFcfa, 0);

  const catalog = simulation.toSimulationCatalog(await pricing.computeCatalogProductsForGrade({ countryId: 'c1', countryCode: 'SEN', grade: 'CLIENT_PRIVILEGIE' }));
  assert.equal(catalog[0].inStock, false);
  assert.equal('stockQty' in catalog[0], false);
});

test('jeton : grade non modifiable, pays vérifié, expiration', () => {
  const token = simulation.createSimulationToken({ countryId: 'c1', grade: 'MANAGER', now: 1000 });
  assert.deepEqual(simulation.readSimulationToken(token, { countryId: 'c1', now: 2000 }), { countryId: 'c1', grade: 'MANAGER', futureRecruit: false });

  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), g: 'DIRECTEUR' })).toString('base64url');
  assert.throws(() => simulation.readSimulationToken(`${forged}.${signature}`, { countryId: 'c1', now: 2000 }), /expirée/);
  assert.throws(() => simulation.readSimulationToken(token, { countryId: 'c2', now: 2000 }), /autre pays/);
  assert.throws(() => simulation.readSimulationToken(token, { countryId: 'c1', now: 1000 + 13 * 3600 * 1000 }), /expirée/);
  assert.throws(() => simulation.readSimulationToken('n-importe-quoi', { countryId: 'c1' }), /expirée/);
});

test('garde-fous techniques : liste obligatoire, nombre de lignes et quantité plafonnés', () => {
  assert.throws(() => simulation.computeSimulationQuote({ items: 'x' }), /liste/);
  const many = Array.from({ length: simulation.MAX_LINES + 1 }, (_, i) => ({ productId: `p${i}`, qty: 1 }));
  assert.throws(() => simulation.computeSimulationQuote({ items: many }), /Trop de produits/);
  const quote = simulation.computeSimulationQuote({
    catalog: [{ id: 'a', prixBaseFcfa: 10, prixFinalFcfa: 10, pricingMode: 'DISCOUNT_FROM_PUBLIC_PRICE', cc: 0, stockQty: 1 }],
    items: [{ productId: 'a', qty: 1e9 }],
    countryCode: 'SEN',
  });
  assert.equal(quote.lines[0].qty, simulation.MAX_QTY_PER_LINE);
});

test('route session : numéro invalide, inconnu, quota et réponse sans nom ni stock', async () => {
  const lookups = [];
  const preordersFile = require.resolve(path.join(__dirname, 'src/controllers/preorders.controller.js'));
  let allowed = true;
  require.cache[preordersFile] = {
    id: preordersFile, filename: preordersFile, loaded: true,
    exports: {
      enforceFboCheckRateLimit: () => allowed,
      lookupFboGradeForCountry: async (numero) => { lookups.push(numero); return numero.startsWith('225') ? 'MANAGER' : null; },
    },
  };
  const { startSimulation } = require('./src/controllers/orderSimulation.controller');
  db.products = [product('a', { prix: 25000, gradePrices: [['MANAGER', 17000]] })];
  const call = async (body) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await startSimulation({ body, country: { id: 'c1', code: 'CIV' } }, res);
    return res;
  };

  assert.equal((await call({ numeroFbo: '123' })).statusCode, 400);
  assert.equal((await call({ numeroFbo: '999-000-111-222' })).statusCode, 404);
  const ok = await call({ numeroFbo: '225-000-111-222' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.grade, 'MANAGER');
  assert.equal(ok.body.items[0].prixFinalFcfa, 17000);
  assert.equal(ok.body.items[0].inStock, true);
  assert.ok(ok.body.token);
  assert.equal(ok.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.stringify(ok.body).includes('nomComplet'), false);

  allowed = false;
  assert.equal((await call({ numeroFbo: '225-000-111-222' })).statusCode, 429);
  assert.equal(lookups.length, 2);
});

test('futur filleul : prix Client privilégié, minimum de parrainage et promotion', async () => {
  db.products = [
    product('a', { prix: 25000, cc: 0.4, gradePrices: [['CLIENT_PRIVILEGIE', 21000], ['MANAGER', 17000]] }),
    product('634', { prix: 90000, cc: 1.5, gradePrices: [['CLIENT_PRIVILEGIE', 80000]] }),
  ];
  db.products[1].sku = '634';
  const country = setup('CIV', 'CLIENT_PRIVILEGIE');
  const { startSimulation } = require('./src/controllers/orderSimulation.controller');
  const call = async (body) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await startSimulation({ body, country }, res);
    return res;
  };

  const session = await call({ futureRecruit: true });
  assert.equal(session.statusCode, 200);
  assert.equal(session.body.grade, 'CLIENT_PRIVILEGIE');
  assert.equal(session.body.futureRecruit, true);
  assert.equal(session.body.sponsorship.minPurchaseFcfa, 53000);
  assert.equal(session.body.items.find((p) => p.id === 'a').prixFinalFcfa, 21000);

  // 2 × 21 000 = 42 000 < 53 000 ; 0,8 CC : pas de promotion.
  const small = await simulation.quoteSimulation({ token: session.body.token, country, items: [{ productId: 'a', qty: 2 }] });
  assert.deepEqual(small.sponsorship, {
    minPurchaseFcfa: 53000, minReached: false, missingFcfa: 11000,
    promotion: { minCc: 2, totalCc: 0.8, packSku: null, qualifies: false },
  });
  // Pack 634 : minimum atteint et promotion.
  const pack = await simulation.quoteSimulation({ token: session.body.token, country, items: [{ productId: '634', qty: 1 }] });
  assert.equal(pack.sponsorship.minReached, true);
  assert.equal(pack.sponsorship.promotion.qualifies, true);
  assert.equal(pack.sponsorship.promotion.packSku, '634');

  // Un jeton « numéro FBO » ne renvoie pas ces repères.
  const fboToken = simulation.createSimulationToken({ countryId: 'c1', grade: 'MANAGER' });
  assert.equal((await simulation.quoteSimulation({ token: fboToken, country, items: [{ productId: 'a', qty: 1 }] })).sponsorship, undefined);

  sponsorshipSettings.enabled = false;
  assert.equal((await call({ futureRecruit: true })).statusCode, 403);
  sponsorshipSettings.enabled = true;
});
