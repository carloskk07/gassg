import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const boot=read('js/bootstrap.js');
const server=read('supabase/functions/admin-ops/index.ts');
const start=admin.indexOf('function adminFinanceLabCents(');
const end=admin.indexOf('function adminFinanceWorkspaceCurrent()',start);
assert.ok(start>=0&&end>start,'lab functions exist');
const section=admin.slice(start,end);
const state={preview:null,sandbox:null,amountCents:null,idempotencyKey:null,pending:false,error:null,
 readiness:null,readinessLoading:false,status:null};
const nodes={'admin-finance-lab-value':{value:'12,35'},'admin-finance-lab-kind':{value:'invoice'}};
let requests=[],refreshes=0,confirmation=true;
const ctx=vm.createContext({
  adminRuntime:{financeLab:state,providerHealth:null},adminReady:()=>true,
  adminCurrentRole:()=> 'superadmin',
  adminRoleCanSection:()=>true,
  adminMoney:v=>'R$ '+Number(v/100).toFixed(2),
  formatDateTime:v=>v,
  esc:v=>String(v??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])),
  document:{getElementById:id=>nodes[id]||null},
  render:()=>{refreshes++},confirm:()=>confirmation,
  adminIdempotency:()=> 'lab:test-id-1234567890',
  adminInvoke:async(data,opt)=>{
    requests.push({data,opt});
    if(data.action==='finance-lab-readiness')return {
      ok:true,mode:'sandbox',configured:true,officialTestAmountCents:5000,
      recentTests:[],prerequisites:{distinctToken:true,payerConfigured:true}
    };
    if(data.action==='finance-lab-sandbox-check')return {ok:true,mode:'sandbox',
      orderId:data.orderId,amountCents:5000,orderStatus:'processed',
      paymentStatus:'approved',checkedAt:new Date().toISOString(),credited:false};
    return {ok:true,mode:'sandbox',amountCents:data.amountCents,
      orderId:'ORD01ABC23456789012345',brCode:'012345678901234567890123456789012345',
      reference:'lab-test'};
  },
  toast:()=>{},
  navigator:{clipboard:{writeText:async()=>{}}}
});
vm.runInContext(section+';this.lab={cents:adminFinanceLabCents,preview:adminFinanceLabPreviewFromUi,'+
  'sandbox:adminFinanceLabSandboxPixFromUi,view:adminFinanceLabView,'+
  'readiness:adminFinanceLabReadinessFromUi,check:adminFinanceLabCheckOrderFromUi}',ctx);
assert.equal(ctx.lab.cents('0,01'),1);
assert.equal(ctx.lab.cents('1.234,56'),null,'grouped thousands are deliberately unaccepted to prevent ambiguity');
assert.equal(ctx.lab.cents('999999,99'),99999999);
assert.equal(ctx.lab.cents('1000000,00'),100000000);
assert.equal(ctx.lab.cents('1000000,01'),null);
assert.equal(ctx.lab.cents('-1,00'),null);
ctx.lab.preview();
assert.equal(state.preview.amountCents,1235);
assert.equal(state.preview.kind,'invoice');
assert.equal(requests.length,0,'invoice preview must be zero-impact');
let html=ctx.lab.view({merchantBilling:{providerCharges:[{status:'expired'}],paymentIngress:{activeBillingProvider:'mercadopago'}}});
assert.match(html,/Fatura de exemplo/);
assert.match(html,/NÃO PAGÁVEL/);
assert.match(html,/PIX vencidos/);
assert.match(html,/Gerar Pix oficial de teste \(R\$ 50,00\)/);
await ctx.lab.sandbox();
assert.equal(requests.length,0,'sandbox unavailable before readiness');
assert.match(state.error,/ainda não está configurado/);
await ctx.lab.readiness();
assert.equal(requests.length,1);
assert.equal(state.readiness.configured,true);
await ctx.lab.sandbox();
assert.equal(requests.length,3,'sandbox call plus background readiness refresh');
assert.equal(requests[1].data.action,'finance-lab-sandbox-pix');
assert.equal(requests[1].data.amountCents,5000,'official test amount is fixed');
assert.equal(requests[1].opt.idempotencyKey,'lab:test-id-1234567890');
assert.equal(state.sandbox.mode,'sandbox');
assert.equal(state.sandbox.orderId,'ORD01ABC23456789012345');
assert.match(ctx.lab.view({merchantBilling:{}}),/PIX sandbox/);
await ctx.lab.check('ORD01ABC23456789012345');
assert.equal(state.status.orderStatus,'processed');
assert.equal(state.status.credited,false);
const afterCheck=requests.length;
confirmation=false;
await ctx.lab.sandbox();
assert.equal(requests.length,afterCheck,'declined confirmation cannot call provider');

assert.match(boot,/adminFinanceLabSandboxPixFromUi/);
assert.match(boot,/adminFinanceLabPreviewFromUi/);
assert.match(boot,/adminFinanceLabReadinessFromUi/);
assert.match(boot,/adminFinanceLabCheckOrderFromUi/);
assert.match(admin,/id":"lab","label":"Laboratório"/);
assert.match(server,/action==="finance-lab-sandbox-pix"/);
assert.match(server,/action==="finance-lab-readiness"/);
assert.match(server,/action==="finance-lab-sandbox-check"/);
assert.match(server,/FINANCE_LAB_PIX_TEST_AMOUNT_CENTS=5000/);
assert.match(server,/first_name:"APRO"/);
assert.doesNotMatch(server.slice(server.indexOf("async function adminFinanceLabSandboxPix("),
  server.indexOf("async function billingProviderHealth(")),/expiration_time:"P1D"/,
  'automatic Pix orders must not set manual expiration_time');
assert.match(server,/adminAccess.admin_role\)!=="superadmin"/);
assert.match(server,/MERCADOPAGO_TEST_ACCESS_TOKEN/);
assert.match(server,/FINANCE_LAB_SANDBOX_ENABLED/);
assert.match(server,/new URL\(sandboxUrl\).*sandbox/);
assert.match(server,/validatePixBrCode\(brCode,\{expectedAmountCents:amount\}\)/);
assert.match(server,/action:"finance_lab_sandbox_pix_created"/);
assert.match(server,/platform_admin_audit/);
const sandboxCheck=server.slice(server.indexOf('async function adminFinanceLabCheckSandboxOrder('),
  server.indexOf('async function adminFinanceLabSandboxPix('));
assert.match(sandboxCheck,/\.eq\("actor_user_id",actorId\)/,
  'status lookup must be scoped to the authenticated admin');
assert.match(sandboxCheck,/\.order\("created_at",\{ascending:false\}\)\.limit\(1\)\.maybeSingle\(\)/,
  'repeated idempotent audit rows must not break a status lookup');

assert.doesNotMatch(section,/merchant_billing_payment_requests|merchant_fee_credit_ledger|wallet_entries/);
console.log('PASS admin lab: arbitrary invoice simulation, official sandbox preset, authorization, status');
