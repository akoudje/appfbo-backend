const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { STAGES, shippingFilters, stageFilters, handoverInput } = require('./src/services/shipping-workspace.service');
const shipping = require('./src/services/shipping.service');
function matches(where, row) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every(item => matches(item, row));
    if (key === 'OR') return condition.some(item => matches(item, row));
    if (key === 'NOT') return !matches(condition, row);
    const value = row[key];
    if (!condition || typeof condition !== 'object' || condition instanceof Date) return value == null && condition == null || value === condition;
    if ('is' in condition) return value != null && matches(condition.is, value);
    if ('some' in condition || 'none' in condition) return (!('some' in condition) || (value || []).some(item => matches(condition.some, item))) && (!('none' in condition) || !(value || []).some(item => matches(condition.none, item)));
    return Object.entries(condition).every(([op, expected]) => op === 'in' ? expected.includes(value) : op === 'not' ? value != null && value !== expected : op === 'gt' ? value > expected : op === 'gte' ? value >= expected : op === 'lte' ? value <= expected : op === 'contains' ? String(value || '').toLowerCase().includes(expected.toLowerCase()) : op === 'mode');
  });
}
const base = { id: 'parcel', countryId: 'ci', deliveryMode: 'EXPEDITION_CODITRANS', status: 'PAID', paymentStatus: 'PAID', preparationLaunchedAt: new Date(), shippingFeeFcfa: null, preparationItems: [{ checked: true }], preparationAnomalies: [], shippingDestinationCity: 'ISSIA', shippingRecipientName: 'Destinataire Test', createdAt: new Date('2026-10-12T10:00:00Z') };
const paidLink = { countryId: 'ci', source: 'SHIPPING', status: 'PAID', providerStatus: 'SUCCEEDED', baseAmountFcfa: 100, amountFcfa: 101 };
test('each shipping parcel belongs to one actionable stage, including finalization after fee payment', () => {
  const filters = stageFilters('ci');
  for (const [patch, stage] of [
    [{preparationItems:[]}, 'TO_PREPARE'], [{preparationItems:[{checked:false}]}, 'TO_PREPARE'], [{preparationAnomalies:[{blocking:true,resolvedAt:null}]}, 'TO_PREPARE'],
    [{}, 'TO_QUOTE'], [{shippingFeeFcfa:100}, 'TO_PAY'], [{status:'READY',shippingFeeFcfa:100}, 'TO_PAY'],
    [{shippingFeeFcfa:100,shippingPaymentLink:paidLink}, 'TO_PREPARE'], [{status:'READY',shippingFeeFcfa:100,shippingPaymentLink:paidLink}, 'READY'],
    [{status:'READY',shippingFeeFcfa:0}, 'READY'], [{status:'FULFILLED'}, 'HANDED_OVER'],
  ]) assert.deepEqual(STAGES.filter(key => matches(filters[key], {...base,...patch})), [stage]);
});
test('shipping filters retain country, carrier, destination, search and period constraints', () => {
  const {where} = shippingFilters({stage:'READY',carrier:'EXPEDITION_CODITRANS',destination:'iss',q:'destinataire',dateFrom:'2026-10-12',dateTo:'2026-10-12'}, 'ci');
  assert.equal(matches(where, base), true);
  for (const patch of [{countryId:'other'}, {deliveryMode:'RETRAIT_SITE_FLP'}, {paymentStatus:'UNPAID'}, {preparationLaunchedAt:null}, {shippingDestinationCity:'ABIDJAN'}, {createdAt:new Date('2026-10-11T10:00:00Z')}]) assert.equal(matches(where,{...base,...patch}), false);
  for (const query of [{stage:'DELIVERED'}, {carrier:'PICKUP'}, {destination:['ISSIA']}, {dateFrom:'2026-02-30'}, {q:'x'.repeat(201)}]) assert.throws(()=>shippingFilters(query,'ci'), error=>error.statusCode===400);
});
function loadController(db, additions={}) {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('./src/controllers/admin/shipping.controller.js','utf8'),{module,Buffer,Date,console,require:name=>({
    crypto:require('node:crypto'),multer:require('multer'),'../../prisma':db,'../../helpers/countryScope':require('./src/helpers/countryScope'),
    '../../services/shipping-workspace.service':{STAGES,shippingFilters,stageFilters},'../../services/shipping.service':shipping,
    '../../services/cloudinary':additions.storage||{},'../../utils/bankProofFiles':additions.files||{},'../../helpers/order-write-guard':require('./src/helpers/order-write-guard'),
  })[name]||{}});
  return module.exports;
}
const response=()=>({code:200,headers:{},status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(name,value){this.headers[name]=value;}});
test('paginated shipping rows and all five counters share the same country and filters',async()=>{
  const rows=Array.from({length:31},(_,i)=>({...base,id:String(i),status:'READY',shippingFeeFcfa:100,shippingPaymentLink:paidLink}));
  rows.push({...rows[0],id:'foreign',countryId:'other'},{...base,id:'pickup',deliveryMode:'RETRAIT_SITE_FLP'});
  const countWheres=[];
  const db={preorder:{findMany:async({where,skip,take})=>rows.filter(row=>matches(where,row)).slice(skip,skip+take),count:async({where})=>{countWheres.push(where);return rows.filter(row=>matches(where,row)).length;}}};
  const res=response();await loadController(db).listShipments({countryId:'ci',query:{stage:'READY',destination:'ISSIA',page:'2',pageSize:'25'}},res);
  assert.equal(res.code,200);assert.equal(res.body.totalCount,31);assert.equal(res.body.totalPages,2);assert.equal(res.body.data.length,6);assert.equal(res.body.stats.READY,31);
  assert.equal(countWheres.length,5);assert.ok(countWheres.every(where=>where.countryId==='ci'&&where.shippingDestinationCity.contains==='ISSIA'));
  assert.ok(res.body.data.every(row=>row.shippingPayment.status==='PAID'&&row.shippingPayment.path===undefined));
});
test('handover requires a real reference and a date after preparation, without changing pickup',()=>{
  const now=new Date('2026-10-12T18:30:00Z'),order={...base,preparedAt:'2026-10-12T17:00:00Z'};
  assert.deepEqual(handoverInput({}, {...order,deliveryMode:'RETRAIT_SITE_FLP'},now),{});
  for(const body of [{},{deliveryTracking:'x\nscript'},{deliveryTracking:'ref',shippingHandedOverAt:'2026-10-12T19:00:00Z'},{deliveryTracking:'ref',shippingHandedOverAt:'2026-10-12T16:00:00Z'},{deliveryTracking:'ref',shippingHandedOverAt:1}])assert.throws(()=>handoverInput(body,order,now),error=>error.statusCode===400);
  const result=handoverInput({deliveryTracking:' CODI-001 ',shippingHandedOverAt:'2026-10-12T18:00:00Z'},order,now);
  assert.equal(result.deliveryTracking,'CODI-001');assert.equal(result.shippingHandedOverAt.toISOString(),'2026-10-12T18:00:00.000Z');assert.equal(result.fulfillmentMode,'SHIPPING');
});
test('receipt file requires matching signatures and country-scoped authenticated access',async()=>{
  const downloads=[];
  const api=loadController({preorder:{findFirst:async({where})=>where.countryId==='ci'?{deliveryMode:base.deliveryMode,shippingReceiptFileUrl:'https://res.cloudinary.com/test/raw/authenticated/private.pdf',shippingReceiptMimeType:'application/pdf'}:null}}, {files:{streamBankProofFileToResponse:async args=>{downloads.push(args);return true;}}});
  assert.equal(api.receiptType({mimetype:'image/jpeg',buffer:Buffer.from('not an image')}),null);
  assert.equal(api.receiptType({mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.7')} )[1],'pdf');
  const other=response();await api.downloadReceipt({countryId:'other',params:{id:'parcel'}},other);assert.equal(other.code,404);assert.equal(downloads.length,0);
  const own=response();await api.downloadReceipt({countryId:'ci',params:{id:'parcel'}},own);assert.equal(downloads.length,1);assert.equal(own.headers['Cache-Control'],'private, no-store');
  const clean=require('./src/middlewares/protectPickupSecrets').sanitizePickupResponse({shippingReceiptFileUrl:downloads[0].fileUrl,shippingReceiptMimeType:'application/pdf',shippingReceiptAvailable:true});
  assert.equal(clean.shippingReceiptFileUrl,undefined);assert.equal(clean.shippingReceiptAvailable,true);
});
test('customer follow-up exposes reference and handover date but never the receipt storage address',()=>{
  const publicOrder=require('./src/utils/customerOrderResponse').customerOrderResponse({...base,status:'FULFILLED',deliveryTracking:'CODI-001',shippingHandedOverAt:'2026-10-12T18:00:00Z',shippingReceiptFileUrl:'private-asset',shippingReceiptMimeType:'image/jpeg'});
  assert.equal(publicOrder.deliveryTracking,'CODI-001');assert.equal(publicOrder.shippingHandedOverAt,'2026-10-12T18:00:00Z');assert.equal(publicOrder.shippingReceiptFileUrl,undefined);
});
test('receipt upload is private, audited and cannot be overwritten by a concurrent attachment',async()=>{
  let row={...base,status:'READY',stockDeductedAt:new Date(),shippingReceiptFileUrl:null},logs=[],uploaded=[],deleted=[];
  const tx={preorder:{updateMany:async()=>({count:1}),findUnique:async()=>({...row}),update:async({data})=>{row={...row,...data};return row;}},preorderLog:{create:async({data})=>{logs.push(data);return data;}}};
  let serial=Promise.resolve();
  const db={preorder:{findFirst:async({where})=>where.countryId==='ci'?{...row}:null},$transaction(fn){const job=serial.then(()=>fn(tx));serial=job.catch(()=>{});return job;}};
  const storage={uploadBuffer:async(buffer,options)=>{uploaded.push(options);return {secure_url:'https://res.cloudinary.com/test/raw/authenticated/'+options.public_id,public_id:options.public_id};},cloudinary:{uploader:{destroy:async id=>deleted.push(id)}}};
  const api=loadController(db,{storage}),request={countryId:'ci',params:{id:base.id},user:{id:'preparer'},file:{mimetype:'image/jpeg',buffer:Buffer.from([255,216,255,0])}};
  const results=[response(),response()];await Promise.all(results.map(res=>api.uploadReceipt(request,res)));
  assert.deepEqual(results.map(res=>res.code).sort(),[200,409]);assert.equal(logs.length,1);assert.equal(logs[0].actorAdminId,'preparer');assert.equal(logs[0].meta.event,'SHIPPING_RECEIPT');assert.ok(uploaded.every(item=>item.type==='authenticated'&&item.resource_type==='raw'));assert.equal(deleted.length,1);
  const foreign=response();await api.uploadReceipt({...request,countryId:'other'},foreign);assert.equal(foreign.code,404);assert.equal(uploaded.length,2);
});
