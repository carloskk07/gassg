import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js'),acq=read('js/admin-acquisition.js');
assert.doesNotThrow(()=>new vm.Script(admin),'Admin script should parse');
assert.doesNotThrow(()=>new vm.Script(acq),'Admin acquisition script should parse');
const discovery=admin.slice(admin.indexOf('/* TAMÃO Discovery: one moderation workspace'),
 admin.indexOf('const ADMIN_SECTION_ROLES='));
assert.ok(discovery.length>13000,'Discovery moderation source must be present');
assert.doesNotMatch(discovery,/prompt\(/,'No blocking manual prompt in Discovery moderation');
for(const key of ['admin-discovery-decision-','admin-discovery-report-action-',
 'admin-discovery-live-reason-','admin-discovery-city-action',
 'admin-discovery-city-existing','admin-discovery-proof-','adminDiscoverySubmitCity',
 'adminDiscoverySubmitReport','adminDiscoverySubmitListing']){
 assert.ok(discovery.includes(key),'Missing marked operation '+key);
}
for(const unsafe of ['adminDiscoveryDecision','adminDiscoveryChangeLive',
 'adminDiscoverySuspendReportedListing','adminDiscoveryReviewReport','adminDiscoverySetCity']){
 assert.match(discovery,new RegExp('(?:async )?function '+unsafe+'\\('));
}
assert.match(discovery,/status==='published'&&document\.getElementById\('admin-discovery-proof-'/);
assert.match(discovery,/selectedReportId===null\|\|Number\(x\.id\)===selectedReportId/);
const marked=new Map(),nodes=new Map(),events=[];
const doc={
 querySelector:q=>{
  const group=/^input\[name="([^"]+)"\]:checked$/.exec(q)?.[1];
  return group?marked.get(group)||null:null;
 },
 getElementById:id=>nodes.get(id)||null
};
const ctx={
 document:doc,adminReady:()=>true,adminCurrentRole:()=>ctx.role,role:'superadmin',
 adminRuntime:{section:'discovery',client:{}},
 esc:x=>String(x).replaceAll('<','&lt;').replaceAll('"','&quot;'),
 toast:m=>events.push(['toast',m]),render:()=>{},console,
 CHAMA_BACKEND:{url:'https://project.supabase.co'}
};
vm.createContext(ctx);
vm.runInContext(discovery+'\nthis.selectedReason=adminDiscoverySelectedReason;'+
 'this.markedChoice=adminMarkedChoice;',ctx);
assert.equal(ctx.selectedReason('test','published','custom'),null,
 'No radio mark must not authorize action');
marked.set('test',{value:'rejected',dataset:{reason:'Rejeitar: documentação não suficiente.'}});
assert.equal(ctx.selectedReason('test','published','custom'),null,
 'Wrong marked action must not be accepted');
marked.set('test',{value:'published',dataset:{reason:'Documentação e condições conferidas antes de aprovação.'}});
assert.equal(ctx.selectedReason('test','published','custom'),
 'Documentação e condições conferidas antes de aprovação.');
nodes.set('custom',{value:'Detalhes específicos comprovados para esta decisão.'});
assert.equal(ctx.selectedReason('test','published','custom'),
 'Detalhes específicos comprovados para esta decisão.');
nodes.set('custom',{value:'x'.repeat(300)});
assert.equal(ctx.selectedReason('test','published','custom'),null,
 'Long notes must still be rejected');
nodes.delete('custom');
assert.match(discovery,/onchange="if\(this\.value!==/);
assert.doesNotMatch(discovery,/onclick="adminDiscoverySetCity\(true\)"/,
 'No free-form city activation button bypassing explicit choice');

// Growth referral decisions: audited preset text, but no fabricated documentary evidence.
const growth=acq.slice(acq.indexOf('let adminGrowthReferralReviewQueue=null;'),
 acq.indexOf('function adminLeadWhatsApp(raw)'));
assert.ok(growth.length>4500);
const uuid='12345678-1234-4234-8234-123456789012';
const growthMarks=new Map(),growthFields=new Map(),actions=[];
const row={applicationId:uuid,companyName:'Empresa Teste',cnpjSuffix:'4321',
 latestDecision:null,cnpjMatches:true,ownerMatches:true};
const g={
 document:{
  querySelector:q=>{
   const group=/^input\[name="([^"]+)"\]:checked$/.exec(q)?.[1];
   return group?growthMarks.get(group)||null:null;
  },
  getElementById:id=>growthFields.get(id)||null
 },
 adminCurrentRole:()=>g.role,role:'compliance',
 adminRuntime:{session:{user:{id:'owner'}}},
 adminPerform:async(action,arg)=>actions.push([action,arg]),
 toast:m=>actions.push(['toast',m]),
 confirm:()=>true,crypto:{randomUUID:()=>uuid},render:()=>{},
 adminInvoke:async()=>({}),console,
 esc:x=>String(x).replaceAll('<','&lt;').replaceAll('"','&quot;')
};
vm.createContext(g);
vm.runInContext(growth+
 '\nthis.submit=adminGrowthSubmitMarkedReview;this.review=adminReviewGrowthReferral;'+
 'this.view=adminGrowthReferralReviewSection;this.switchChoice=adminGrowthReviewChoiceChanged;'+
 'this.setQueue=(q)=>{adminGrowthReferralReviewQueue=q};',g);
g.setQueue({rows:[row]});
g.adminLoadGrowthReferralReviewQueue=async()=>{};
const page=g.view();
assert.match(page,/name="growth-review-choice-/);
assert.match(page,/value="verified_identity"/);
assert.match(page,/id="growth-review-proof-field-.*hidden/);
assert.match(page,/Confirmar providência marcada/);
assert.doesNotMatch(page,/Explique o motivo da decisão/);
await g.submit(uuid);
assert.equal(actions.some(x=>x[0]==='growth-referral-review'),false,
 'No selected action, no server mutation');
growthMarks.set('growth-review-choice-'+uuid,{
 value:'needs_evidence',dataset:{reason:'Informações adicionais solicitadas para conferir identidade e vínculo da indicação.'}
});
await g.submit(uuid);
assert.equal(actions.filter(x=>x[0]==='growth-referral-review').length,1);
assert.match(actions.find(x=>x[0]==='growth-referral-review')[1].reason,/Informações adicionais/);
actions.length=0;
await g.review(uuid,'rejected');
assert.equal(actions.filter(x=>x[0]==='growth-referral-review').length,0,
 'A marked evidence request cannot authorize rejection');
growthMarks.set('growth-review-choice-'+uuid,{
 value:'verified_identity',dataset:{reason:'CNPJ e responsável conferidos por evidência documentada para validação da identidade.'}
});
const proofPanel={hidden:true};
growthFields.set('growth-review-proof-field-'+uuid,proofPanel);
g.switchChoice(uuid);assert.equal(proofPanel.hidden,false);
await g.submit(uuid);
assert.equal(actions.filter(x=>x[0]==='growth-referral-review').length,0,
 'Marking identity is not enough without real evidence reference');
growthFields.set('growth-review-proof-'+uuid,{value:'PROTOCOLO-REAL-123'});
await g.submit(uuid);
const verified=actions.filter(x=>x[0]==='growth-referral-review');
assert.equal(verified.length,1);
assert.equal(verified[0][1].evidenceReference,'PROTOCOLO-REAL-123');
actions.length=0;g.role='operations';
await g.submit(uuid);
assert.equal(actions.filter(x=>x[0]==='growth-referral-review').length,0,
 'Operations may not validate identity');
g.role='compliance';
row.cnpjMatches=false;
await g.submit(uuid);
assert.equal(actions.filter(x=>x[0]==='growth-referral-review').length,0,
 'Missing CNPJ corroboration prevents verification');

// Partner Ads creative moderation remains non-billable and role protected.
for(const k of ['adminAdsReviewMarked','adminAdsSubmitMarkedReview',
 'name="ads-review-choice-','value="needs_changes"','value="approved_creative"',
 'adminPerform(\'ads-campaign-review\''])
 assert.ok(acq.includes(k),'Missing partner ad review mark '+k);
assert.match(acq,/choice\.value!==decision\)return toast\('Marque a decisão correspondente/);
assert.match(acq,/data\.noCharge!==true\|\|data\.adsLive!==false/);

// Operations follow-ups retain owners, dates and revision tokens, while reason can be checked.
for(const k of ['name="admin-followup-reason-','admin-followup-note-',
 'data-note="Acompanhamento','expectedRevision:item?.revision||0',
 'adminMarkedChoice(\'admin-followup-reason-'])
 assert.ok(admin.includes(k),'Follow-up check missing '+k);
assert.match(admin,/!item&&!chosen/);
console.log('V1.900 PASS: marked Discovery actions, authorized referral reviews, evidence gates, Ads reasons and operational follow-up presets.');
