const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(file, requireStub) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, exports: module.exports, process, Buffer, console: { error() {}, warn() {}, info() {} }, require: requireStub,
  });
  return module.exports;
}

const fboDirectory = load('src/services/fboDirectory.service.js', (name) => require(name));
const promotion = load('src/services/sponsorship-promotion.service.js', (name) => {
  if (name === './fboDirectory.service') return { normalizeGrade: fboDirectory.normalizeGrade };
  return {};
});

const VALIDATED_AT = new Date('2026-11-04T15:30:00Z');
const SAME_DAY = new Date('2026-11-04T22:00:00Z');
const NEXT_DAY = new Date('2026-11-05T00:00:01Z');

function db(items, { sponsorships } = {}) {
  const calls = { sponsorship: 0 };
  return {
    calls,
    sponsorship: {
      findMany: async ({ where }) => {
        calls.sponsorship += 1;
        assert.equal(where.status, 'VALIDATED');
        assert.ok(where.recruitFboNumero.in.includes('225-000-123-456'));
        return sponsorships || [{ id: 's1', validatedAt: VALIDATED_AT, qualifyingPreorderId: 'p1' }];
      },
    },
    preorderItem: { findMany: async () => items },
  };
}
const line = (sku, cc, qty = 1) => ({ qty, ccUnitaire: cc, lineTotalCc: cc * qty, productSkuSnapshot: sku, product: { sku } });

test('a validated recruit with at least 2 CC becomes Animateur adjoint the next day', async () => {
  const store = db([line('15', 0.8), line('28', 0.6, 2)]);
  const found = await promotion.findRecruitPromotion('225000123456', { now: SAME_DAY, db: store });
  assert.equal(found.grade, 'ANIMATEUR_ADJOINT');
  assert.equal(found.totalCc, 2);
  assert.equal(found.eligibleFrom.toISOString(), '2026-11-05T00:00:00.000Z');
  assert.equal(found.active, false, 'pas le jour même de la validation');
  const next = await promotion.findRecruitPromotion('225-000-123-456', { now: NEXT_DAY, db: store });
  assert.equal(next.active, true);
});

test('a 634 or 635 pack qualifies whatever the CC total', async () => {
  for (const sku of ['634', '635']) {
    const found = await promotion.findRecruitPromotion('225-000-123-456', { now: NEXT_DAY, db: db([line(sku, 0.5)]) });
    assert.equal(found.packSku, sku);
    assert.equal(found.active, true);
  }
});

test('a purchase under 2 CC without pack does not qualify', async () => {
  const found = await promotion.findRecruitPromotion('225-000-123-456', { now: NEXT_DAY, db: db([line('15', 1.999)]) });
  assert.equal(found, null);
});

test('effective grade lifts a Client privilégié only once the promotion is active', async () => {
  const store = db([line('634', 0.5)]);
  const today = await promotion.resolveEffectiveGrade('225-000-123-456', 'CLIENT_PRIVILEGIE', { now: SAME_DAY, db: store });
  assert.equal(today.grade, 'CLIENT_PRIVILEGIE');
  assert.equal(today.promotion.active, false);
  const tomorrow = await promotion.resolveEffectiveGrade('225-000-123-456', 'Preferred Customer', { now: NEXT_DAY, db: store });
  assert.equal(tomorrow.grade, 'ANIMATEUR_ADJOINT');
  assert.equal(tomorrow.promoted, true);
});

test('effective grade never touches a higher or unknown grade', async () => {
  const store = db([line('634', 0.5)]);
  for (const grade of ['ANIMATEUR', 'Supervisor', 'MANAGER', 'ANIMATEUR_ADJOINT']) {
    const result = await promotion.resolveEffectiveGrade('225-000-123-456', grade, { now: NEXT_DAY, db: store });
    assert.equal(result.grade, grade);
    assert.equal(result.promoted, false);
  }
  assert.equal(store.calls.sponsorship, 0, 'aucune requête pour un grade déjà suffisant');
});

test('sponsor check explains when a promoted recruit can start sponsoring', async () => {
  const httpError = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });
  const allowed = new Set(['ANIMATEUR_ADJOINT', 'ANIMATEUR', 'MANAGER_ADJOINT', 'MANAGER']);
  function submission(now) {
    return load('src/services/sponsorship-submission.service.js', (name) => {
      if (name === './sponsorship.service') return { httpError, isSponsorGradeAllowed: (g) => allowed.has(g) };
      if (name === './sponsorship-promotion.service') {
        return {
          findRecruitPromotion: () => null,
          resolveEffectiveGrade: (numero, grade) => promotion.resolveEffectiveGrade(numero, grade, { now, db: db([line('15', 2.5)]) }),
        };
      }
      if (name === './fboDirectory.service') return fboDirectory;
      return {};
    });
  }
  await assert.rejects(
    submission(SAME_DAY).assertSponsorGradeAllowed('225-000-123-456', 'CLIENT_PRIVILEGIE'),
    (error) => error.code === 'SPONSOR_PROMOTION_PENDING' && /5 novembre 2026/.test(error.message),
  );
  assert.equal(await submission(NEXT_DAY).assertSponsorGradeAllowed('225-000-123-456', 'CLIENT_PRIVILEGIE'), 'ANIMATEUR_ADJOINT');
});
