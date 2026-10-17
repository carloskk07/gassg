import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
new vm.Script(admin,{filename:'js/admin.js'});
for(const required of [
  'invite.application_id===application.id',
  'invite.claimed_user_id===application.applicant_user_id',
  'Boolean(invite.claimed_at)&&Boolean(invite.claimed_user_id)',
  'if(claimedInvite)inviteStatus="claimed";',
  'else if(claimedInvite)nextAction="review_and_convert";',
  'ownerClaimed:Boolean(claimedInvite)',
  '{key:"claim",done:Boolean(claimedInvite),status:claimedInvite?"done":"pending"}'
]) assert.ok(edge.includes(required),'Edge claim proof missing: '+required);
assert.ok(!edge.includes('if(claimedInvite||application)inviteStatus="claimed"'),
  'A submitted application is not a claimed invite');
assert.ok(!edge.includes('claimedInvite?.claimed_user_id||application?.applicant_user_id'),
  'An application owner ID alone cannot signal a claim');

const start=admin.indexOf('function adminPilotApplicationReview(');
const until=admin.indexOf('function adminProductName(',start);
const focus=admin.indexOf('function adminFocusPilotFromApplication(');
const reject=admin.indexOf('async function adminRejectApplication(',focus);
assert.ok(start>0&&until>start&&focus>until&&reject>focus);
const source=admin.slice(start,until)+'\n'+admin.slice(focus,reject);
const html=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const application={
  id:'application-id',pilot_partner_draft_id:'pilot-id',company_name:'Empresa <script>',
  cnpj:'12345678901234',responsible_name:'Ana',phone:'555555',
  address_text:'Rua Principal',status:'pending',created_at:new Date().toISOString()
};
const claimed={
  id:'pilot-id',display_name:'Piloto & Filhos',onboarding_status:'ready_for_review',
  onboarding:{application:{id:'application-id'},ownerClaimed:true,
    inviteClaimedAt:new Date().toISOString()}
};
const runtime={data:{applications:[application],pilotPartners:[claimed]},
  status:'ready',lastSyncAt:new Date().toISOString()};
let calls=[],messages=[],approved=true,scrolled=0,focused=0,commits=0;
const context=vm.createContext({
  adminRuntime:runtime,Date,String,Number,Array,
  esc:html,adminStatusPill:s=>'<span>'+s+'</span>',
  adminPerform:async(action,payload)=>{calls.push({action,payload});return {ok:true};},
  toast:text=>messages.push(text),
  confirm:text=>{commits++;return approved;},
  document:{getElementById:()=>({focus:()=>focused++,scrollIntoView:()=>scrolled++})}
});
vm.runInContext(source+
  '\nthis.review=adminPilotApplicationReview;this.card=adminApplicationCard;'+
  'this.approve=adminApproveApplication;this.focusPilot=adminFocusPilotFromApplication;',context);
assert.equal(context.review(application).ready,true);
const card=context.card(application);
assert.ok(card.includes('Vínculo com parceiro piloto'));
assert.ok(card.includes('Piloto &amp; Filhos'));
assert.ok(card.includes('Empresa &lt;script&gt;'));
assert.ok(card.includes('Ver cadastro piloto'));
assert.ok(!card.includes('<script>'));
context.focusPilot('application-id');
assert.equal(focused,1);
assert.equal(scrolled,1);
await context.approve('application-id');
assert.equal(calls.length,1);
assert.equal(calls[0].action,'approve-application');
assert.equal(calls[0].payload.applicationId,'application-id');
assert.equal(commits,1);

const rejectCase=async(pilot,pattern)=>{
  runtime.data.pilotPartners=pilot?[pilot]:[];
  const prev=calls.length;
  await context.approve('application-id');
  assert.equal(calls.length,prev);
  assert.ok(messages.some(m=>m.includes(pattern)),'Expected block reason: '+pattern);
};
await rejectCase(null,'não carregado');
await rejectCase({...claimed,onboarding:{...claimed.onboarding,ownerClaimed:false}},'reivindicação');
await rejectCase({...claimed,onboarding:{...claimed.onboarding,application:{id:'different'}}},'divergente');
await rejectCase({...claimed,onboarding_status:'converted'},'convertido');
await rejectCase({...claimed,onboarding_status:'cancelled'},'cancelado');

runtime.data.pilotPartners=[claimed];
runtime.lastSyncAt=new Date(Date.now()-6*60000).toISOString();
const oldCalls=calls.length;
await context.approve('application-id');
assert.equal(calls.length,oldCalls);
assert.ok(messages.some(m=>m.includes('Atualize o painel')));
runtime.lastSyncAt=new Date().toISOString();
approved=false;
await context.approve('application-id');
assert.equal(calls.length,oldCalls,'Cancel must not approve');

approved=true;
runtime.data.applications=[{...application,pilot_partner_draft_id:null}];
await context.approve('application-id');
assert.equal(calls.length,oldCalls+1,'Ordinary approval is still available');
runtime.data.applications=[{...application,status:'approved'}];
await context.approve('application-id');
assert.equal(calls.length,oldCalls+1,'Already approved application must not submit again');
assert.ok(read('.github/workflows/audit.yml').includes(
  'node tests/pilot-claim-evidence-v1-402.mjs'));
console.log('V1.402: matched pilot claim, no phantom readiness, safe review and approval.');
