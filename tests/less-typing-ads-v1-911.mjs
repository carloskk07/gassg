import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ads=read('js/ads-planner.js');
const admin=read('js/admin-acquisition.js');
new vm.Script(ads,{filename:'js/ads-planner.js'});
new vm.Script(admin,{filename:'js/admin-acquisition.js'});
const fields=new Map();
const uuid='12345678-1234-4234-8234-123456789abc';
let writes=0,confirmOverwrite=false;
const messages=[];
const ctx=vm.createContext({
 globalThis:{
  liveRuntime:{session:{user:{id:'u-1',email_confirmed_at:'2026-11-09',is_anonymous:false}}},
  liveReady:()=>true,
  route:()=> 'sponsors'
 },
 document:{getElementById:id=>fields.get(id)||null},
 toast:message=>messages.push(message),
 confirm:()=>confirmOverwrite,
 esc:x=>String(x),
 console,
 liveInvoke:()=>{writes++;throw Error('No server call should be made by a shortcut');}
});
vm.runInContext(ads+
 '\nthis.v911={model:tamaoAdsCampaignUseModel,reason:tamaoAdsRefundReasonText,'+
 'ufs:TAMAO_ADS_UFS,show:tamaoAdsCampaignForm,planner:tamaoAdsPlannerSection};',ctx);
const a=ctx.v911,form=a.show(),planner=a.planner();
assert.match(form,/sponsor-ad-template/);
assert.match(form,/Preencher modelo para revisar/);
assert.match(form,/tamaoAdsCampaignUseModel/);
assert.match(form,/sponsor-ad-terms/);
assert.match(planner,/<select id="sponsor-cpm-state"/);
assert.equal(a.ufs.length,27);
for(const uf of ['RS','SP','RJ','SC','DF','AM'])
 assert.ok(planner.includes('<option value="'+uf+'"'));
assert.match(ads,/async function tamaoAdsSubmitCampaign/);
assert.match(ads,/!document\.getElementById\('sponsor-ad-terms'\)\?\.checked/);
assert.match(ads,/if\(!tamaoAdsDraftRequestId\)tamaoAdsDraftRequestId=crypto\.randomUUID\(\)/);
fields.set('sponsor-ad-company',{value:'Empresa Verificada'});
fields.set('sponsor-ad-title',{value:''});
fields.set('sponsor-ad-copy',{value:''});
assert.equal(a.model('__proto__'),false);
assert.equal(a.model('company'),true);
assert.match(fields.get('sponsor-ad-title').value,/Empresa Verificada/);
assert.match(fields.get('sponsor-ad-copy').value,/Empresa Verificada/);
assert.ok(fields.get('sponsor-ad-copy').value.length>=20);
const existing=fields.get('sponsor-ad-copy').value;
assert.equal(a.model('contact'),false,'must not overwrite unsaved edits without approval');
assert.equal(fields.get('sponsor-ad-copy').value,existing);
confirmOverwrite=true;
assert.equal(a.model('contact'),true);
assert.match(fields.get('sponsor-ad-title').value,/Entre em contato/);
fields.get('sponsor-ad-company').value='Empresa com nome muito longo '.repeat(7);
assert.equal(a.model('website'),false);
assert.match(messages.join(' '),/Nome muito longo/);
fields.get('sponsor-ad-company').value='';assert.equal(a.model('website'),false);

const reasonId='ads-refund-reason-'+uuid;
const choiceId='ads-refund-choice-'+uuid;
fields.set(choiceId,{value:''});
fields.set(reasonId,{value:''});
assert.match(form+ads,/ads-refund-choice/);
assert.equal(a.reason(uuid),'','no accidental default allegation');
fields.get(choiceId).value='cancel';
assert.match(a.reason(uuid),/cancelamento desta campanha/);
fields.get(choiceId).value='charge';
assert.match(a.reason(uuid),/Não reconheço a cobrança/);
fields.get(reasonId).value='Valor divergente informado pelo usuário.';
assert.match(a.reason(uuid),/Detalhes: Valor divergente/);
fields.get(choiceId).value='custom';
assert.equal(a.reason(uuid),'Valor divergente informado pelo usuário.');
fields.get(choiceId).value='__proto__';
assert.equal(a.reason(uuid),'');
assert.equal(a.reason('not-uuid'),'');
assert.match(ads,/const text=tamaoAdsRefundReasonText\(campaignId\)/);
assert.match(ads,/if\(text.length<12\|\|text.length>500\)/);
assert.match(ads,/action:'refund-request'/);
assert.equal(writes,0);

const start=admin.indexOf('// V1.911 — explicit, factual optional notes');
const end=admin.indexOf('function adminLeadActionButtons(x){',start);
assert.ok(start>=0&&end>start);
const leadId=uuid;
const leadFields=new Map([
 ['admin-lead-note-'+leadId,{value:''}],
 ['admin-lead-note-choice-'+leadId,{value:'advertising'}]
]);
let adminWrites=0,leadConfirm=false;
const leadCtx=vm.createContext({
 document:{getElementById:id=>leadFields.get(id)||null},
 confirm:()=>leadConfirm,
 adminPerform:()=>{adminWrites++}
});
vm.runInContext(admin.slice(start,end)+';this.choose=adminLeadQuickNoteChanged;',leadCtx);
assert.match(admin,/id="admin-lead-note-choice-/);
assert.match(admin,/id="admin-lead-note-/);
assert.match(admin,/adminSetPrelaunchLeadStatus/);
assert.match(admin,/await adminPerform\('lead-status'/);
assert.equal(leadCtx.choose(leadId,'advertising'),true);
assert.match(leadFields.get('admin-lead-note-'+leadId).value,/publicidade/);
assert.equal(leadCtx.choose(leadId,'commerce'),false);
assert.equal(leadFields.get('admin-lead-note-choice-'+leadId).value,'');
leadConfirm=true;
assert.equal(leadCtx.choose(leadId,'return'),true);
assert.match(leadFields.get('admin-lead-note-'+leadId).value,/retorno/);
assert.equal(leadCtx.choose(leadId,'__proto__'),false);
assert.equal(leadCtx.choose('not-a-valid-uuid','return'),false);
assert.equal(adminWrites,0);

assert.match(read('.github/workflows/audit.yml'),/tests\/less-typing-ads-v1-911\.mjs/);
console.log('V1.911 PASS — 27 UFs selectable; advertiser drafts, refund reasons and Admin lead notes explicitly selected; no silent write.');
