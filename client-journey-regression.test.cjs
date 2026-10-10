const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { matchingFboNames } = require('./src/utils/fboIdentity');
const directory = require('./src/services/fboDirectory.service');
const options = require('./src/services/country-order-options.service');

function fixture(directoryProfile = { exists:true, full_name:'KONÉ AMENAN', grade:'MANAGER' }) {
  const writes = [], lookup = [];
  const actor = { id:'owner', numeroFbo:'225-000-111-222', nomComplet:'Ancien Nom', email:'owner@example.test', grade:'CLIENT_PRIVILEGIE' };
  const db = {
    fbo: { findUnique:async()=>actor, upsert:async args=>{writes.push({type:'fbo',...args});return{id:args.where.numeroFbo===actor.numeroFbo?'owner':'other',numeroFbo:args.where.numeroFbo, ...args.create};} },
    countrySettings: { findUnique:async()=>({enableWave:true,enableCash:true,enableDelivery:true,enablePickup:true}) },
    preorder: {
      findFirst:async args=> args.select?.factureWhatsappTo ? {factureWhatsappTo:'0700000000'} : null,
      create:async({data})=>{writes.push({type:'draft',data});return{id:'draft',...data};},
    },
    preorderLog: { create:async()=>({}) },
  };
  db.$transaction=async callback=>callback(db);
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('./src/controllers/preorders.controller.js','utf8'),{module,process:{env:{}},Date,Map,console:{warn(){},error(){},log(){}},require:name=>{
    if(name==='../prisma')return db;
    if(name==='crypto')return crypto;
    if(name==='../utils/fboIdentity')return{matchingFboNames};
    if(name==='../services/fboDirectory.service')return{...directory,fetchFboDirectoryProfile:async numero=>{lookup.push(numero);if(directoryProfile instanceof Error)throw directoryProfile;return directoryProfile;}};
    if(name==='../services/country-order-options.service')return options;
    if(name==='../helpers/countryScope')return{scopeCreate:(_req,data)=>({countryId:'CIV',...data})};
    if(name==='../helpers/preorder-number')return{formatDateKey:()=> '20300101',formatPreorderNumber:()=> 'CIV-001'};
    return{};
  }});
  return {api:module.exports,db,actor,writes,lookup};
}
function req(body={},customer={fboId:'owner',numeroFbo:'225-000-111-222',email:'owner@example.test'}) {
  return {body,customer,countryId:'CIV',country:{id:'CIV',code:'CIV'},headers:{'x-idempotency-key':'draft-key'},get(name){return this.headers[name.toLowerCase()];},header(name){return this.get(name);}};
}
function res(){return{code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}

test('authenticated shortcut uses the directory grade and owner contacts, ignoring a forged grade and creator',async()=>{
  const f=fixture(),r=res();await f.api.createCustomerDraft(req({grade:'CLIENT_PRIVILEGIE',placedByFboNumero:'forged',personalDataConsentAccepted:true}),r);
  assert.equal(r.code,200);assert.equal(r.body.identityVerified,true);assert.equal(r.body.fboGrade,'MANAGER');assert.equal(r.body.fboNomComplet,'KONÉ AMENAN');
  assert.equal(r.body.contact.email,'owner@example.test');assert.equal(r.body.contact.phone,'0700000000');
  const draft=f.writes.find(w=>w.type==='draft').data;
  assert.equal(draft.fboGrade,'MANAGER');assert.equal(draft.fboId,'owner');assert.equal(draft.personalDataConsentAccepted,false);assert.equal(draft.placedByFboNumero,null);
  assert.notEqual(draft.clientDraftKey,'draft-key');assert.equal(draft.clientDraftKey.length,64);
});

test('a foreign beneficiary must match the directory name and never receives owner contacts',async()=>{
  const f=fixture(),r=res();await f.api.createCustomerDraft(req({numeroFbo:'225-000-333-444',nomComplet:'Amenan Kone',placedByFboNumero:'forged'}),r);
  assert.equal(r.code,200);assert.equal(r.body.orderFor,'OTHER');assert.equal(r.body.contact.email,'');assert.equal(r.body.contact.phone,'');
  assert.equal(f.writes.find(w=>w.type==='draft').data.placedByFboNumero,'225-000-111-222');
  const wrong=fixture(),rejected=res();await wrong.api.createCustomerDraft(req({numeroFbo:'225-000-333-444',nomComplet:'Autre Personne'}),rejected);
  assert.equal(rejected.code,400);assert.equal(wrong.writes.length,0);assert.ok(!JSON.stringify(rejected.body).includes('KONÉ'));
});

test('expired sessions and unavailable directory cannot grant personalized prices',async()=>{
  const unsigned=fixture(),r=res();await unsigned.api.createCustomerDraft(req({},null),r);assert.equal(r.code,401);assert.equal(unsigned.writes.length,0);
  const changed=fixture(),s=res();await changed.api.createCustomerDraft(req({}, {fboId:'owner',email:'old@example.test'}),s);assert.equal(s.code,401);assert.equal(changed.writes.length,0);
  for(const state of [{exists:false},Object.assign(new Error('unavailable'),{statusCode:503}),{exists:true,full_name:'Client',grade:''}]){
    const f=fixture(state),response=res();await f.api.createCustomerDraft(req(),response);assert.ok([502,503].includes(response.code));assert.equal(f.writes.length,0);
  }
});

test('a changed account cookie cannot create a draft for the previously displayed account', async () => {
  const f = fixture(), response = res();
  await f.api.createCustomerDraft(req({ sessionFboNumero: '225-000-999-888' }), response);
  assert.equal(response.code, 409);
  assert.equal(response.body.code, 'CUSTOMER_SESSION_CHANGED');
  assert.equal(f.lookup.length, 0);
  assert.equal(f.writes.length, 0);
});

test('public requests cannot expose a mismatching known name or persist a manually claimed manager discount',async()=>{
  const known=fixture(),r=res();await known.api.createDraft(req({numeroFbo:'225-000-111-222',nomComplet:'Wrong',grade:'MANAGER'},null),r);assert.equal(r.code,400);assert.equal(known.writes.length,0);
  const unknown=fixture({exists:false}),s=res();await unknown.api.createDraft(req({numeroFbo:'225-000-111-222',nomComplet:'Déclaré',grade:'MANAGER',email:'new@example.test'},null),s);
  assert.equal(s.code,200);assert.equal(s.body.identityVerified,false);assert.equal(s.body.fboGrade,'CLIENT_PRIVILEGIE');
  assert.equal(unknown.writes.find(w=>w.type==='fbo').update.email,undefined);assert.equal(unknown.writes.find(w=>w.type==='fbo').update.grade,undefined);
});

test('number validation and changed stored grades fail before exposing or reusing stale data',async()=>{
  const f=fixture(),r=res();await f.api.createDraft(req({numeroFbo:'123',nomComplet:'Kone Amenan',grade:'MANAGER'},null),r);assert.equal(r.code,400);assert.equal(f.lookup.length,0);
  f.db.preorder.findFirst=async()=>({id:'old',fboNumero:'225-000-111-222',fboNomComplet:'KONE AMENAN',fboGrade:'CLIENT_PRIVILEGIE'});
  const s=res();await f.api.createDraft(req({numeroFbo:'225-000-111-222',nomComplet:'Kone Amenan'},null),s);assert.equal(s.code,409);assert.equal(s.body.code,'FBO_PROFILE_CHANGED');assert.equal(f.writes.length,0);
});

test('directory fallback cannot reuse a formerly discounted draft', async () => {
  const f = fixture({ exists: false });
  f.db.preorder.findFirst = async () => ({ id: 'old', fboNumero: '225-000-111-222', fboNomComplet: 'KONE AMENAN', fboGrade: 'MANAGER' });
  const response = res();
  await f.api.createDraft(req({ numeroFbo: '225-000-111-222', nomComplet: 'Kone Amenan', grade: 'MANAGER' }, null), response);
  assert.equal(response.code, 409);
  assert.equal(f.writes.length, 0);
  assert.equal(response.body.preorderId, undefined);
});

test('idempotency collisions reuse only a draft matching the freshly verified identity and grade', async () => {
  for (const grade of ['MANAGER', 'CLIENT_PRIVILEGIE']) {
    const f = fixture(); let reads = 0;
    f.db.preorder.findFirst = async args => args.select?.factureWhatsappTo ? null : ++reads === 1 ? null : ({ id: 'existing', fboNumero: '225-000-111-222', fboNomComplet: 'KONE AMENAN', fboGrade: grade, status: 'DRAFT' });
    f.db.preorder.create = async () => { throw Object.assign(Error('unique'), { code: 'P2002' }); };
    const response = res(); await f.api.createCustomerDraft(req(), response);
    assert.equal(response.code, grade === 'MANAGER' ? 200 : 409);
    if (grade === 'MANAGER') assert.equal(response.body.identityVerified, true);
    else assert.equal(response.body.preorderId, undefined);
  }
});

test('name matching accepts case, accents, punctuation and word order without accepting partial or unrelated names',()=>{
  assert.ok(matchingFboNames('Amenan Kone','KONÉ, AMENAN'));assert.ok(matchingFboNames("Nguessan Jean Paul","N’GUESSAN JEAN-PAUL"));
  assert.equal(matchingFboNames('KONE','KONE AMENAN'),false);assert.equal(matchingFboNames('', ''),false);assert.equal(matchingFboNames('A Person','B Person'),false);
});
