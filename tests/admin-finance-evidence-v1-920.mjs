import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const helper=read('supabase/functions/admin-ops/finance-homologation-evidence.js');
const ui=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const ctx=vm.createContext({Set,Array,Number,Error,Object,String});
vm.runInContext(helper.replace(/^export /gm,'')+
 ';this.assess=evaluateFinanceHomologationEvidence;',ctx);
const labels=['coupons','mobility','merchants','orders','advertising','benefits','professional_ads'];
const signals={
 couponPaid:0,couponNetVerified:0,mobilityPaid:0,merchantCompleted:0,
 orderApproved:0,adsApproved:0,adsPaymentApproved:0,
 referralBankEvidence:0,professionalBilledDays:0
};
const records=()=>[
 {key:'coupons',configured:true,counts:{invoices:0,issuances:0,refunds:0}},
 {key:'mobility',configured:true,counts:{plans:3,invoices:0,providerEvidence:0,lots:0}},
 {key:'merchants',configured:false,counts:{charges:0,events:0}},
 {key:'orders',configured:false,counts:{attempts:0,verifications:0}},
 {key:'advertising',configured:false,counts:{checkouts:0,paymentEvents:0,refunds:0}},
 {key:'benefits',configured:false,counts:{payoutClaims:0,providerObservations:0,mobilityWelcomeUses:0}},
 {key:'professional_ads',configured:false,counts:{billedDays:0}}
];
const run=(change={},items=records(),lab=[])=>ctx.assess(items,{...signals,...change},lab);
let result=run();
assert.deepEqual(Array.from(result,x=>x.key),labels);
assert.ok(result.every(x=>x.diagnosis.state==='pending_real_payment'));
assert.ok(result.every(x=>x.diagnosis.financiallyHomologated===false));
assert.ok(result.every(x=>x.diagnosis.bankSettlementChecked===false));
assert.ok(result.every(x=>x.diagnosis.gatewayLabIsCommercialProof===false));
assert.ok(result.every(x=>x.diagnosis.labPixCount===0));

result=run({},records(),[{testPurpose:'coupons',amountCents:200,webhookEvidence:'psp_processed'}]);
assert.equal(result[0].diagnosis.labPixCount,1);
assert.equal(result[0].diagnosis.latestLabWebhook,'psp_processed');
assert.equal(result[0].diagnosis.state,'pending_real_payment',
 'PSP sandbox/lab callback cannot complete coupon sale or create balance');
assert.equal(result[1].diagnosis.labPixCount,0);
result=run({},records(),[{testPurpose:'coupons',amountCents:200,webhookEvidence:'reversal'}]);
assert.equal(result[0].diagnosis.latestLabWebhook,'reversal');
assert.equal(result[0].diagnosis.financiallyHomologated,false);

result=run({couponPaid:1});
assert.equal(result[0].diagnosis.state,'needs_review',
 'paid coupon invoice with no issued coupon needs review');
let coupons=records();coupons[0].counts.issuances=3;
result=run({couponPaid:1,couponNetVerified:1},coupons);
assert.equal(result[0].diagnosis.state,'provider_or_ledger_evidence');
assert.equal(result[0].diagnosis.bankSettlementChecked,false,
 'net entry in database is not independent bank evidence');

result=run({mobilityPaid:1});
assert.equal(result[1].diagnosis.state,'needs_review');
let rides=records();rides[1].counts.providerEvidence=1;
result=run({mobilityPaid:1},rides);
assert.equal(result[1].diagnosis.state,'provider_or_ledger_evidence');
result=run({merchantCompleted:1});
assert.equal(result[2].diagnosis.state,'needs_review');
let merchants=records();merchants[2].counts.events=1;
assert.equal(run({merchantCompleted:1},merchants)[2].diagnosis.state,'provider_or_ledger_evidence');
assert.equal(run({orderApproved:1})[3].diagnosis.state,'needs_review');
let orders=records();orders[3].counts.verifications=1;
assert.equal(run({orderApproved:1},orders)[3].diagnosis.state,'provider_or_ledger_evidence');
assert.equal(run({adsApproved:1})[4].diagnosis.state,'needs_review');
assert.equal(run({adsApproved:1,adsPaymentApproved:1})[4].diagnosis.state,
 'provider_or_ledger_evidence');
assert.equal(run({referralBankEvidence:1})[5].diagnosis.financiallyHomologated,false);
assert.equal(run({professionalBilledDays:1})[6].diagnosis.financiallyHomologated,false);
for(const invalid of [
 {...signals,couponPaid:-1}, {...signals,mobilityPaid:1.25},
 {...signals,adsApproved:undefined}
])assert.throws(()=>ctx.assess(records(),invalid,[]),/INVALID_FINANCE_EVIDENCE/);
for(const bad of [
 {testPurpose:'not-a-module',amountCents:200,webhookEvidence:'pending'},
 {testPurpose:'coupons',amountCents:0,webhookEvidence:'psp_processed'},
 {testPurpose:'coupons',amountCents:200,webhookEvidence:'bank_settled'}
])assert.throws(()=>run({},records(),[bad]),/INVALID_FINANCE_LAB_EVIDENCE/);
assert.throws(()=>run({},records().slice(1)),/INVALID_FINANCE_EVIDENCE/);
assert.match(edge,/evaluateFinanceHomologationEvidence\(list,indicatorsCount,labHistory\)/);
assert.match(edge,/adminFinanceLabLiveHistory\(admin,actorId\)/);
assert.match(edge,/FINANCE_HOMOLOGATION_STATUS_UNAVAILABLE/);
assert.match(edge,/\.select\("\*",\{count:"exact",head:true\}\)/);
assert.match(ui,/assessmentVersion!=='v1\.920'/);
assert.match(ui,/finance(?:.{0,40})?Homologation/);
assert.match(ui,/Nenhum homologado automaticamente/);
assert.match(ui,/Próxima verificação:/);
assert.doesNotMatch(helper,/createClient|POST|INSERT|UPDATE|DELETE|MercadoPago|fetch\(/i);
assert.match(read('.github/workflows/audit.yml'),/admin-finance-evidence-v1-920\.mjs/);
console.log('V1.920 PASS: statuses, mismatched evidence, lab ownership, no false homologation, no writes.');
