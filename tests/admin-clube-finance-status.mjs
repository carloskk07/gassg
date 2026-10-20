import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
new vm.Script(admin,{filename:'js/admin.js'});
assert.match(edge,/if\(action==="clube-coupon-finance-status"\)/);
assert.match(edge,/if\(action==="clube-coupon-mp-release-reports"\)/);
assert.match(edge,/mercadoPagoFetch\("\/v1\/account\/release_report\/list"/);
assert.match(edge,/Deno\.env\.get\("MERCADOPAGO_ACCESS_TOKEN"\)/);
assert.match(edge,/moneyVerified:false/);
assert.match(edge,/\["superadmin","finance"\]/);
assert.doesNotMatch(edge.slice(edge.indexOf('if(action==="clube-coupon-mp-release-reports")'),
 edge.indexOf('if(action==="clube-coupon-finance-status")')),
 /mercadoPagoFetch\([^;]*method:"POST"/,
 'release reports must be read-only');
assert.match(edge,/\["superadmin","finance"\]/);
assert.match(edge,/clube_coupon_paid_order_reconciliation/);
assert.match(edge,/paymentsChecked:false/);
assert.match(edge,/COUPON_FINANCE_SCHEMA_NOT_INSTALLED/);
assert.match(edge,/COUPON_CHECKOUT_SCHEMA_INCOMPLETE/);
assert.match(admin,/\$\{adminClubeFinanceView\(\)\}/);
const begin=admin.indexOf('async function adminClubeFinanceRefresh(){');
const end=admin.indexOf('function adminClubeCouponPreviewView(){',begin);
assert.ok(begin>=0&&end>begin);

let role='finance';
let calls=0,mpCalls=0,renders=0,payload=null,fail=false,
 mpPayload=null,mpFail=false;
let current='11111111-1111-4111-8111-111111111111';
const runtime={
 status:'ready',session:{user:{id:current}},
 clubeFinance:{data:null,pending:false,error:null,loadedFor:null,checkedAt:null,
  reports:null,reportsPending:false,reportsError:null,reportsFor:null,reportsAt:null}
};
const state={
 adminRuntime:runtime,
 adminCurrentRole:()=>role,
 adminInvoke:async({action})=>{
   if(action==='clube-coupon-mp-release-reports'){
     mpCalls++;
     if(mpFail)throw Error('mercadopago-offline');
     return mpPayload;
   }
   assert.equal(action,'clube-coupon-finance-status');
   calls++;
   if(fail)throw Error('not-available');
   return payload;
 },
 render:()=>{renders++},
 esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 Date,Number,Object,String,Array
};
const ctx=vm.createContext(state);
vm.runInContext(admin.slice(begin,end)+
 ';this.query=adminClubeFinanceRefresh;this.page=adminClubeFinanceView;'+
 ';this.mpQuery=adminClubeReleaseReportsRefresh;this.mpPage=adminClubeReleaseReportsView;',ctx);

assert.match(ctx.page(),/Conferir situação dos cupons/);
payload={source:'clube_coupon_finance_status_v1',readOnly:true,
 schemaInstalled:false,coverage:'unavailable',salesEnabled:false,
 checkoutEnabled:false,paymentsChecked:false,reason:'COUPON_FINANCE_SCHEMA_NOT_INSTALLED'};
await ctx.query();
assert.equal(calls,1);
assert.match(ctx.page(),/Cupons pagos ainda não instalados/);
assert.doesNotMatch(ctx.page(),/Pacotes cadastrados<\/small><strong>0/);

payload={source:'clube_coupon_finance_status_v1',readOnly:true,
 schemaInstalled:true,coverage:'bounded_under_limits',
 salesEnabled:false,checkoutEnabled:false,paymentsChecked:false,
 packageCount:1,invoiceCount:3,voucherCount:6,issuedCount:2,
 redeemedCount:4,pendingNetCount:1,refundReviewCount:2,
 merchantSettlementPendingCount:1};
await ctx.query();
assert.match(ctx.page(),/Pacotes cadastrados/);
assert.match(ctx.page(),/Faturas de cupons/);
assert.match(ctx.page(),/Obrigações de revendas pendentes/);
assert.match(ctx.page(),/não confere o extrato de liberação/);
assert.ok(renders>0);
payload.coverage='partial';
await ctx.query();
assert.match(ctx.page(),/Informação incompleta/);
assert.doesNotMatch(ctx.page(),/Pacotes cadastrados<\/small><strong>1/);
payload.readOnly=false;
await ctx.query();
assert.match(ctx.page(),/A consulta financeira não retornou dados verificáveis/);
payload.readOnly=true;
fail=true;
await ctx.query();
assert.match(ctx.page(),/not-available/);
fail=false;
role='readonly';
const oldCalls=calls;
await ctx.query();
assert.equal(calls,oldCalls);
assert.equal(ctx.page(),'');
role='finance';
runtime.session.user.id='22222222-2222-4222-8222-222222222222';
assert.doesNotMatch(ctx.page(),/not-available/);
assert.match(ctx.page(),/Use a consulta/);
assert.match(ctx.mpPage(),/Consultar relatórios do Mercado Pago/);
mpPayload={source:'mercadopago_release_reports_list_v1',readOnly:true,
 available:false,coverage:'unavailable',moneyVerified:false,reports:[]};
await ctx.mpQuery();
assert.equal(mpCalls,1);
assert.match(ctx.mpPage(),/não configurada/);
mpPayload={source:'mercadopago_release_reports_list_v1',readOnly:true,
 available:true,coverage:'list_only',moneyVerified:false,listedCount:2,
 reports:[{status:'processed',currency:'BRL',test:false},
 {status:'processed',currency:null,test:true}]};
await ctx.mpQuery();
assert.match(ctx.mpPage(),/2 relatórios listados/);
assert.match(ctx.mpPage(),/1 processados em BRL/);
assert.match(ctx.mpPage(),/não confirma o PIX líquido/);
mpPayload.coverage='partial';
await ctx.mpQuery();
assert.match(ctx.mpPage(),/Lista parcial/);
mpPayload.moneyVerified=true;
await ctx.mpQuery();
assert.match(ctx.mpPage(),/Resposta de extratos não verificada/);
mpPayload.moneyVerified=false;
mpFail=true;
await ctx.mpQuery();
assert.match(ctx.mpPage(),/mercadopago-offline/);
mpFail=false;
role='readonly';
const oldMpCalls=mpCalls;
await ctx.mpQuery();
assert.equal(mpCalls,oldMpCalls);
assert.equal(ctx.mpPage(),'');
role='finance';
runtime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.doesNotMatch(ctx.mpPage(),/mercadopago-offline/);
assert.doesNotMatch(ctx.mpPage(),/2 relatórios listados/);
console.log('PASS: admin coupon finance and MP releases read-only, role and account isolation.');
