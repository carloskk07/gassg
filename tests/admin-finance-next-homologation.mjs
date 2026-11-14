import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {evaluateFinanceHomologationEvidence} from '../supabase/functions/admin-ops/finance-homologation-evidence.js';
const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const a=source.indexOf('function adminFinanceRealState(){'),b=source.indexOf('function adminFinanceHomologationView(d){',a);
let role='superadmin',selected='advertising',refreshes=0,renders=0;
const actor='11000000-0000-4000-8000-000000000001';
const runtime={status:'ready',section:'finance',session:{user:{id:actor}}};
const evidence={loading:false};
const context=vm.createContext({adminRuntime:runtime,adminReady:()=>true,adminCurrentRole:()=>role,
 adminFinanceWorkspaceCurrent:()=> 'homologation',adminFinanceHomologationEvidenceState:()=>({...evidence,selected}),
 adminFinanceHomologationRefresh:async()=>{refreshes++},render:()=>renders++,
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
 Date,URL,Number,Object,Array,String,Promise,Error,setTimeout:()=>1});
vm.runInContext(source.slice(a,b)+`;this.flow={state:adminFinanceRealState,
 draft:adminFinanceAdsDraftTamao,field:adminFinanceAdsDraftField,
 evidence:adminFinanceMerchantReceiptEvidence,panel:adminFinanceRealPanel};`,context);
const flow=context.flow,state=flow.state();
assert.equal(flow.draft(),true);assert.equal(renders,1);
assert.equal(state.adsDraft.advertiser,'TAMÃO');
assert.equal(state.adsDraft.destination,'https://tamao.com.br/');
assert.equal(refreshes,0,'prefill must not submit, approve, charge or call a service');
flow.field('title','Minha campanha revisada');flow.field('destination','');
state.loadedKey='advertising';state.data={mine:{rows:[]}};
let html=flow.panel('advertising');
assert.match(html,/Minha campanha revisada/);assert.match(html,/R\$ 19,90 por 7 dias/);
assert.match(html,/institucional gratuita/);assert.match(html,/Destino HTTPS.*value=""/);
flow.field('title','<img src=x onerror="bad">');
assert.doesNotMatch(flow.panel('advertising'),/<img src=x/,'draft text must remain escaped');
assert.equal(flow.field('__proto__','pollution'),false);
role='readonly';const snapshot=JSON.stringify(state.adsDraft);
assert.equal(flow.draft(),false);assert.equal(JSON.stringify(state.adsDraft),snapshot);
role='superadmin';selected='merchants';
const paid={charge:{id:'33000000-0000-4000-8000-000000000003',status:'completed'},entitlementApplied:false};
assert.equal(flow.evidence(state,paid),false);assert.equal(refreshes,0);
paid.entitlementApplied=true;assert.equal(flow.evidence(state,paid),true);assert.equal(refreshes,1);
assert.equal(flow.evidence(state,paid),false);assert.equal(refreshes,1,'same paid credit refreshes evidence once');
runtime.session.user.id='44000000-0000-4000-8000-000000000004';
assert.equal(flow.evidence(state,{...paid,charge:{...paid.charge,id:'other'}}),false);
assert.equal(flow.state().adsDraft,undefined,'another actor cannot inherit an advertiser draft');
const keys=['coupons','mobility','merchants','orders','advertising','benefits','professional_ads'];
const modules=keys.map(key=>({key,counts:key==='merchants'?{events:1,appliedCredits:1}:key==='professional_ads'?{activeTerms:0}:{issuances:3}}));
const signals={couponPaid:1,couponNetVerified:1,mobilityPaid:0,merchantCompleted:1,orderApproved:0,
 adsApproved:0,adsPaymentApproved:0,referralBankEvidence:0,professionalBilledDays:0};
let result=evaluateFinanceHomologationEvidence(modules,signals,[]);
assert.match(result[2].diagnosis.nextAction,/créditos já registrados/);
assert.match(result[2].diagnosis.progressLabel,/Pagamento e crédito registrados/);
assert.match(result[6].diagnosis.nextAction,/configurar/);
assert.equal(result[2].diagnosis.financiallyHomologated,false);
modules[2].counts.appliedCredits=0;
result=evaluateFinanceHomologationEvidence(modules,signals,[]);
assert.match(result[2].diagnosis.nextAction,/mesma ordem/);
assert.doesNotMatch(result[2].diagnosis.progressLabel,/crédito registrados/);
modules[2].counts.appliedCredits=-1;
assert.throws(()=>evaluateFinanceHomologationEvidence(modules,signals,[]),/INVALID_FINANCE_EVIDENCE/);
console.log('PASS: completed receipts are not charged again, evidence refreshes once, own advertiser draft remains local/editable/escaped and no cycle is falsely homologated.');
