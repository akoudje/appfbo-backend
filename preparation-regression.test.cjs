const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { sanitizePickupResponse, protectPickupSecrets } = require('./src/middlewares/protectPickupSecrets');
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function controller(prisma) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/controllers/admin/orders.controller.js'), 'utf8'), {
    module, console, process, Buffer,
    require: (id) => id === '../../prisma' ? prisma : id.endsWith('/order-query') ? require('./src/helpers/order-query') : id.endsWith('/order-write-guard') ? require('./src/helpers/order-write-guard') : id.endsWith('/countryScope') ? { scopeWhere: (req, where = {}) => ({ countryId: req.countryId, ...where }) } : {},
  });
  return module.exports;
}
test('operational responses hide pickup secrets in detail, mutation and history without mutating source', () => {
  const source = { pickupSecretCode: '654321', createdAt: new Date('2026-10-01'), order: { pickupSecretCode: '654321' }, logs: [{ meta: { pickupSecretCode: '654321', toStatus: 'READY' } }], messages: [{ id: 'm', purpose: 'ORDER_READY', channel: 'SMS', status: 'SENT', body: 'Code 654321', meta: { code: '654321' }, events: [{ payload: '654321' }] }] };
  const result = sanitizePickupResponse(source);
  assert.equal(JSON.stringify(result).includes('654321'), false);
  assert.equal(result.messages[0].status, 'SENT');
  assert.equal(result.logs[0].meta.toStatus, 'READY');
  assert.equal(result.createdAt, '2026-10-01T00:00:00.000Z');
  assert.equal(source.pickupSecretCode, '654321');
  assert.equal(source.messages[0].body, 'Code 654321');
});
test('middleware covers message endpoint arrays, reminders and preserves normal invoice messages', () => {
  const res = response(); let next = false;
  protectPickupSecrets({}, res, () => { next = true; });
  res.status(201).json([{ purpose: 'REMINDER', channel: 'EMAIL', body: 'Code 654321', status: 'SENT' }, { purpose: 'INVOICE', channel: 'SMS', body: 'Facture disponible' }]);
  assert.equal(next, true); assert.equal(res.code, 201);
  assert.equal(res.body[0].body, undefined); assert.equal(res.body[1].body, 'Facture disponible');
});
test('preparation pagination counts only launched orders within the country scope', async () => {
  let captured;
  const api = controller({ preorder: {
    count: async ({where}) => { assert.equal(where.countryId, 'CIV'); assert.equal(where.preparationLaunchedAt.not, null); return 2101; },
    findMany: async (args) => { captured = args; return [{ id: 'last' }]; },
  }});
  const res=response();
  await api.listOrders({countryId:'CIV', query:{status:'PAID', preparationQueue:'true', page:'85', pageSize:'25'}},res);
  assert.equal(res.code,200); assert.equal(captured.skip,2100); assert.equal(res.body.totalCount,2101); assert.equal(res.body.totalPages,85);
});
test('preparation scope does not hide ready orders or change other workspaces', async () => {
  for (const query of [{status:'READY',preparationQueue:'true'}, {status:'PAID'}]) {
    const api=controller({preorder:{count:async()=>0,findMany:async({where})=>{assert.equal(where.preparationLaunchedAt,undefined);return [];}}});
    const res=response();await api.listOrders({countryId:'CIV',query},res);assert.equal(res.code,200);
  }
});
test('checklists reject finished orders, unlaunched orders and non-boolean input without writing', async () => {
  for (const method of ['updatePreparationChecklistItem','bulkUpdatePreparationChecklist']) {
    for (const [status, launched, checked, expected] of [['READY',true,false,409],['FULFILLED',true,false,409],['PAID',false,false,409],['PAID',true,'false',400]]) {
      const api=controller({preorder:{findFirst:async()=>({id:'o',status,preparationLaunchedAt:launched,items:[{id:'i'}]})},$transaction:async()=>{throw Error('unexpected write');}});
      const res=response();await api[method]({countryId:'CIV',params:{id:'o'},body:{itemId:'i',checked}},res);assert.equal(res.code,expected);
    }
  }
});
test('bulk validation and correction record the operator while preparation is active', async () => {
  for (const checked of [true, false]) {
    const updates=[];
    const db={preorder:{findFirst:async()=>({id:'o',countryId:'CIV',status:'PAID',preparationLaunchedAt:new Date(),items:[{id:'i'}]}),updateMany:async()=>({count:1})},preparationChecklistItem:{upsert:async()=>({}),update:async({data})=>{updates.push(data);return data;}}};
    db.$transaction=async fn=>fn(db);
    const res=response();await controller(db).bulkUpdatePreparationChecklist({countryId:'CIV',user:{id:'operator'},params:{id:'o'},body:{checked}},res);
    assert.equal(res.code,200);assert.equal(updates[0].checked,checked);assert.equal(updates[0].checkedById,checked?'operator':null);
  }
});

test('individual validation records the operator and allows correction during preparation', async () => {
  for (const checked of [true, false]) {
    let saved;
    const db={preorder:{findFirst:async()=>({id:'o',countryId:'CIV',status:'PAID',preparationLaunchedAt:new Date(),items:[{id:'i'}]}),updateMany:async()=>({count:1})},preparationChecklistItem:{upsert:async(args)=>{if('checked' in args.update)saved=args.update;return args.update;}}};
    db.$transaction=async(fn)=>fn(db);
    const api=controller(db),res=response();
    await api.updatePreparationChecklistItem({countryId:'CIV',user:{id:'operator'},params:{id:'o'},body:{itemId:'i',checked}},res);
    assert.equal(res.code,200);assert.equal(saved.checked,checked);assert.equal(saved.checkedById,checked?'operator':null);
  }
});
