import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const server=read('supabase/functions/admin-ops/index.ts');
assert.doesNotThrow(()=>new vm.Script(admin));
assert.match(admin,/Conferir evidências dos 7 módulos/);
assert.match(admin,/function adminFinanceHomologationRefresh\(\)/);
assert.match(admin,/function adminFinanceHomologationChoose\(key\)/);
assert.match(admin,/testPurpose,authorization:'GERAR_PIX_REAL'/);
assert.match(admin,/Recupere o Pix original antes de iniciar outro teste/);
assert.match(admin,/O Pix de laboratório não cria direitos, créditos ou pedidos comerciais/);
assert.match(server,/if\(action==="finance-homologation-modules"\)/);
assert.match(server,/admin_finance_homologation_modules_v1_919/);
assert.match(server,/proofScope:"counts_and_configuration_only"/);
assert.match(server,/merchantRequiredForLab:false/);
assert.match(server,/testPurpose,commercialPurchase:false/);
assert.match(server,/String\(intent.metadata\?\.testPurpose\|\|"gateway"\)!==testPurpose/);
assert.ok(server.indexOf('if(action==="finance-homologation-modules")')<
  server.indexOf('const idempotencyKey=String(req.headers.get("Idempotency-Key")'),
  'read-only evidence check must not require a financial mutation key');

const catalogStart=admin.indexOf('function adminFinanceHomologationCatalog(){');
const catalogEnd=admin.indexOf('function adminFinanceHomologationView(d){',catalogStart);
assert.ok(catalogStart>0&&catalogEnd>catalogStart);
let role='superadmin',actor='owner',calls=0,repaints=0,answer=null;
const runtime={status:'ready',section:'finance',financeWorkspace:'homologation',
 session:{user:{id:actor}}};
const ctx=vm.createContext({
 adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
 adminCurrentRole:()=>role,adminFinanceWorkspaceCurrent:()=>runtime.financeWorkspace,
 adminInvoke:async req=>{calls++;assert.equal(req.action,'finance-homologation-modules');return answer;},
 render:()=>{repaints++},Date,Number,String,Object
});
vm.runInContext(admin.slice(catalogStart,catalogEnd)+
 ';this.registry=adminFinanceHomologationCatalog;'+
 'this.choose=adminFinanceHomologationChoose;'+
 'this.refresh=adminFinanceHomologationRefresh;'+
 'this.getState=adminFinanceHomologationEvidenceState;',ctx);
const keys=Array.from(ctx.registry(),x=>x.key);
assert.deepEqual(keys,[
 'coupons','mobility','merchants','orders','advertising','benefits','professional_ads']);
assert.equal(ctx.choose('orders'),true);
assert.equal(ctx.getState().selected,'orders');
assert.equal(ctx.choose('not-a-module'),false);
const modules=keys.map(key=>({key,configured:key==='coupons'?true:null,counts:{records:0}}));
answer={source:'admin_finance_homologation_modules_v1_919',
 readOnly:true,paymentsCreated:0,moneyMoved:false,merchantRequiredForLab:false,
 proofScope:'counts_and_configuration_only',modules};
await ctx.refresh();
assert.equal(calls,1);
assert.equal(ctx.getState().data,answer);
assert.equal(ctx.getState().loading,false);
answer={...answer,paymentsCreated:1};
await ctx.refresh();
assert.equal(ctx.getState().data,null,'a response claiming an issued charge fails closed');
assert.match(ctx.getState().error,/não confirmou/);
role='finance';
assert.equal(ctx.choose('coupons'),false);
const before=calls;await ctx.refresh();
assert.equal(calls,before,'finance role cannot read protected module proof inventory');
role='superadmin';
runtime.session.user.id='someone-else';
assert.equal(ctx.getState().data,null,'user changes cannot inherit previous evidence');
assert.equal(ctx.getState().selected,'coupons');
runtime.financeWorkspace='summary';
assert.equal(ctx.choose('mobility'),false,'module choice is valid only inside homologation');
runtime.financeWorkspace='homologation';

const readStart=server.indexOf('// V1.919 — module-specific financial evidence inventory');
const readEnd=server.indexOf('async function adminFinanceLabLiveHistory(',readStart);
assert.ok(readStart>0&&readEnd>readStart);
const helperSource=server.slice(readStart,readEnd)
 .replace('admin:any,actorId:string','admin,actorId')
 .replaceAll('(p:any)=>','(p)=>');
assert.doesNotThrow(()=>new vm.Script(helperSource));
let reads=0;
const db={from(table){
 const request={
   select(_fields,opts){
    if(opts?.count==='exact'&&opts?.head===true){
     reads++;return Promise.resolve({count:0,error:null});
    }
    return this;
   },eq(){return this},limit(){return this},
   async maybeSingle(){return {error:null,data:table==='clube_coupon_paid_packages'
    ?{sale_enabled:true,funding_verified:true,legal_terms_verified:true,
      redeem_settlement_verified:true}:table==='ads_independent_sales_controls_v1_886'
     ?{sales_enabled:false}:null}},
   then(resolve,reject){return Promise.resolve({error:null,data:[
     {plan_key:'essential',purchase_enabled:true},
     {plan_key:'popular',purchase_enabled:true},
     {plan_key:'professional',purchase_enabled:true}
   ]}).then(resolve,reject)}
 };
 return request;
}};
const serverCtx=vm.createContext({Date,Object,Promise,Number,
 DomainError:class DomainError extends Error{constructor(code,message,status){
  super(message);this.code=code;this.status=status;
 }}});
vm.runInContext(helperSource+
 ';this.inspect=adminFinanceHomologationModules;',serverCtx);
const inspected=await serverCtx.inspect(db,'owner');
assert.equal(inspected.source,'admin_finance_homologation_modules_v1_919');
assert.equal(inspected.readOnly,true);
assert.equal(inspected.moneyMoved,false);
assert.equal(inspected.paymentsCreated,0);
assert.equal(inspected.merchantRequiredForLab,false);
assert.equal(inspected.modules.length,7);
assert.equal(inspected.modules[0].configured,true);
assert.equal(inspected.modules[1].counts.plans,3);
assert.equal(inspected.modules[4].configured,false,'paid Ads must not be enabled by an inventory read');
assert.equal(reads,17,'bounded source count queries; no row export or financial mutation');
const missing={from(){return {select:async()=>({count:null,error:new Error('offline')})}}};
await assert.rejects(()=>serverCtx.inspect(missing,'owner'),
 e=>e.code==='FINANCE_HOMOLOGATION_EVIDENCE_UNAVAILABLE');
assert.match(read('.github/workflows/audit.yml'),/node tests\/admin-finance-all-modules-v1-919.mjs/);
console.log('V1.919 PASS: seven read-only financial modules, superadmin isolation, bounded evidence, Pix origin immutability.');
