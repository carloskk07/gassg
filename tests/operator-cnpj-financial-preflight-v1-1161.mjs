import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261123120000_platform_operator_financial_preflight_v1_1161.sql');
const edge=read('supabase/functions/operator-transition-ops/index.ts');
const admin=read('js/admin-operator-transition.js');
const audit=read('.github/workflows/audit.yml');
const ci=read('.github/workflows/isolated-supabase-integration.yml');
const evidence=[
 ['manual_payout','network_manual_payout_requests_v1_1034'],
 ['payout_executor','network_payout_jobs_v1_1033'],
 ['network_reservations','network_fee_payout_reservations_v1_1031'],
 ['ads_refunds','ads_independent_refund_cases_v1_887'],
 ['clube_refunds','clube_coupon_refund_requests_v1_814'],
 ['agenda_refunds','agenda_payment_refunds'],
 ['merchant_refunds','merchant_billing_payment_refunds']
];
assert.ok(migration.includes('platform_operator_financial_preflight_v1_1161(p_actor uuid)'));
assert.ok(migration.includes('perform public.platform_operator_transition_assert_owner_v1_1159(p_actor)'));
assert.ok(migration.includes("'externalReconciliationVerified',false"));
assert.ok(migration.includes("'moneyMoved',false"));
for(const [key,table] of evidence){
 assert.ok(migration.includes("'key','"+key+"'"),key);
 assert.ok(migration.includes('public.'+table),table);
}
assert.ok(migration.includes("state not in ('paid','rejected','refunded','cancelled')"),
 'Unknown/open Pix states must block identity migration');
assert.ok(migration.includes("status in ('submitted','reviewing')"),'Disputed ads are not final');
assert.ok(migration.includes("status in ('requested','processing','failed')"),
 'Failed Agenda refunds still require review');
assert.ok(migration.includes("status='review_required'"),
 'Merchant refund contests must block cutover');
assert.ok(migration.includes("revoke all on function public.platform_operator_financial_preflight_v1_1161(uuid)"));
assert.ok(migration.includes("grant execute on function public.platform_operator_financial_preflight_v1_1161(uuid)"));
assert.match(migration,/platform_operator_financial_preflight_v1_1161\(p_actor\)->>'blockerCount'/);
assert.match(migration,/OPERATOR_TRANSITION_FINANCIAL_ITEMS_OPEN/);
assert.ok(!/update public\.(?:network_|merchant_|clube_|agenda_|ads_)/i.test(migration),
 'Cutover readiness must not mutate financial records');
assert.ok(edge.includes('financialPreflight:preflight'));
assert.ok(edge.includes('data.readyToActivate===true&&preflight.blockerCount===0'));
assert.ok(edge.includes('preflight?.moneyMoved!==false'));
assert.ok(edge.includes('preflight?.externalReconciliationVerified!==false'));
assert.ok(admin.includes('3. Conferência financeira automática'));
assert.ok(admin.includes('preflight.checks.map'));
assert.ok(admin.includes('d.readyToActivate===true&&blockers===0'));
assert.ok(ci.includes('tests/sql/operator-cutover-financial-preflight-v1-1161.sql'));
assert.ok(audit.includes('node tests/operator-cnpj-financial-preflight-v1-1161.mjs'));
new vm.Script(admin,{filename:'js/admin-operator-transition.js'});

const user={id:'00000000-0000-4000-8000-000000000001'};
const ctx=vm.createContext({
 adminReady:()=>true,adminCurrentRole:()=> 'superadmin',
 adminRuntime:{session:{user}},
 esc:x=>String(x),render:()=>{},toast:()=>{},
 document:{getElementById:()=>null},
 CHAMA_BACKEND:{url:'https://isolated.invalid',publishableKey:'public'},
 adminAccessToken:async()=> 'jwt',
 chamaFetch:async()=>{throw Error('No live financial request in test');}
});
vm.runInContext(admin,ctx);
vm.runInContext('adminOperatorSession()',ctx);
const makeData=count=>({
 stage:'draft',revision:5,readyToActivate:true,currentEntityKind:'individual',
 candidate:{cnpj:'11222333000181',legalName:'CNPJ validado em futuro teste',
  tradeName:'Empresa demonstrativa',publicAddress:'Rua qualquer, Brasil',
  contactEmail:'email@example.invalid'},
 verifiedGates:12,totalGates:12,
 gates:Array.from({length:12},(_,i)=>({key:'g'+i,title:'Documento '+i,verified:true})),
 financialPreflight:{
  source:'platform_operator_financial_preflight_v1_1161',readOnly:true,
  moneyMoved:false,pspChanged:false,blockerCount:count,
  checkedAt:'2026-11-23T12:00:00Z',
  checks:evidence.map(([key],i)=>({key,title:'Conferência '+key,count:i===0?count:0}))
 }
});
ctx.adminEvidence=makeData(0);
vm.runInContext('adminOperatorState.data=adminEvidence',ctx);
assert.ok(vm.runInContext('adminOperatorPanel()',ctx).includes('Confirmar virada para PJ'),
 'Only zero internal blockers and 12 external checks can enable final confirmation');
ctx.adminEvidence=makeData(2);
vm.runInContext('adminOperatorState.data=adminEvidence',ctx);
const blocked=vm.runInContext('adminOperatorPanel()',ctx);
assert.ok(!blocked.includes('>Confirmar virada para PJ</button>'),
 'Even stale readyToActivate from v1159 must fail closed with live finance blockers');
assert.ok(blocked.includes('2 pendência(s) interna(s)'));
assert.ok(blocked.includes('Conferência financeira automática'));
console.log('V1.1161 PASS: seven internal financial checks, server-side block and superadmin-only readiness.');
