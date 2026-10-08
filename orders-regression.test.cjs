const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { claimOrderSnapshot } = require('./src/helpers/order-write-guard');
const query = require('./src/helpers/order-query');
const permissions = require('./src/auth/permissions');
const country = require('./src/helpers/countryScope');
function response() { return { code:200, headers:{}, status(value){this.code=value;return this;}, json(value){this.body=value;return this;}, setHeader(key,value){this.headers[key]=value;}, send(value){this.body=value;return this;} }; }
function controller(db, file='orders.controller.js') {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'src/controllers/admin',file),'utf8'), {module,console:{error(){}},process,Buffer,require(id){
    if(id==='../../prisma')return db;
    if(id.endsWith('/order-write-guard'))return {claimOrderSnapshot};
    if(id.endsWith('/order-query'))return query;
    if(id.endsWith('/countryScope'))return country;
    if(id.endsWith('/permissions'))return permissions;
    if(id.endsWith('/parcel-number'))return require('./src/helpers/parcel-number');
    if(id.endsWith('/preorder-notifications.service'))return {sendPreorderNotification:async()=>({sent:false}),buildOrderReadySmsMessage:()=>'',buildOrderFulfilledSmsMessage:()=>''};
    if(id.endsWith('/realtime-events.service'))return {publishRealtimeEvent:()=>{}};
    return {};
  }});
  return module.exports;
}
const request = (body={}, query={}) => ({countryId:'CIV',country:{id:'CIV'},user:{id:'actor',role:'SUPER_ADMIN'},params:{id:'order'},body,query});
function fixture(patch={}) {
  let order={id:'order',countryId:'CIV',status:'READY',paymentStatus:'PAID',preparationLaunchedAt:new Date(),stockDeductedAt:new Date(),stockRestoredAt:null,items:[{id:'line',productId:'product',qty:5}],...patch};
  let balance=100, movements=[], logs=[], checks=[{preorderItemId:'line',checked:true}], blocking=0;
  const matches=(where,row)=>Object.entries(where).every(([key,value])=>value===undefined || (value && typeof value==='object' && 'not' in value ? row[key]!==value.not && row[key]!=null : value===null ? row[key]==null : row[key]===value));
  const tx={
    preorder:{updateMany:async({where,data})=>{if(!matches(where,order))return {count:0};order={...order,...data};return {count:1};},update:async({data})=>{order={...order,...data};return structuredClone(order);}},
    countryProduct:{update:async({data})=>{balance+=data.stockQty.increment;return {};},updateMany:async({data,where})=>{if(balance<where.stockQty.gte)return {count:0};balance-=data.stockQty.decrement;return {count:1};}},
    stockMovement:{create:async({data})=>{movements.push(data);return data;}},preorderLog:{create:async({data})=>{logs.push(data);return data;}},
    preparationAnomaly:{count:async()=>blocking},preparationChecklistItem:{upsert:async()=>({}),findMany:async()=>structuredClone(checks),updateMany:async({data})=>{checks=checks.map(row=>({...row,...data}));return {count:checks.length};},update:async({data})=>{checks[0]={...checks[0],...data};return checks[0];}},
    cashierTransaction:{findFirst:async()=>null},
  };
  let serial=Promise.resolve();
  const db={...tx,preorder:{...tx.preorder,findFirst:async({where})=>matches(where,order)?structuredClone(order):null},$transaction(fn){const task=serial.then(async()=>{const previous=structuredClone({order,balance,movements,logs,checks});try{return await fn(tx);}catch(error){({order,balance,movements,logs,checks}=previous);throw error;}});serial=task.catch(()=>{});return task;}};
  return {db,api:controller(db),get state(){return {order,balance,movements,logs,checks};},uncheck(){checks[0].checked=false;},block(){blocking=1;}};
}
test('concurrent cancellations return stock only once',async()=>{
  const f=fixture(),responses=[response(),response()];await Promise.all(responses.map(res=>f.api.cancelOrder(request({reason:'Erreur de commande'}),res)));
  assert.deepEqual(responses.map(res=>res.code).sort(),[200,409]);assert.equal(f.state.balance,105);assert.equal(f.state.movements.length,1);assert.equal(f.state.order.status,'CANCELLED');
  const again=response();await f.api.cancelOrder(request({reason:'Même demande'}),again);assert.equal(again.body.alreadyDone,true);assert.equal(f.state.balance,105);
});
test('cancel cannot cross countries or accept a missing reason',async()=>{
  for(const body of [{},{reason:'   '},{reason:{message:'objet'}},{reason:'x'.repeat(1001)}]){const f=fixture(),res=response();await f.api.cancelOrder(request(body),res);assert.equal(res.code,400);assert.equal(f.state.balance,100);}
  const f=fixture(),res=response(),req=request({reason:'Erreur'});req.countryId='BFA';req.country={id:'BFA'};await f.api.cancelOrder(req,res);assert.equal(res.code,404);assert.equal(f.state.balance,100);
});
test('concurrent regularizations debit a legacy reservation once',async()=>{
  const f=fixture({status:'PAID',stockDeductedAt:null}),responses=[response(),response()];await Promise.all(responses.map(res=>f.api.regularizeFulfillmentNoNotification(request({}),res)));
  assert.deepEqual(responses.map(res=>res.code).sort(),[200,409]);assert.equal(f.state.balance,95);assert.equal(f.state.movements.length,1);assert.equal(f.state.order.status,'FULFILLED');
});
test('preparation checks are revalidated inside the transaction',async()=>{
  for(const issue of ['uncheck','block']){const f=fixture({status:'PAID',stockDeductedAt:null});f[issue]();const res=response();await f.api.prepareOrder(request({}),res);assert.equal(res.code,409);assert.equal(f.state.balance,100);assert.equal(f.state.order.status,'PAID');}
});
test('concurrent cashier launches reserve once and preserve an existing reservation',async()=>{
  for(const reserved of [false,true]) {
    const f=fixture({status:'PAID',stockDeductedAt:reserved?new Date():null,preparationLaunchedAt:null});
    const api=controller(f.db,'cashier.controller.js'),responses=[response(),response()];
    await Promise.all(responses.map(res=>api.launchPreparation(request(),res)));
    assert.deepEqual(responses.map(res=>res.code).sort(),[200,409],JSON.stringify(responses.map(res=>res.body)));
    assert.equal(f.state.balance,reserved?100:95);assert.equal(f.state.movements.length,reserved?0:1);
  }
});
test('concurrent preparation and cancellation cannot double move stock',async()=>{
  const f=fixture({status:'PAID',stockDeductedAt:null}),prepared=response(),cancelled=response();await Promise.all([f.api.prepareOrder(request({}),prepared),f.api.cancelOrder(request({reason:'Abandon'}),cancelled)]);
  assert.ok([prepared.code,cancelled.code].includes(409));assert.ok(f.state.movements.length<=1);assert.ok([95,100].includes(f.state.balance));
});
test('reservation failure rolls back the order claim and stock changes',async()=>{
  const f=fixture({status:'PAID',stockDeductedAt:null,items:[{id:'line',productId:'product',qty:200}]}),res=response();await f.api.prepareOrder(request({}),res);assert.equal(res.code,409);assert.equal(f.state.order.status,'PAID');assert.equal(f.state.order.stockDeductedAt,null);assert.equal(f.state.balance,100);
});
test('a stale payment status refuses a stock operation',async()=>{
  const f=fixture();const snapshot=structuredClone(f.state.order);f.state.order.paymentStatus='REFUNDED';await assert.rejects(()=>f.db.$transaction(tx=>claimOrderSnapshot(tx,snapshot)),error=>error.statusCode===409);assert.equal(f.state.movements.length,0);
});
test('priority, full status scope and statistics use the same country filters',async()=>{
  const seen=[];const db={preorder:{count:async({where})=>{seen.push(where);return 85;},findMany:async(args)=>{assert.equal(args.orderBy[0].billingPriority,'desc');assert.equal(args.where.status,undefined);seen.push(args.where);return [{id:'order'}];},groupBy:async({where})=>{seen.push(where);return [{status:'SUBMITTED',_count:{_all:70}},{status:'DRAFT',_count:{_all:15}}];}}};
  const res=response();await controller(db).listOrders(request({}, {sort:'priority',includeDrafts:'true',includeCancelled:'true',includeStats:'true'}),res);assert.equal(res.code,200);assert.equal(res.body.stats.statusCounts.SUBMITTED,70);assert.equal(res.body.totalCount,85);assert.ok(seen.every(where=>where.countryId==='CIV'));
});
test('invalid filters fail before ORM queries',async()=>{
  for(const q of [{status:'INVALID'},{dateFrom:'2026-02-31'},{dateFrom:'2026-10-08',dateTo:'2026-10-01'},{paymentStatus:'SUCCEEDED'},{as400Amount:'nimportequoi'}]){let called=false;const res=response();await controller({preorder:{count:async()=>{called=true;return 0;}}}).listOrders(request({},q),res);assert.equal(res.code,400);assert.equal(called,false);}
});
test('legacy preparation queries keep their intended restricted default scope',async()=>{
  let where;const res=response();await controller({preorder:{count:async()=>0,findMany:async args=>{where=args.where;return [];}}}).listOrders(request({},{}),res);assert.equal(res.code,200);assert.ok(where.status.notIn.includes('DRAFT'));assert.ok(where.status.notIn.includes('CANCELLED'));
});
test('CSV export preserves scope, zero confirmed amounts and neutralizes formulas',async()=>{
  let captured;const db={preorder:{count:async()=>1,findMany:async args=>{captured=args;return [{preorderNumber:'PO-CIV-1',fboNomComplet:'=HYPERLINK("x")',status:'PAID',paymentStatus:'PAID',as400InvoiceTotalFcfa:0,indicativeTotalFcfa:100,createdAt:new Date('2026-10-08')}];}}};
  const res=response();await controller(db).exportOrders(request({}, {assignedToMe:'true',includeCancelled:'true'}),res);assert.equal(res.code,200);assert.equal(captured.where.countryId,'CIV');assert.equal(captured.where.assignedInvoicerId,'actor');assert.ok(res.body.startsWith('\uFEFF'));assert.ok(res.body.includes("'=HYPERLINK"));assert.ok(res.body.includes('"0"'));assert.equal(captured.select.pickupSecretCode,undefined);
});
test('large CSV exports are refused before loading rows',async()=>{let read=false;const res=response();await controller({preorder:{count:async()=>10001,findMany:async()=>{read=true;return [];}}}).exportOrders(request(),res);assert.equal(res.code,400);assert.equal(read,false);});
