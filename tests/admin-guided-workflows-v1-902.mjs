import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js'),acq=read('js/admin-acquisition.js');
new vm.Script(admin,{filename:'js/admin.js'});
new vm.Script(acq,{filename:'js/admin-acquisition.js'});
const section=(s,start,end)=>{
  const a=s.indexOf(start),b=s.indexOf(end,a);
  assert.ok(a>=0&&b>a,'section must exist: '+start);
  return s.slice(a,b);
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const id='12345678901234',writes=[],notices=[],fields=new Map();
const set=(k,value,extra={})=>fields.set(k,{value,...extra});
const document={getElementById:id=>fields.get(id)||null};
const runtime={status:'ready',auditPending:false,auditResults:null,session:{user:{id:'actor'}},
 data:{productRegistry:{},recentAudit:[]}};
const ctx=vm.createContext({document,esc,Date,Number,String,Array,Object,Set,Intl,
 adminRuntime:runtime,adminReady:()=>true,adminRoleCanSection:()=>true,
 adminCurrentRole:()=> 'superadmin',
 adminSensitiveReadCurrent:()=>true,adminPerform:async(action,payload)=>{writes.push([action,payload]);return {}},
 adminInvoke:async input=>({results:[{action:'merchant_activated',target_type:'merchant'}]}),
 adminLoadProspects:async()=>{},adminLoadExpansionRadar:async()=>{},
 toast:m=>notices.push(String(m)),render:()=>{},
 formatDateTime:s=>String(s),PROSPECT_STAGE_LABELS:{uncontacted:'Não contatado',interested:'Interessado'},
 confirm:()=>true});
vm.runInContext(section(admin,'const ADMIN_INCIDENT_TEMPLATES=','function adminIncidentDuration(')+
 section(admin,'function adminIncidentDuration(','function adminAuditChoiceChanged(')+
 section(admin,'function adminAuditChoiceChanged(','function adminAuditView(d){')+
 section(acq,'const ADMIN_PROSPECT_NOTES=','async function adminLoadEnablement()')+
 section(acq,'async function adminSaveProspect(','function adminAnpProspectInviteLink(')+
 '\nthis.api={create:adminCreateIncident,incidentChanged:adminIncidentTemplateChanged,'+
 'incidentCard:adminIncidentCard,incidentCenter:adminIncidentCenter,'+
 'auditSelect:adminAuditFilterOptions,auditValue:adminAuditFilterValue,'+
 'auditDate:adminAuditDatePreset,auditChange:adminAuditChoiceChanged,'+
 'prospectEditor:adminProspectCrmEditor,prospectChoice:adminProspectNoteFromChoice,'+
 'prospectDate:adminProspectFollowUpChoice,prospectSave:adminSaveProspect};',ctx);
const api=ctx.api;
let page=api.incidentCenter({incidents:[]});
assert.match(page,/admin-incident-template/);
assert.match(page,/admin-incident-custom" hidden/);
assert.match(page,/Selecion[e]? o que realmente foi relatado/);
assert.match(page,/admin-incident-entity-type/);
set('admin-incident-template','orders');set('admin-incident-severity','high');
set('admin-incident-entity-type','');set('admin-incident-entity-id','');set('admin-incident-description','');
await api.create();
assert.equal(writes.length,1);
assert.equal(writes.pop()[1].title,'Falha no andamento de pedidos');
set('admin-incident-template','invalid');
await api.create();assert.equal(writes.length,0);
set('admin-incident-template','custom');
set('admin-incident-title','');
await api.create();assert.equal(writes.length,0);
set('admin-incident-title','Ocorrência real no sistema');
set('admin-incident-severity','');
await api.create();assert.equal(writes.length,0);
set('admin-incident-severity','low');
await api.create();assert.equal(writes.pop()[1].title,'Ocorrência real no sistema');
set('admin-incident-template','orders');
const custom={hidden:false};fields.set('admin-incident-custom',custom);
api.incidentChanged();assert.equal(custom.hidden,true);
set('admin-incident-template','custom');api.incidentChanged();assert.equal(custom.hidden,false);
set('admin-audit-action-choice','merchant_activated');
set('admin-audit-target-choice','merchant');
assert.equal(api.auditValue('action'),'merchant_activated');
assert.equal(api.auditValue('target'),'merchant');
set('admin-audit-action-choice','custom');
set('admin-audit-action','custom_action');
assert.equal(api.auditValue('action'),'custom_action');
set('admin-audit-target-choice','');
assert.equal(api.auditValue('target'),'');
const choices=api.auditSelect([{action:'merchant_activated'},{action:'<script>'},{action:'order_updated'}],'action');
assert.match(choices,/merchant_activated/);
assert.doesNotMatch(choices,/<script>/);
const from={value:''},to={value:''};
fields.set('admin-audit-from',from);fields.set('admin-audit-to',to);
api.auditDate('7d');
assert.match(from.value,/^\d{4}-\d{2}-\d{2}T00:00$/);
assert.match(to.value,/^\d{4}-\d{2}-\d{2}T23:59$/);
api.auditDate('all');assert.equal(from.value,'');assert.equal(to.value,'');
const record={cnpj:id,crm_version:2,prospect_status:'uncontacted',notes:'Registro anterior',
 follow_up_at:'2026-11-09'};
const editor=api.prospectEditor(record);
assert.match(editor,/prospect-next-action-/);
assert.match(editor,/prospect-quick-date-/);
assert.match(editor,/data-initial="2026-11-09"/);
assert.match(editor,/Última anotação registrada/);
assert.match(editor,/Contato realizado nesta atualização/);
set('prospect-stage-'+id,'uncontacted');
set('prospect-channel-'+id,'');
set('prospect-note-'+id,'');
set('prospect-follow-up-'+id,'2026-11-09',{dataset:{initial:'2026-11-09'}});
set('prospect-next-action-'+id,'');
await api.prospectSave(id,2);
assert.equal(writes.length,0,'No plan choice cannot write a CRM action');
set('prospect-next-action-'+id,'review');
await api.prospectSave(id,2);
assert.match(writes.pop()[1].note,/revisar a situação atual/);
set('prospect-next-action-'+id,'custom');
await api.prospectSave(id,2);assert.equal(writes.length,0,'No empty custom action');
set('prospect-note-'+id,'Verificar detalhes reais');
await api.prospectSave(id,2);
assert.equal(writes.pop()[1].note,'Verificar detalhes reais');
set('prospect-next-action-'+id,'__proto__');
await api.prospectSave(id,2);assert.equal(writes.length,0,'Only chosen allowlisted action');
const quick={value:'3'},manual={hidden:true},preview={textContent:''};
fields.set('prospect-quick-date-'+id,quick);
fields.set('prospect-manual-date-'+id,manual);
fields.set('prospect-date-preview-'+id,preview);
api.prospectDate(id);
assert.match(fields.get('prospect-follow-up-'+id).value,/^\d{4}-\d{2}-\d{2}$/);
assert.match(preview.textContent,/Agendado/);
assert.equal(manual.hidden,true);
quick.value='custom';api.prospectDate(id);assert.equal(manual.hidden,false);
quick.value='keep';api.prospectDate(id);assert.equal(fields.get('prospect-follow-up-'+id).value,'2026-11-09');
quick.value='clear';api.prospectDate(id);assert.equal(fields.get('prospect-follow-up-'+id).value,'');
assert.match(editor,/Manter data atual/);
console.log('V1.902 PASS: guided incident creation, audit filters, calendar shortcuts and CRM plan notes; no unmarked mutations.');
