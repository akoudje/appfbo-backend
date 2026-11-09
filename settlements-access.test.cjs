// Commandes réglées par une filiale (FLP Burkina) : marquage réservé aux
// superviseurs de la facturation.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireRole, requirePermission } = require('./src/middlewares/rbac');
const { BILLING_SUPERVISOR_ROLES } = require('./src/services/billingQueue.service');
const { Permission, ROLE_PERMISSIONS } = require('./src/auth/permissions');

async function run(role) {
  const chain = [requirePermission(Permission.INVOICE_CREATE), requireRole(BILLING_SUPERVISOR_ROLES)];
  const req = { user: { id: 'u', role, permissions: ROLE_PERMISSIONS[role] || [] } };
  let code = null;
  const res = { status(c) { code = c; return this; }, json() { return this; } };
  for (const mw of chain) {
    let passed = false;
    await mw(req, res, () => { passed = true; });
    if (!passed) return code;
  }
  return 'allowed';
}

test('agents de vente et facturiers : refusés', async () => {
  assert.equal(await run('FACTURIER_CAISSIER'), 403);
  assert.equal(await run('INVOICER'), 403);
});

test('responsable facturation, directeur commercial, admins : autorisés', async () => {
  for (const role of ['BILLING_MANAGER', 'SALES_DIRECTOR', 'SUPER_ADMIN', 'TECH_ADMIN']) {
    assert.equal(await run(role), 'allowed', role);
  }
});

test('les routes de marquage utilisent ces deux contrôles', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/routes/admin.routes.js'), 'utf8');
  for (const route of [
    'router.post("/billing/settlements/mark", ...settlementManagers',
    'router.get("/billing/settlements/pending", ...settlementManagers',
    'router.delete("/billing/settlements/:id", ...settlementManagers',
  ]) {
    assert.ok(src.includes(route), route);
  }
});
