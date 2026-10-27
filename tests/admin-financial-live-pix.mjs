import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/admin-ops/index.ts');
const hook=read('supabase/functions/billing-payment-webhook-mercadopago/index.ts');
const ui=read('js/admin.js'),workflow=read('.github/workflows/audit.yml');
const start=edge.indexOf('const FINANCE_LAB_LIVE_MIN_CENTS=100;');
const end=edge.indexOf('async function billingProviderHealth(',start);
assert.ok(start>0&&end>start);
const source=edge.slice(start,end)
  .replaceAll('admin:any','admin').replaceAll('actorId:string','actorId')
  .replaceAll('email:string','email').replaceAll('body:any','body')
  .replaceAll('digest:string','digest').replaceAll('req:Request','req')
  .replaceAll('(item:any)=>','(item)=>').replaceAll('(row:any)=>','(row)=>')
  .replaceAll('(p:any)=>','(p)=>').replaceAll('(event:any)=>','(event)=>');
const eventStart=hook.indexOf('async function handleFinancialLabLiveOrder(');
const eventEnd=hook.indexOf('Deno.serve(',eventStart);
assert.ok(eventStart>0&&eventEnd>eventStart);
const hookSource=hook.slice(eventStart,eventEnd)
  .replaceAll('admin:any','admin').replaceAll('orderId:string','orderId')
  .replaceAll('proof:any','proof').replaceAll('(p:any)=>','(p)=>');
assert.match(edge,/action==="finance-lab-live-pix"/);
assert.match(edge,/adminAccess.admin_role\)!=="superadmin"/);
assert.match(edge,/authorization!=="GERAR_PIX_REAL"/);
assert.match(edge,/FINANCE_LAB_LIVE_MAX_CENTS=500/);
assert.match(edge,/finance_lab_live_pix_intent/);
assert.match(hook,/verifyMercadoPagoWebhook\(req,webhookSecret,dataId\)/);
assert.ok(hook.indexOf('if(!signed)')<hook.indexOf('await handleFinancialLabLiveOrder('));
assert.match(hook,/route:"finance_lab_live_pix"/);
assert.doesNotMatch(hookSource,/ingestPlatformPayment|wallet_entries|merchant_billing_payment_events|rpc\(/);
assert.match(ui,/adminFinanceLabLiveCreateFromUi/);
assert.match(ui,/prompt\?\.\(/);
assert.match(ui,/Copiar Pix REAL/);
assert.match(workflow,/node tests\/admin-financial-live-pix.mjs/);
const hash=s=>createHash('sha256').update(s).digest('hex');
class DomainError extends Error{
  constructor(code,message,status){super(message);this.code=code;this.status=status}
}
const actorId='11111111-1111-4111-8111-111111111111';
const amount=200;
const key='test-live-pix-idempotency-12345678';
let rows=[],operations=[],responses=[],providerCalls=[];
const orderId='ORD01LIVEFINLAB00000012';
const paymentId='PAY01LIVEFINLAB00012';
let currentOrder=null;
function getOrder(reference){
  return {id:orderId,live_mode:true,external_reference:reference,
    total_amount:'2.00',currency_id:'BRL',status:'action_required',
    transactions:{payments:[{id:paymentId,status:'action_required',amount:'2.00',
      payment_method:{id:'pix',type:'bank_transfer',qr_code:'VALID_DUMMY_QR',
        ticket_url:'https://www.mercadopago.com.br/payments/ticket'}}]}};
}
function matches(row,filters){
  return filters.every(([field,value,op])=>op==='gte'
    ?String(row[field]||'')>=value:row[field]===value);
}
const db={from(table){
  assert.equal(table,'platform_admin_audit','lab must not reach any financial ledger');
  const filters=[];let count=100;
  const query={
    select(){return this},
    eq(field,value){filters.push([field,value]);return this},
    gte(field,value){filters.push([field,value,'gte']);return this},
    order(){return this},
    limit(n){count=n;return this},
    async maybeSingle(){const found=rows.filter(r=>matches(r,filters));
      return {data:found[0]??null,error:null};},
    then(resolve,reject){return Promise.resolve({data:rows.filter(r=>matches(r,filters)).slice(0,count),
      error:null}).then(resolve,reject);},
    async insert(row){operations.push({action:row.action,id:row.id});
      if(rows.some(x=>x.id===row.id))return {error:{code:'23505'}};
      rows.push({...row,created_at:new Date().toISOString()});
      return {error:null};}
  };
  return query;
}};
let actorEmail='admin@example.com';
let liveHealth={ok:true,chargeReady:true,accountBound:true,
  remoteWebhookRegistrationVerified:true,receiveReady:true};
const ctx=vm.createContext({
  Date,Number,Math,Array,String,Set,Boolean,
  DomainError,sha256Hex:async s=>hash(s),
  enforceApiQuota:async()=>{},
  mercadoPagoBillingProviderHealth:async()=>liveHealth,
  mercadoPagoConfigured:s=>s==='mock_production_access_token',
  Deno:{env:{get:name=>({
    MERCADOPAGO_ACCESS_TOKEN:'mock_production_access_token',
    MERCADOPAGO_WEBHOOK_SECRET:'mock_webhook_secret_very_long'
  })[name]}},
  mercadoPagoFetch:async(path,opts)=>{
    providerCalls.push({path,method:opts.method,key:opts.idempotencyKey});
    if(opts.method==='POST'){
      const order=getOrder(opts.body.external_reference);
      currentOrder=order;
      return {ok:true,order};
    }
    return {ok:true,order:currentOrder};
  },
  readMercadoPagoJson:async response=>response.order,
  moneyToCents:v=>Math.round(Number(v)*100),
  safeMercadoPagoUrl:s=>s,
  validatePixBrCode:s=>({valid:s==='VALID_DUMMY_QR'}),
  mercadoPagoPixDeadline:()=>new Date(Date.now()+23*3600_000).toISOString()
});
vm.runInContext(source+';this.live={ready:adminFinanceLabLiveReadiness,create:adminFinanceLabLivePix,check:adminFinanceLabLiveCheck};',ctx);
const req={headers:{get:k=>k==='Idempotency-Key'?key:null}};
const consent={amountCents:amount,authorization:'GERAR_PIX_REAL'};
const snapshot=await ctx.live.ready(db,actorId);
assert.equal(snapshot.readOnly,true);
assert.equal(snapshot.providerReady,true);
assert.equal(snapshot.recent.length,0);
const created=await ctx.live.create(db,actorId,actorEmail,consent,req);
assert.equal(created.ok,true);
assert.equal(created.mode,'live');
assert.equal(created.settlementVerified,false);
assert.equal(created.credited,false);
assert.equal(created.brCode,'VALID_DUMMY_QR');
assert.equal(created.amountCents,200);
assert.deepEqual(operations.map(x=>x.action),[
  'finance_lab_live_pix_intent','finance_lab_live_pix_created']);
const replay=await ctx.live.create(db,actorId,actorEmail,consent,req);
assert.equal(replay.orderId,created.orderId);
assert.equal(providerCalls[0].key,providerCalls[1].key,
  'same user retry must never use another PSP idempotency key');
assert.equal(rows.length,2,'replays cannot duplicate audit evidence');
await assert.rejects(()=>ctx.live.create(db,actorId,actorEmail,
  {amountCents:200,authorization:'GERAR_PIX_REAL'},
  {headers:{get:()=> 'another-idempotency-key-1234567890'}}),
  e=>e.code==='FINANCE_LAB_LIVE_ALREADY_ISSUED');
assert.equal(providerCalls.length,2,'different keys blocked BEFORE PSP call');
for(const invalid of [
  {amountCents:500,authorization:'NOT_AUTHORIZED'},
  {amountCents:501,authorization:'GERAR_PIX_REAL'},
  {amountCents:1,authorization:'GERAR_PIX_REAL'}
]){
  await assert.rejects(()=>ctx.live.create(db,actorId,actorEmail,invalid,req),
    e=>e.code==='FINANCE_LAB_LIVE_CONSENT_REQUIRED');
}
let checked=await ctx.live.check(db,actorId,{orderId});
assert.equal(checked.providerProcessed,false);
assert.equal(checked.webhookSeen,false);
assert.equal(checked.settlementVerified,false);
assert.equal(checked.credited,false);
await assert.rejects(()=>ctx.live.check(db,'22222222-2222-4222-8222-222222222222',{orderId}),
  e=>e.code==='FINANCE_LAB_LIVE_ORDER_NOT_OWNED');
let proof=rows.find(x=>x.action==='finance_lab_live_pix_created');
let auditCalls=0;
const hookCtx=vm.createContext({
  Deno:ctx.Deno,Date,Number,Boolean,String,Array,Set,
  mercadoPagoConfigured:ctx.mercadoPagoConfigured,
  moneyToCents:ctx.moneyToCents,
  billingEvidenceHash:async s=>hash(s),
  fetchProviderOrder:async()=>({response:{ok:true},data:currentOrder}),
  json:(v,s)=>({status:s,body:v})
});
vm.runInContext(hookSource+';this.ingestLab=handleFinancialLabLiveOrder;',hookCtx);
const handled=await hookCtx.ingestLab(db,orderId,proof);
assert.equal(handled.status,200);
assert.equal(handled.body.signatureVerified,true);
assert.equal(handled.body.providerProcessed,false);
assert.equal(handled.body.financialMutationAttempted,false);
assert.equal(rows.length,3);
await hookCtx.ingestLab(db,orderId,proof);
assert.equal(rows.length,3,'signed webhook retry must be idempotent');
currentOrder={...currentOrder,status:'processed',status_detail:'accredited',
  transactions:{payments:[{...currentOrder.transactions.payments[0],
    status:'processed',status_detail:'accredited'}]}};
const approved=await hookCtx.ingestLab(db,orderId,proof);
assert.equal(approved.body.providerProcessed,true);
assert.equal(rows.length,4);
checked=await ctx.live.check(db,actorId,{orderId});
assert.equal(checked.providerProcessed,true);
assert.equal(checked.webhookProcessed,true);
assert.equal(checked.webhookSeen,true);
assert.equal(checked.settlementVerified,false);
assert.equal(checked.credited,false);
currentOrder={...currentOrder,transactions:{...currentOrder.transactions,
  refunds:[{id:'RF-1',amount:'1.00',status:'processed'}]}};
const reversed=await hookCtx.ingestLab(db,orderId,proof);
assert.equal(reversed.body.reversalObserved,true);
assert.equal(reversed.body.providerProcessed,false);
checked=await ctx.live.check(db,actorId,{orderId});
assert.equal(checked.reversalObserved,true);
assert.equal(checked.providerProcessed,false);
assert.equal(checked.settlementVerified,false);
assert.equal(checked.credited,false);
currentOrder={...currentOrder,external_reference:'OTHER'};
const mismatch=await hookCtx.ingestLab(db,orderId,proof);
assert.equal(mismatch.status,409);
assert.equal(rows.length,5);
assert.equal(providerCalls.filter(x=>x.method==='POST').length,2);
console.log('PASS Admin REAL Pix laboratory: explicit superadmin consent, 1-5 BRL, locked creation, deterministic idempotency, signed callback audit, order readback, reversal quarantine, zero credits.');
