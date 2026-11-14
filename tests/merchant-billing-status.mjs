import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../supabase/functions/merchant-billing-pix/index.ts',import.meta.url),'utf8');
const start=source.indexOf('    const user=await authenticatedUser(req);');
const end=source.indexOf('    const planKey=',start);
assert(start>0&&end>start);assert(source.includes('"https://admin.tamao.com.br"'));
const merchant='22000000-0000-4000-8000-000000000002',actor='11000000-0000-4000-8000-000000000001';
const id='33000000-0000-4000-8000-000000000003';
let role='owner',body={action:'status',merchantId:merchant},reads=0,remote=0,payable=0,paid=false;
let charge={id,provider:'mercadopago',provider_charge_id:'ORD123456789',status:'expired',amount_cents:1990};
class DomainError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status}}
const admin={from(table){
 let requested=null;
 return {select(){return this},eq(k,v){
  if(k==='merchant_id')assert.equal(v,merchant);if(k==='user_id')assert.equal(v,actor);
  if(k==='id')requested=v;return this;
 },order(){return this},limit(){return this},maybeSingle:async()=>{
  if(table==='merchant_members')return {data:role?{member_role:role}:null,error:null};
  assert.equal(table,'merchant_billing_provider_charges');reads++;
  return {data:requested&&requested!==charge?.id?null:charge&&{...charge},error:null};
 }}}};
const context=vm.createContext({req:{},origin:'https://admin.tamao.com.br',DomainError,
 authenticatedUser:async()=>({id:actor}),readJsonBody:async()=>body,createClient:()=>admin,
 SUPABASE_URL:'https://isolated.invalid',SECRET_KEY:'local-only-placeholder',enforceApiQuota:async()=>{},
 UUID_RE:/^[0-9a-f-]{36}$/,provider:'mercadopago',mercadoPagoAccessToken:'local-only-placeholder',wooviAppId:'',mercadoPagoConfigured:()=>true,
 handlePlatformBillingOrder:async(db,order)=>{assert.equal(db,admin);assert.equal(order,charge.provider_charge_id);remote++;if(paid)charge.status='completed';return {ok:true}},
 assertStoredChargeStillPayable:async()=>{payable++},publicCharge:r=>r,json:data=>data});
const run=()=>vm.runInContext('(async()=>{'+source.slice(start,end)+'return {createBranch:true};})()',context);
const closed=await run();assert.equal(closed.newChargesCreated,0);assert.equal(remote,0);
role=null;reads=0;await assert.rejects(run(),e=>e.code==='MERCHANT_FINANCE_PERMISSION_DENIED'&&e.status===403);assert.equal(reads,0);
role='operator';await assert.rejects(run(),e=>e.status===403);
role='owner';body={action:'status',merchantId:merchant,chargeId:'44000000-0000-4000-8000-000000000004'};
await assert.rejects(run(),e=>e.code==='CHARGE_NOT_FOUND');
body={action:'status',merchantId:merchant,amountCents:1};await assert.rejects(run(),e=>e.code==='INVALID_STATUS_REQUEST');
body={action:'status',merchantId:merchant};charge.status='active';paid=true;
const confirmed=await run();assert.equal(confirmed.charge.status,'completed');assert.equal(remote,1);assert.equal(payable,0);
charge.status='active';paid=false;await run();assert.equal(payable,1);
body={merchantId:merchant,planKey:'credit_01990'};assert.equal((await run()).createBranch,true);
console.log('PASS: original merchant Pix status uses fresh owner/manager scope, denies foreign charges, reuses settlement and never prepares a charge.');
