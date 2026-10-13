import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
new vm.Script(source,{filename:'admin.js'});
const extract=name=>{
  const asyncStart=source.indexOf('async function '+name+'(');
  const start=asyncStart>=0?asyncStart:source.indexOf('function '+name+'(');
  const end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing function '+name);
  return source.slice(start,end+2);
};
const names=['adminLoadOperationalAlerts','adminOperationalAlertModel',
  'adminOperationalAlertTriage','adminOperationalAlertSetFilter',
  'adminOperationalFollowupsSafe','adminOperationalFollowupCanWrite',
  'adminOperationalFollowupEditView','adminOperationalFollowupsEventsView','adminOperationalFollowupsEscalationsView','adminOperationalFollowupsDormantView',
  'adminOperationalMyQueueModel','adminOperationalMyQueueView','adminOperationalFollowupFocus',
  'adminOperationalAlertLifecycle','adminOperationalAlertHistoryDate',
  'adminOperationalAlertHistoryNote','adminOperationalAlertHistoryView','adminPublicationEpisodeHistoryView','adminOperationalAlertsCurrent',
  'adminOperationalAlertBadge','adminOperationalAlertsOpen','adminOperationalAlertsView'];
let reads=0,renders=0,requests=[],role='superadmin';
const runtime={status:'ready',session:{user:{id:'admin-A'}},
 data:{currentAdmin:{admin_role:'superadmin'}},
 operationalAlerts:{data:null,loadedFor:null,role:null,loading:false,error:null,checkedAt:null}};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let reply=()=>({source:'operational_alerts_v1_208',checkedAt:new Date().toISOString(),readOnly:true,
 groups:{incidents:{valid:true,open:5,critical:1,high:2},
  support:{available:true,valid:true,open:2},
  finance:{available:true,valid:true,rewardFailures:1,accountingFailures:1},
  capture:{available:true,valid:true,health:{status:'awaiting_first'}},
  portals:{available:true,valid:true,verified:true}}});
const can=section=>({
 alerts:['superadmin','operations','support','finance','compliance','readonly'],
 incidents:['superadmin','operations','support','finance','compliance','readonly'],
 orders:['superadmin','operations','support','finance'],
 finance:['superadmin','finance'],prospects:['superadmin','operations','compliance','readonly']
})[section]?.includes(role)===true;
const ctxt=vm.createContext({Date,Number,Array,Object,String,Map,
 adminRuntime:runtime,adminReady:()=>runtime.status==='ready',adminRoleCanSection:can,
 adminCurrentRole:()=>role,esc,adminInvoke:async body=>{requests.push(body);reads++;return reply();},
 adminSetSection:id=>{requests.push({navigate:id})},render:()=>renders++});
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.load=adminLoadOperationalAlerts;this.model=adminOperationalAlertModel;'+
 'this.current=adminOperationalAlertsCurrent;this.badge=adminOperationalAlertBadge;'+
 'this.open=adminOperationalAlertsOpen;this.view=adminOperationalAlertsView;',ctxt);
await ctxt.load();
assert.equal(reads,1);
assert.equal(requests[0].action,'operational-alerts');
assert.equal(runtime.operationalAlerts.loadedFor,'admin-A');
assert.deepEqual(Array.from(ctxt.model(reply().groups).alerts.map(x=>x.id)),
 ['incidents','finance','support'],'priority and source grouping');
assert.equal(ctxt.badge(),'3');
assert.ok(ctxt.view().includes('Central de alertas operacionais'));
assert.ok(ctxt.view().includes('5 incidente(s) não resolvido(s)'));
assert.ok(ctxt.view().includes('2 atendimento(s) pendente(s)'));
assert.ok(ctxt.view().includes('2 falha(s) de processamento financeiro'));
assert.ok(!ctxt.view().includes('Captura diária não confirmada'),
 'First due is still in future and must not generate false alarm');
await ctxt.load();assert.equal(reads,1,'Fresh cache respected');
await ctxt.load({force:true});assert.equal(reads,2,'Explicit refresh must recheck source');
ctxt.open('finance');assert.ok(requests.some(r=>r.navigate==='finance'));
ctxt.open('wrong-page');assert.ok(!requests.some(r=>r.navigate==='wrong-page'));
const missing={incidents:{valid:false,open:null,critical:null,high:null},
 support:{available:true,valid:false,open:null},
 finance:{available:true,valid:false,rewardFailures:null,accountingFailures:null},
 capture:{available:true,valid:false,health:null},
 portals:{available:true,valid:false,verified:false}};
assert.equal(ctxt.model(missing).alerts.length,0);
assert.equal(ctxt.model(missing).unavailable.length,5);
const missingHtml=ctxt.model(missing);
assert.ok(missingHtml.unavailable.includes('Incidentes'));
reply=()=>({source:'operational_alerts_v1_208',checkedAt:new Date().toISOString(),readOnly:true,groups:missing});
await ctxt.load({force:true});
assert.ok(ctxt.view().includes('Fontes indisponíveis nesta consulta'));
assert.ok(!ctxt.view().includes('Nenhuma pendência identificada nas fontes autorizadas'));
const quiet={incidents:{valid:true,open:0,critical:0,high:0},
 support:{available:true,valid:true,open:0},
 finance:{available:true,valid:true,rewardFailures:0,accountingFailures:0},
 capture:{available:true,valid:true,health:{status:'healthy'}},
 portals:{available:true,valid:true,verified:true}};
reply=()=>({source:'operational_alerts_v1_208',checkedAt:new Date().toISOString(),readOnly:true,groups:quiet});
await ctxt.load({force:true});
assert.ok(ctxt.view().includes('Nenhuma pendência identificada nas fontes autorizadas'));
assert.equal(ctxt.badge(),'');
const failedPortals=ctxt.model({...quiet,portals:{available:true,valid:true,verified:false}});
assert.equal(failedPortals.alerts.length,1);
assert.equal(failedPortals.alerts[0].target,'system');
assert.ok(failedPortals.alerts[0].detail.includes('não prova indisponibilidade total'));
for(const status of ['missing_capture','job_disabled','watchdog_late','run_failed']){
 const x=ctxt.model({...quiet,capture:{available:true,valid:true,health:{status}}});
 assert.equal(x.alerts.length,1,status);
 assert.equal(x.alerts[0].target,'prospects');
}
role='support';runtime.data.currentAdmin.admin_role='support';
assert.equal(ctxt.current(),null,'Role transition must not display previous groups');
assert.ok(!ctxt.view().includes('falha(s) de processamento financeiro'));
await ctxt.load({force:true});
assert.equal(runtime.operationalAlerts.role,'support');
ctxt.open('finance');assert.ok(requests.slice(-1)[0].navigate!=='finance','Navigation is role gated');
assert.equal(ctxt.view().includes('Falha ao atualizar:'),false);
runtime.session={user:{id:'admin-B'}};
assert.equal(ctxt.current(),null,'Cross-user data must not display');
assert.equal(ctxt.badge(),'');
assert.ok(!ctxt.view().includes('Nenhuma pendência identificada nas fontes autorizadas'));
runtime.status='unauthenticated';await ctxt.load({force:true});
assert.notEqual(runtime.operationalAlerts.loadedFor,'admin-B');
runtime.status='ready';runtime.session={user:{id:'admin-A'}};
reply=()=>({source:'operational_alerts_v1_208',checkedAt:'2000-01-01T00:00:00Z',readOnly:true,groups:quiet});
await ctxt.load({force:true});
assert.equal(runtime.operationalAlerts.data,null,'Invalid source freshness blocked');
assert.ok(ctxt.view().includes('Falha ao atualizar'));
const staleState=ctxt.model({...quiet,incidents:{valid:true,open:1,critical:0,high:0}});
assert.equal(staleState.alerts.length,1);
assert.equal(ctxt.model({incidents:{valid:true,open:0,critical:1,high:0}}).unavailable.length,1,
 'Invalid contradictory counts cannot be reported');
assert.ok(source.includes("adminMenuButton('alerts','Alertas'"));
assert.ok(source.includes("adminPanel('alerts',alertsContent)"));
assert.ok(source.includes("if(next==='alerts')adminLoadOperationalAlerts({force:true})"));
assert.ok(source.includes("if(adminRuntime.section==='alerts')queueMicrotask("));
assert.ok(source.includes("alerts:new Set(['superadmin'"));
assert.ok(source.includes("operationalAlerts:{data:null"));
assert.ok((source.match(/adminRuntime[.]operationalAlerts=[{]data:null/g)||[]).length>=3,
 'Signout, 401 and 403 cleanup required');
assert.ok(edge.includes('"operational-alerts"'));
assert.ok(edge.includes('action==="operational-alerts"'));
assert.ok(edge.includes('adminOperationalAlerts(admin,role,user.id)'));
assert.ok(edge.includes('p_actor_user_id:actorId'));
assert.ok(edge.includes('verifyLivePortals()'));
assert.ok(edge.includes('groups:{incidents,support,finance,capture,portals,publication,publicationHistory}'),
 'V1.208 groups retained, with the new V1.222 publication evidence added');
assert.ok(edge.includes('.select("id",{count:"exact",head:true})'));
assert.ok(!edge.includes('p_actor_user_id:null //'));
const injectedNames=names.map(extract).join('\n');
assert.ok(!injectedNames.includes('adminPerform('),'Only a read-only diagnostic');
assert.ok(read('css/components.css').includes('.admin-ops-alert-item'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-operational-alerts-v1-208.mjs'));
console.log('V1.208 PASS: role separation, no leakage across sessions, fresh server reads, uncertain source gaps, first-run safety, incident/support/financial scoping, no mutations.');
