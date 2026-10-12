import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
const css=read('css/components.css');
new vm.Script(source,{filename:'js/admin.js'});
function cut(name){
 const a=source.indexOf('function '+name+'(');
 assert.ok(a>=0,'Function missing: '+name);
 const b=source.indexOf('\n}',a);
 assert.ok(b>a,'Closing brace missing '+name);
 return source.slice(a,b+2);
}
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const now=Date.now(),minutes=n=>new Date(now-n*60000).toISOString();
const order={id:uuid(1),public_code:'TAM-HIST',status:'CANCELLED'};
const approved={id:uuid(2),order_id:uuid(1),merchant_id:uuid(4),
 status:'approved',provider:'mercadopago',amount_cents:11990,
 created_at:minutes(60),approved_at:minutes(60),updated_at:minutes(60)};
const rt={
 status:'ready',session:{id:'sessionA'},saleRefundFilter:'all',
 data:{merchantPayments:{attempts:[],interruptedOrders:[],reviewSampleLimited:true}},
 salePaymentHistory:{
  attempts:[approved],interruptedOrders:[order],nextCursor:null,
  hasMore:false,loading:false,error:null,started:true,checkedAt:minutes(4)
 }
};
let role='finance',renders=0,refreshes=0,loads=0,shouldFail=false;
const ctx=vm.createContext({
 adminRuntime:rt,adminCurrentRole:()=>role,
 render:()=>{renders++},esc,adminMerchantName:()=> 'Revenda',
 adminBillingProviderName:()=> 'Mercado Pago',
 adminMoney:c=>'R$ '+(c/100).toFixed(2).replace('.',','),
 formatDateTime:()=> '12/10/2026 16:00',
 adminRefresh:async()=>{
  refreshes++;
  if(shouldFail)throw new Error('NETWORK');
  return rt.data;
 },
 adminLoadSalePaymentHistory:async()=>{loads++;}
});
const get=['adminSalePaymentHistoryIsFresh','adminInterruptedSalePaymentUrgency',
 'adminInterruptedSalePaymentRows','adminInterruptedSalePaymentWatch'];
vm.runInContext(get.map(cut).join('\n')+
 ';this.isFresh=adminSalePaymentHistoryIsFresh;this.rows=adminInterruptedSalePaymentRows;'+
 'this.watch=adminInterruptedSalePaymentWatch;',ctx);
vm.runInContext('async '+cut('adminRevalidateSalePaymentHistory')+
 ';this.recheck=adminRevalidateSalePaymentHistory;',ctx);
assert.equal(ctx.isFresh(rt.salePaymentHistory,now),true);
assert.equal(ctx.rows(rt.data).length,1);
let html=ctx.watch(rt.data);
assert.ok(html.includes('TAM-HIST'));
assert.ok(html.includes('Histórico consultado em'));
assert.ok(html.includes('As situações do provedor podem mudar'));
assert.ok(html.includes('Revalidar histórico'));
assert.ok(html.includes('1 PARA CONFERIR'));
rt.salePaymentHistory.checkedAt=minutes(11);
assert.equal(ctx.isFresh(rt.salePaymentHistory,now),false);
assert.equal(ctx.rows(rt.data).length,0,'Expired historical evidence must not create active PSP alarms');
html=ctx.watch(rt.data);
assert.ok(html.includes('Histórico antigo desatualizado'));
assert.ok(html.includes('retiradas dos indicadores'));
assert.ok(!html.includes('TAM-HIST'));
assert.ok(html.includes('0 PARA CONFERIR'));
assert.ok(!html.includes('Consultar tentativas mais antigas'),'Do not append to expired cursor');
assert.ok(html.includes('Revalidar histórico'));
for(const checkedAt of ['bad-date',minutes(-30)]){
 rt.salePaymentHistory.checkedAt=checkedAt;
 assert.equal(ctx.isFresh(rt.salePaymentHistory,now),false);
}
rt.salePaymentHistory.checkedAt=minutes(4);
assert.equal(ctx.rows(rt.data).length,1);

rt.data.merchantPayments.attempts=[{...approved,status:'refunded',refunded_at:minutes(2)}];
rt.data.merchantPayments.interruptedOrders=[order];
assert.equal(ctx.rows(rt.data).length,1);
assert.equal(ctx.rows(rt.data)[0].kind,'refunded',
 'Most recent PSP snapshot must override older approval with the same attempt ID');
rt.data.merchantPayments.attempts=[];
rt.data.merchantPayments.interruptedOrders=[];
rt.data.controlOrders=[{...order,status:'OUT_FOR_DELIVERY'}];
assert.equal(ctx.rows(rt.data).length,0,
 'Newer live order status must prevent old cancelled classification');
rt.data.controlOrders=[];
assert.equal(ctx.rows(rt.data).length,1);
rt.salePaymentHistory.checkedAt=minutes(15);
rt.data.merchantPayments.attempts=Array.from({length:500},(_,i)=>({
 id:uuid(i+10000),created_at:minutes(1),status:'not_started'
}));
await ctx.recheck();
assert.equal(refreshes,1,'Explicit revalidation must refresh summary');
assert.equal(loads,1,'Full 500 sample initiates fresh historical scan');
assert.equal(rt.salePaymentHistory.attempts.length,0,'Previous snapshot cleared on revalidation');
assert.equal(rt.salePaymentHistory.started,false);
assert.equal(rt.salePaymentHistory.checkedAt,null);
assert.equal(rt.salePaymentHistory.error,null);
assert.ok(renders>=1);
rt.salePaymentHistory={attempts:[approved],interruptedOrders:[order],
 nextCursor:null,hasMore:false,loading:false,error:null,started:true,checkedAt:minutes(20)};
rt.data.merchantPayments.attempts=[];
await ctx.recheck();
assert.equal(refreshes,2);
assert.equal(loads,1,'No archive fetch needed below 500 attempts');
assert.equal(rt.salePaymentHistory.attempts.length,0);
rt.salePaymentHistory={attempts:[approved],interruptedOrders:[order],
 nextCursor:null,hasMore:false,loading:false,error:null,started:true,checkedAt:minutes(20)};
shouldFail=true;
await ctx.recheck();
assert.equal(refreshes,3);
assert.equal(rt.salePaymentHistory.attempts.length,1,'Failed refresh preserves previous evidence for later retry');
assert.ok(rt.salePaymentHistory.error.includes('NETWORK'));
assert.equal(ctx.rows(rt.data).length,0,'Stale evidence remains excluded after failed revalidation');
shouldFail=false;
role='operations';
await ctx.recheck();
assert.equal(refreshes,3,'Unauthorized operations cannot revalidate finance evidence');
role='finance';
rt.status='unauthenticated';
await ctx.recheck();
assert.equal(refreshes,3,'Signed-out admin cannot query historical payments');
rt.status='ready';
rt.salePaymentHistory.loading=true;
await ctx.recheck();
assert.equal(refreshes,3,'Loading lock prevents competing refreshes');

assert.ok(source.includes('checkedAt:existing.checkedAt||new Date().toISOString()'));
assert.ok(source.includes('const orders=new Map([...archived.interruptedOrders||[],...payments.interruptedOrders||[],...(d?.controlOrders||[])]'));
assert.ok(css.includes('.admin-sale-history-freshness'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-evidence-freshness-v1-185.mjs'));
console.log('V1.185: no stale alerts, newer PSP/order authority, timestamp validation, guarded refresh and finance-only recheck passed.');
