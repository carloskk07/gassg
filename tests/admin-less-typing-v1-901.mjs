import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const admin=read('js/admin.js'),acq=read('js/admin-acquisition.js');
assert.doesNotThrow(()=>new vm.Script(admin,{filename:'js/admin.js'}));
assert.doesNotThrow(()=>new vm.Script(acq,{filename:'js/admin-acquisition.js'}));
const slice=(source,from,to)=>{
 const start=source.indexOf(from),end=source.indexOf(to,start);
 assert.ok(start>=0&&end>start,'Missing UI segment: '+from);
 return source.slice(start,end);
};
const incident=slice(admin,'function adminIncidentSeverityLabel(', 'function adminIncidentDuration(');
const registry=slice(admin,'const ADMIN_REGISTRY_REASON_OPTIONS=', 'function adminCommercialPolicySection(')+
 slice(admin,'async function adminCreateProductCategory(', 'function adminPolicyFieldBps(');
const intake=slice(acq,'function adminLeadActionButtons(', 'function adminLeadCampaignRows(');
for(const [name,src] of Object.entries({incident,registry,intake}))
 assert.doesNotMatch(src,/\bprompt\s*\(/,'No typing modal in '+name);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const uuid='b384e055-f469-4635-9b3b-4a80af1c814b';
const inputs=new Map(),writes=[],messages=[];
const document={getElementById:id=>inputs.get(id)||null};
const put=(id,value,other={})=>inputs.set(id,{value,...other});
const ctx={document,esc,adminRuntime:{session:{user:{id:'owner'}},status:'ready',data:{}},
 adminCurrentRole:()=> 'superadmin',adminRoleCanSection:()=>true,
 adminPerform:async(action,arg)=>{writes.push({action,arg});return {}},
 adminHelpReportsPage:async()=>{},adminHelpPager:()=>({error:null}),
 toast:message=>messages.push(String(message)),confirm:()=>true,render:()=>{},
 formatDateTime:x=>String(x),adminRoleLabel:x=>x};
vm.createContext(ctx);
vm.runInContext(incident+'\n'+registry+'\n'+intake+'\n'+
 'this.incidentAction=adminIncidentAction;this.incidentCard=adminIncidentCard;'+
 'this.registrySelect=adminRegistryReasonSelect;this.registryGet=adminRegistrySelectedReason;'+
 'this.registryCode=adminRegistrySuggestCode;this.registryView=adminProductRegistrySection;'+
 'this.productToggle=adminSetProductActive;this.categoryToggle=adminToggleProductCategory;'+
 'this.leadCardButtons=adminLeadActionButtons;this.leadStatus=adminSetPrelaunchLeadStatus;'+
 'this.publicButtons=adminPublicRequestActionButtons;this.publicStatus=adminSetPublicRequestStatus;',ctx);
const card=ctx.incidentCard({id:uuid,title:'Falha',status:'open',severity:'high'},[]);
assert.match(card,/incident-status-/);
assert.match(card,/incident-resolution-confirm-/);
assert.match(card,/value="investigating"/);
assert.match(card,/value="not_reproducible"/);
await ctx.incidentAction(uuid,'set-status');
assert.equal(writes.length,0,'No incident status without selection');
put('incident-status-'+uuid,'monitoring');
await ctx.incidentAction(uuid,'set-status');
assert.equal(writes.pop().arg.incidentStatus,'monitoring');
put('incident-status-'+uuid,'resolved');
await ctx.incidentAction(uuid,'set-status');
assert.equal(writes.length,0,'Invalid status must not write');
put('incident-resolution-'+uuid,'restored');
put('incident-resolution-confirm-'+uuid,'',{checked:false});
await ctx.incidentAction(uuid,'resolve');
assert.equal(writes.length,0,'Resolution requires verification checkbox');
inputs.get('incident-resolution-confirm-'+uuid).checked=true;
await ctx.incidentAction(uuid,'resolve');
assert.match(writes.pop().arg.resolutionNote,/Falha corrigida/);
put('incident-resolution-'+uuid,'garbage');
await ctx.incidentAction(uuid,'resolve');
assert.equal(writes.length,0,'Unexpected reason cannot authorize resolution');
const regView=ctx.registryView({productRegistry:{
 categories:[{category_key:'bebidas',category_name:'Bebidas',active:true}],
 products:[{product_code:'SODA2L',product_name:'Refrigerante 2 L',delivery_class:'household_general',category_key:'bebidas',active:false}]
}});
assert.match(regView,/registry-category-reason-bebidas/);
assert.match(regView,/registry-product-reason-SODA2L/);
assert.match(regView,/registry-category-reason/);
assert.match(regView,/registry-product-reason/);
put('registry-product-name','Água 20 L');
put('registry-product-code','',{dataset:{}});
ctx.registryCode('registry-product-name','registry-product-code','product');
assert.equal(inputs.get('registry-product-code').value,'AGUA_20_L');
inputs.get('registry-product-code').value='CUSTOM';
inputs.get('registry-product-code').dataset.manual='1';
ctx.registryCode('registry-product-name','registry-product-code','product');
assert.equal(inputs.get('registry-product-code').value,'CUSTOM','Manual code not overwritten');
put('registry-category-name','São Gabriel');
put('registry-category-key','',{dataset:{}});
ctx.registryCode('registry-category-name','registry-category-key','category');
assert.equal(inputs.get('registry-category-key').value,'sao_gabriel');
assert.equal(ctx.registryGet('registry-product-reason-SODA2L','product_activate'),null);
await ctx.productToggle('SODA2L',true);
assert.equal(writes.length,0,'Product activation cannot proceed without selected reason');
put('registry-product-reason-SODA2L','resumed');
await ctx.productToggle('SODA2L',true);
assert.equal(writes.pop().arg.reason,'Retomar produto geral anteriormente pausado.');
put('registry-product-reason-SODA2L','bogus');
await ctx.productToggle('SODA2L',true);
assert.equal(writes.length,0);
const lead=ctx.leadCardButtons({id:uuid,status:'new'});
assert.match(lead,/admin-lead-close-reason-/);
assert.match(lead,/admin-lead-note-/);
await ctx.leadStatus(uuid,'closed');
assert.equal(writes.length,0,'No lead close without real selected reason');
put('admin-lead-close-reason-'+uuid,'duplicate');
await ctx.leadStatus(uuid,'closed');
assert.match(writes.pop().arg.note,/Cadastro duplicado/);
await ctx.leadStatus(uuid,'contacted');
assert.equal(writes.pop().arg.note,'','No blocking optional note');
const publicHtml=ctx.publicButtons({id:uuid,status:'new',request_kind:'support'});
assert.match(publicHtml,/admin-public-reason-resolved-/);
assert.match(publicHtml,/admin-public-reason-closed-/);
assert.match(publicHtml,/admin-public-confirm-/);
await ctx.publicStatus(uuid,'resolved');
assert.equal(writes.length,0,'Cannot resolve without reason');
put('admin-public-reason-resolved-'+uuid,'answered');
put('admin-public-confirm-'+uuid,'',{checked:false});
await ctx.publicStatus(uuid,'resolved');
assert.equal(writes.length,0,'Cannot resolve without confirmation');
inputs.get('admin-public-confirm-'+uuid).checked=true;
await ctx.publicStatus(uuid,'resolved');
assert.match(writes.pop().arg.resolutionNote,/resposta enviada/);
put('admin-public-reason-closed-'+uuid,'answered');
await ctx.publicStatus(uuid,'closed');
assert.equal(writes.length,0,'Resolution selection cannot authorize closure');
put('admin-public-reason-closed-'+uuid,'duplicate');
await ctx.publicStatus(uuid,'closed');
assert.match(writes.pop().arg.resolutionNote,/duplicada/);
console.log('V1.901 PASS: incident status/resolution, catalog reason allowlists and auto-code, lead closure and public support verifications.');
