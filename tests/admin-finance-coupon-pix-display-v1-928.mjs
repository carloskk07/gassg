import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
new vm.Script(admin,{filename:'admin.js'});
const start=admin.indexOf('function adminFinanceRealState(){');
const end=admin.indexOf('function adminFinanceHomologationView(d){',start);
assert(start>0&&end>start,'real payment Admin functions must be available');
const source=admin.slice(start,end);
const invoice='6a2b8ea8-f58a-4f62-81a7-c4f45891e3f7';
const owner='ab7d70a4-c4d3-4e29-93fd-9e41fc6f29dd';
const code='000201'+('12345678901234567890'.repeat(7))+'6304ABCD';
let history=[{invoiceId:invoice,status:'awaiting_payment',amountCents:890}];
let providerResponse={ok:true,status:'awaiting_payment',amountCents:890,
 pixPayable:true,pixCode:code,paymentUrl:'https://www.mercadopago.com.br/payments/ticket',
 expiresAt:new Date(Date.now()+12*3600_000).toISOString()};
let role='superadmin',selected='coupons',calls=[],qrCalls=[],copied=[];
const runtime={section:'finance',financeWorkspace:'homologation',status:'ready',
 session:{user:{id:owner}}};
const ctx=vm.createContext({
 adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
 adminCurrentRole:()=>role,
 adminFinanceWorkspaceCurrent:()=>runtime.financeWorkspace,
 adminFinanceHomologationEvidenceState:()=>({selected}),
 adminAccessToken:async()=> 'owner-jwt',
 CHAMA_BACKEND:{url:'https://example.test',publishableKey:'public'},
 chamaFetch:async(url,options)=>{
  const body=JSON.parse(options.body);
  calls.push({url,body,headers:options.headers});
  assert.equal(options.headers.Authorization,'Bearer owner-jwt');
  assert.equal(url,'https://example.test/functions/v1/coupon-credit-pix');
  let data;
  if(body.action==='my-vouchers')data={source:'clube_coupon_paid_my_vouchers_v1',purchases:history};
  else if(body.action==='catalog')data={source:'clube_paid_catalog_v1_807',couponSalesEnabled:true,packages:[]};
  else if(body.action==='invoice-status'){
   assert.equal(body.invoiceId,invoice,'read-only status request must reuse the ORIGINAL invoice');
   data=providerResponse;
  }else throw Error('Forbidden write '+body.action);
  return {ok:true,json:async()=>data};
 },
 adminFinanceLabLoadQrEncoder:async()=>true,
 adminFinanceLabLiveQrBlock:proof=>{
  qrCalls.push(proof.brCode);
  return '<div role="img" id="verified-qr">QR do Pix confirmado</div>';
 },
 adminCopyText:(text,label)=>copied.push({text,label}),
 render:()=>{},setTimeout:()=>1,
 Date,URL,String,Number,Math,Object,Array,Promise,Error,Set,
 esc:x=>String(x),toast:()=>{},
 document:{getElementById:()=>null}
});
vm.runInContext(source+
 ';this.live={state:adminFinanceRealState,refresh:adminFinanceRealRefresh,'+
 'view:adminFinanceRealPanel,action:adminFinanceRealAction,'+
 'copy:adminFinanceRealCopyPix,clear:adminFinanceRealClearPayment};',ctx);
assert.equal(calls.length,0,'render never creates payments or even reads PSP');
await ctx.live.refresh();
assert.deepEqual(calls.map(c=>c.body.action),['my-vouchers','catalog','invoice-status'],
 'reopening Admin must recover original verified Pix without creating a new one');
assert.equal(ctx.live.state().payment.pix,code);
const panel=ctx.live.view('coupons');
assert.match(panel,/Pix REAL da fatura original/);
assert.match(panel,/R\$ 8,90/);
assert.match(panel,/id="verified-qr"/);
assert.match(panel,/Pix copia e cola/);
assert.match(panel,/readonly/);
assert.match(panel,/Copiar Pix copia e cola/);
assert.match(panel,/Abrir pagamento ORIGINAL no Mercado Pago/);
assert.deepEqual(qrCalls,[code],'QR must encode EXACT same BR Code as copy/paste');
assert.equal(ctx.live.copy(),true);
assert.equal(copied[0].text,code);
assert.equal(calls.filter(c=>c.body.action==='purchase').length,0);
await ctx.live.action('check',invoice);
assert.equal(calls.at(-1).body.action,'invoice-status',
 'explicit recovery of an existing invoice must NEVER create another one');
assert.equal(ctx.live.state().payment.pix,code);
ctx.live.state().paymentUntil=Date.now()-10;
assert.doesNotMatch(ctx.live.view('coupons'),/id="verified-qr"/,
 'Pix QR and payload must not remain visible after short display lease');
assert.equal(ctx.live.copy(),false,'expired Pix display lease prevents copying');
providerResponse={...providerResponse,pixPayable:false};
await ctx.live.refresh();
assert.equal(ctx.live.state().payment.pix,'');
assert.doesNotMatch(ctx.live.view('coupons'),/id="verified-qr"/,
 'PSP status that is not payable must never show stale Pix');
providerResponse={...providerResponse,pixPayable:true,
 expiresAt:new Date(Date.now()-60_000).toISOString()};
await ctx.live.refresh();
assert.equal(ctx.live.state().payment.pix,'',
 'expired Pix is forbidden even if a stale backend response says payable');
providerResponse={...providerResponse,
 expiresAt:new Date(Date.now()+12*3600_000).toISOString()};
await ctx.live.refresh();
assert.equal(ctx.live.state().payment.pix,code,'fresh provider GET safely recovers Pix');
history=[{invoiceId:invoice,status:'paid',amountCents:890}];
await ctx.live.refresh();
assert.equal(ctx.live.state().payment,null,
 'paid original invoice must erase previously cached payable Pix');
assert(!calls.slice(-2).some(c=>c.body.action==='invoice-status'),
 'paid invoice must not request an unnecessary payable status');
runtime.session={user:{id:'00000000-0000-4000-8000-000000000001'}};
assert.equal(ctx.live.state().payment,null,'owner change isolates all Pix data');
role='readonly';
const before=calls.length;
await ctx.live.refresh();
assert.equal(calls.length,before,'unprivileged Admin cannot consult private payment');
assert.match(read('.github/workflows/audit.yml'),/admin-finance-coupon-pix-display-v1-928\.mjs/,
 'CI must run regression tests for real Pix recovery');
console.log('V1.928 PASS: real existing coupon Pix recovered with QR/copy/original link; no duplicate charge, stale QR, or cross-owner leak.');
