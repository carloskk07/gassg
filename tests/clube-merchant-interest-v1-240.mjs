import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014010000_clube_merchant_interest_v1_240.sql');
const merchantEdge=read('supabase/functions/merchant-ops/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const merchant=read('js/merchant.js');
const acquisition=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const token of [
 'merchant_clube_interest_v1_240','merchant_clube_interest_events_v1_240',
 'check(funding_verified=false)','check(sponsor_contract_approved=false)',
 'check(discount_enabled=false)','enable row level security',
 'revoke all on public.merchant_clube_interest_v1_240',
 'grant select on public.merchant_clube_interest_v1_240 to service_role',
 'member_role in (\'owner\',\'manager\')',
 'CLUBE_MERCHANT_DENIED','CLUBE_STALE_VERSION','CLUBE_IDEMPOTENCY_CONFLICT',
 'CLUBE_CITY_UNCONFIRMED','pg_advisory_xact_lock',
 'request_signature is distinct from v_signature',
 "p_expected_version<>v_old_version",
 'case when v_changed then 1 else 0 end',
 'public.admin_clube_interest_queue_v1_240',
 "sponsorFundingConfirmedCents',0","'couponSalesEnabled',false",
 "noFinancialObligation',true"
])assert.ok(sql.includes(token),'Missing migration safety: '+token);
assert.ok(!/(insert into|update|delete from)\s+public\.(orders|merchant_fee_credit_ledger|merchant_billing_accounts|merchant_daily_statements|order_items)/i.test(sql),
  'No money or order writes allowed');
for(const token of [
 '"clube-interest"','if(action==="clube-interest")',
 'merchant_clube_interest_v1_240','expectedVersion','UUID_RE.test(requestId)',
 'data?.discountEnabled!==false','data?.noContract!==true'
])assert.ok(merchantEdge.includes(token),'Missing Merchant API check: '+token);
for(const token of [
 '"clube-interest-queue"','if(action==="clube-interest-queue")',
 'admin_clube_interest_queue_v1_240','data?.noContractsApproved!==true',
 'data?.sponsorFundingConfirmedCents!==0'
])assert.ok(adminEdge.includes(token),'Missing Admin API check: '+token);
for(const token of [
 'merchantClubeInterestSection(m)','merchantClubeInterestCall(',
 'merchantClubeInterestRegisterFromUi','merchantClubeInterestWithdrawFromUi',
 'clube-consent-','merchantId!==merchantId',
 'noFinancialObligation!==true'
])assert.ok(merchant.includes(token),'Missing merchant UI: '+token);
for(const token of [
 'adminClubeInterestSection()','adminClubeInterestLoadFromUi()',
 'Intenções registradas','Patrocínio comprovado'
])assert.ok(acquisition.includes(token),'Missing admin UI: '+token);
assert.ok(boot.includes('merchantClubeInterestRegisterFromUi'));
assert.ok(boot.includes('merchantClubeInterestWithdrawFromUi'));
assert.ok(boot.includes('adminClubeInterestLoadFromUi'));
assert.ok(audit.includes('node tests/clube-merchant-interest-v1-240.mjs'));
new vm.Script(merchant,{filename:'merchant.js'});
new vm.Script(acquisition,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
function extract(text,name){
 const start=text.indexOf('function '+name+'(');
 const end=text.indexOf('\n}',start);
 assert.ok(start>=0&&end>start);
 return text.slice(start,end+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fakeId='11111111-1111-4111-8111-111111111111';
const rt={merchant:{merchantId:fakeId,memberRole:'owner'}};
const mCtx=vm.createContext({globalThis:{merchantRuntime:rt},esc,String,Number});
vm.runInContext(extract(merchant,'merchantClubeInterestSection')+
 '\nthis.clubeView=merchantClubeInterestSection;',mCtx);
let html=mCtx.clubeView(rt.merchant);
assert.ok(html.includes('Registrar')===false); // button is 'Salvar interesse'
assert.ok(html.includes('Salvar interesse'));
assert.ok(html.includes('Não constitui')===false);
assert.ok(html.includes('não estão à venda'));
rt.clubeInterest={merchantId:fakeId,gas_3x5:{source:'merchant_clube_interest_v1_240',
 interested:true,merchantShareBps:5000,proposedBudgetCents:10000,
 city:'"><img src=x onerror=alert(1)>',state:'RS'}};
html=mCtx.clubeView(rt.merchant);
assert.ok(html.includes('&lt;img'));
assert.ok(!html.includes('src=x onerror=alert(1)>'));
assert.ok(html.includes('Interesse registrado'));
assert.equal(mCtx.clubeView({merchantId:fakeId,memberRole:'driver'}),'');
const state={session:{user:{id:fakeId}}};
const aCtx=vm.createContext({adminRuntime:state,adminCurrentRole:()=> 'finance',
 esc,String,Number,adminMoney:v=>'R$ '+(v/100).toFixed(2)});
vm.runInContext(extract(acquisition,'adminClubeInterestSection')+
 '\nthis.view=adminClubeInterestSection;',aCtx);
assert.ok(aCtx.view().includes('Nenhum orçamento está reservado'));
console.log('V1.240 PASS — interest-only controls, versioning/idempotency, scoped roles, UI escaped and no checkout coupling.');
