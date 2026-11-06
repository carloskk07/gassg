import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Executes the actual lazy mobility browser code; no real PSP, account,
// bank, Supabase or billing data is ever written in this test.
const source=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
new vm.Script(source);
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id2='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const driver='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const code='0002010102110000000000000000000000000000000';
const br2='0002010102110000000000000000000000000000001';
const timers=[],events={},clipboard=[],requests=[];
let visibility='visible',response=null,getSession=null;
const doc={
 get visibilityState(){return visibility;},
 querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},
 addEventListener:(type,cb)=>events[type]=cb,
 getElementById:()=>null
};
const valid=(overrides={})=>({
 invoiceId:id,status:'active',amountCents:990,invoiceKind:'prepaid_credit',
 brCode:code,
 qrDataUri:'data:image/png;base64,aGVsbG8=',
 paymentLinkUrl:'https://www.mercadopago.com.br/payments/856',
 expiresAt:'2099-01-01T00:00:00.000Z',
 paidByProvider:false,...overrides
});
const policy={plans:[],benefits:{eligibleDriver:true,version:2,normalFeeBps:900,
 memberFeeBps:800,termsText:'Regras para motoristas'},billing:{
 recordedCount:0,accruedCents:0,collectedCents:0,outstandingCents:0,
 collectionStatus:'not_collected',entries:[]}};
const ctx={
 console,Date,Intl,URL,URLSearchParams,FormData,document:doc,
 setTimeout:(fn,ms)=>{const t={fn,ms,cancelled:false};timers.push(t);return t},
 clearTimeout:t=>{t.cancelled=true},
 navigator:{clipboard:{writeText:async text=>clipboard.push(text)}},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 CHAMA_BACKEND:{url:'https://project.supabase.co',publishableKey:'public-key'},
 route:()=> 'mobility',render:()=>{},esc:x=>String(x??''),
 fetch:async(url,options)=>{
   assert.equal(url,'https://project.supabase.co/functions/v1/mobility-fee-pix');
   requests.push(JSON.parse(options.body));
   return typeof response==='function'?await response():{ok:true,json:async()=>({ok:true,charge:response})};
 }
};
ctx.globalThis=ctx;
vm.runInNewContext(source+';this.rt=mobilityRuntime;',ctx);
const s=ctx.rt;
s.user={id:driver};s.program=policy;
s.client={auth:{getSession:async()=>getSession?await getSession():
 {data:{session:{user:{id:driver},access_token:'test.jwt'}},error:null}},
 rpc:async(name)=>{
  assert.equal(name,'mobility_billing_catalog_v1_826');
  return {data:policy,error:null};
 }};
response=valid();
assert.equal(await ctx.mobilityFeePixRequest('plan','essential'),false);
assert.match(ctx.mobilityFeePixPanel(),/Pix copia e cola/);
assert.match(ctx.mobilityFeePixPanel(),/QR Code Pix/);
assert.match(ctx.mobilityFeePixPanel(),/Abrir cobrança no Mercado Pago/);
assert.equal(timers.length,1);
assert.equal(timers[0].ms,60000);
assert.deepEqual(requests.map(x=>x.action),['plan']);

// Explicit user click rechecks the exact existing invoice with the
// independent provider status endpoint, not a new plan/charge request.
requests.length=0;
await ctx.mobilityCopyFeePix();
assert.deepEqual(requests.map(x=>x.action),['status']);
assert.equal(clipboard.length,1);
assert.equal(clipboard[0],code);
assert.match(s.notice,/conferido e copiado/i);
assert.equal(s.pixBusy,false);
assert.equal(s.pixCopyBusy,false);

// Repeated click during status request cannot trigger second provider calls.
let release;
response=()=>new Promise(resolve=>{release=resolve});
const first=ctx.mobilityCopyFeePix();
await ctx.mobilityCopyFeePix();
assert.equal(requests.length,2);
assert.equal(s.pixCopyBusy,true);
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/onclick="mobilityCopyFeePix\(\)">/);
release({ok:true,json:async()=>({ok:true,charge:valid()})});
await first;
assert.equal(clipboard.length,2);
assert.equal(s.pixCopyBusy,false);

// Old charge is no longer valid: no copy, no stale QR or link left on page.
response=valid({status:'review_required',brCode:null,qrDataUri:null,
 paymentLinkUrl:null,paidByProvider:false});
await ctx.mobilityCopyFeePix();
assert.equal(clipboard.length,2);
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Pix copia e cola|Abrir cobrança no Mercado Pago/);
assert.match(s.error,/não pôde ser confirmado|mudou/i);

// Fresh valid invoice, but a different amount, identifier, type or BR code
// must not copy the previously displayed payment instruction.
for(const mutation of [{invoiceId:id2},{amountCents:991},
 {invoiceKind:'fee'}, {brCode:br2}]){
 response=valid();
 await ctx.mobilityFeePixRequest('status');
 assert.match(ctx.mobilityFeePixPanel(),/Pix copia e cola/);
 response=valid(mutation);
 await ctx.mobilityCopyFeePix();
 assert.equal(clipboard.length,2,'changed PSP charge must never copy original');
 assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Pix copia e cola/);
}

// Provider outage after an old Pix became visible must hide the old code.
response=valid();
await ctx.mobilityFeePixRequest('status');
response=()=>({ok:false,json:async()=>({error:'provider unavailable'})});
await ctx.mobilityCopyFeePix();
assert.equal(s.pix,null,'provider outage must remove stale cached charge');
assert.equal(clipboard.length,2);

// Short lease expires automatically, then users must explicitly refresh
// original status. No hidden copy even via global handler.
response=valid();
await ctx.mobilityFeePixRequest('status');
const last=timers.at(-1);
last.fn();
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Pix copia e cola|QR Code Pix|Abrir cobrança no Mercado Pago/);
assert.equal(s.pix.invoiceId,id);
await ctx.mobilityCopyFeePix();
assert.equal(clipboard.length,2);
response=valid();
await ctx.mobilityFeePixRequest('status');
assert.match(ctx.mobilityFeePixPanel(),/Pix copia e cola/);

// Switching tabs immediately masks all sensitive payment instructions.
visibility='hidden';events.visibilitychange();
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Pix copia e cola|QR Code Pix|Abrir cobrança no Mercado Pago/);
visibility='visible';events.visibilitychange();
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Pix copia e cola/);

// A late 200 after sign-out / account switch cannot copy old driver charge.
response=valid();
await ctx.mobilityFeePixRequest('status');
let unblock;
response=()=>new Promise(resolve=>unblock=resolve);
const inFlight=ctx.mobilityCopyFeePix();
ctx.mobilityClearSession();
s.user={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
s.program=policy;
unblock({ok:true,json:async()=>({ok:true,charge:valid()})});
await inFlight;
assert.equal(clipboard.length,2);
assert.equal(s.pix,null);
assert.equal(s.pixCopyBusy,false);
console.log('PASS #856: driver mobility fee/prepaid Pix must recheck authenticated provider, mask stale QR/link, debounce copy, isolate sessions.');
