import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin.js');
new vm.Script(src,{filename:'admin.js'});
const extract=name=>{
 const start=src.indexOf('function '+name+'(');
 const end=src.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing '+name);return src.slice(start,end+2);
};
const names=['adminOperationalAlertTriage','adminOperationalAlertSetFilter',
 'adminOperationalAlertsCurrent','adminOperationalFollowupsSafe','adminOperationalFollowupCanWrite',
  'adminOperationalFollowupEditView','adminOperationalFollowupsDormantView',
  'adminOperationalAlertLifecycle',
 'adminOperationalAlertModel','adminOperationalAlertHistoryDate',
 'adminOperationalAlertHistoryNote','adminOperationalAlertHistoryView',
 'adminOperationalAlertBadge','adminOperationalAlertsOpen','adminOperationalAlertsView'];
const now=new Date().toISOString();
const previous=new Date(Date.now()-45*60000).toISOString();
const stale=new Date(Date.now()-120*60000).toISOString();
const runtime={status:'ready',session:{user:{id:'admin-A'}},
 data:{currentAdmin:{admin_role:'superadmin'}},
 operationalAlertFilter:'all',
 operationalAlerts:{data:null,loadedFor:'admin-A',role:'superadmin',loading:false,
  error:null,checkedAt:now}};
let currentRole='superadmin',renders=0;
const grants={
 superadmin:['alerts','orders','finance','incidents','prospects','system'],
 support:['alerts','orders','incidents'],
 finance:['alerts','finance','incidents'],
 operations:['alerts','orders','incidents','prospects','system'],
 readonly:['alerts','incidents','prospects','system']
};
const ctx=vm.createContext({Date,Number,Object,Array,String,Map,Set,
 adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
 adminRoleCanSection:section=>grants[currentRole]?.includes(section)===true,
 adminCurrentRole:()=>currentRole,render:()=>renders++,
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
 adminSetSection:id=>{ctx.lastNavigation=id;}
});
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.triage=adminOperationalAlertTriage;this.setFilter=adminOperationalAlertSetFilter;'+
 'this.view=adminOperationalAlertsView;this.current=adminOperationalAlertsCurrent;'+
 'this.open=adminOperationalAlertsOpen;',ctx);
const alert=(id,severity,target=id)=>({id,severity,target,
 title:id==='finance'?'Processamento financeiro':id,
 detail:'Pendências verificadas na consulta ao servidor'});
const sample=[
 alert('support','medium','orders'),
 alert('capture','high','prospects'),
 alert('finance','high'),
 alert('incidents','critical'),
 alert('portals','high','system')
];
const without=Array.from(ctx.triage(sample,null,now));
assert.deepEqual(without.map(x=>x.id),['incidents','capture','finance','portals','support'],
 'Baseline priority and stable tie ordering');
assert.equal(without[0].triage.score,90);
assert.equal(without[1].triage.score,64);
assert.equal(without[4].triage.score,32);
assert.equal(without[0].triage.label,'Ação imediata');
assert.equal(without[1].triage.priority,'high');
assert.equal(without[4].triage.owner,'Atendimento');
assert.ok(without.every(x=>x.triage.historyChecked===false));
const lifecycle=(monitorStatus='current',override={})=>({
 monitor:{status:monitorStatus,checkedAt:now,asOf:now,cadence:'hourly'},
 states:[{source:'finance',status:'active',count:12,checkedAt:now,
  consecutiveChecks:4,episodes:2,openSince:previous,lastPositiveAt:now,lastClearedAt:null},
  {source:'support',status:'active',count:5,checkedAt:now,
  consecutiveChecks:2,episodes:1,openSince:previous,lastPositiveAt:now,lastClearedAt:null}],
 events:[{source:'finance',status:'active',previous:'active',at:now,count:12}],...override
});
const scored=Array.from(ctx.triage(sample,lifecycle(),now));
assert.equal(scored[0].id,'finance','Verified worsening recurring financial failure moves ahead');
assert.equal(scored[0].triage.priority,'immediate');
assert.equal(scored[0].triage.score,94);
assert.ok(scored[0].triage.reasons.some(x=>x.includes('Agravamento')));
assert.ok(scored[0].triage.reasons.some(x=>x.includes('Recorrência')));
assert.ok(scored[0].triage.reasons.some(x=>x.includes('Dez ou mais')));
assert.equal(scored.find(x=>x.id==='portals').triage.score,64,
 'On-demand portals may not inherit hourly history bonus');
assert.equal(scored.find(x=>x.id==='support').triage.score,42,
 'Medium support: base 32 + two checks 6 + five pendings 4');
const noBoost=Array.from(ctx.triage(sample,lifecycle('stale'),now));
assert.equal(noBoost.find(x=>x.id==='finance').triage.score,64);
const tooOld=Array.from(ctx.triage(sample,lifecycle('current',{
 monitor:{status:'current',checkedAt:stale,asOf:now},
 states:[{source:'finance',status:'active',count:99,checkedAt:stale,
  consecutiveChecks:100,episodes:100,openSince:stale,lastPositiveAt:stale}],
 events:[]}),now));
assert.equal(tooOld.find(x=>x.id==='finance').triage.score,64,
 'Old monitoring must not increase live priority');
const unresolved=Array.from(ctx.triage(sample,lifecycle('current',{
 states:[{source:'finance',status:'unknown',count:null,checkedAt:now,
 consecutiveChecks:0,episodes:1,openSince:null,lastPositiveAt:previous,lastClearedAt:null}]}),now));
assert.equal(unresolved.find(x=>x.id==='finance').triage.score,64,
 'Unknown hourly status never provides a positive recurrence signal');
const fakeWorsening=Array.from(ctx.triage(sample,lifecycle('current',{
 events:[{source:'finance',status:'active',previous:'active',at:stale,count:12}]}),now));
assert.equal(fakeWorsening.find(x=>x.id==='finance').triage.score,84,
 'Old worsening must not remain a permanent bonus');
assert.deepEqual(Array.from(ctx.triage([alert('other','critical')],null,now)),[],
 'Unknown source cannot inject a navigation target');
assert.deepEqual(Array.from(ctx.triage([alert('finance','urgent')],null,now)),[],
 'Unknown severity cannot bypass strict priority whitelist');
// Rendering: all data comes from V1.208 validated authorized server response.
const groups={
 incidents:{valid:true,open:1,critical:1,high:0},
 support:{available:true,valid:true,open:5},
 finance:{available:true,valid:true,rewardFailures:11,accountingFailures:1},
 capture:{available:true,valid:true,health:{status:'run_failed'}},
 portals:{available:true,valid:true,verified:false}
};
runtime.operationalAlerts.data={source:'operational_alerts_v1_208',checkedAt:now,
 readOnly:true,groups,lifecycle:{available:true,...lifecycle()}};
const html=ctx.view();
assert.ok(html.indexOf('falha(s) de processamento financeiro')<
 html.indexOf('incidente(s) não resolvido(s)'),'Ranked financial recurrence ahead of critical incident');
assert.ok(html.includes('Ordem sugerida de atendimento'));
assert.ok(html.includes('Área responsável:'));
assert.ok(html.includes('Histórico horário'));
assert.ok(html.includes('Ação imediata'));
assert.ok(html.includes("id='admin-alert-priority-filter'"));
ctx.setFilter('immediate');
assert.equal(runtime.operationalAlertFilter,'immediate');
assert.ok(ctx.view().includes('falha(s) de processamento financeiro'));
assert.ok(!ctx.view().includes('<h3>5 atendimento(s) pendente(s)</h3>'));
ctx.setFilter('watch');
const watch=ctx.view();
assert.ok(watch.includes('5 atendimento(s) pendente(s)'));
assert.ok(watch.includes('Nenhuma pendência nesta prioridade')===false);
ctx.setFilter('wrong');assert.equal(runtime.operationalAlertFilter,'watch');
ctx.setFilter('high');assert.ok(ctx.view().includes('Verificação dos portais oficiais'));
currentRole='support';runtime.data.currentAdmin.admin_role='support';
assert.equal(ctx.current(),null,'Role switch cannot expose former financial metrics');
assert.ok(!ctx.view().includes('falha(s) de processamento financeiro'));
ctx.setFilter('all');
ctx.open('finance');assert.notEqual(ctx.lastNavigation,'finance');
runtime.operationalAlerts.role='support';
runtime.operationalAlerts.data={...runtime.operationalAlerts.data,
 groups:{incidents:groups.incidents,support:groups.support,
 finance:{available:false,valid:false,rewardFailures:null,accountingFailures:null},
 capture:{available:false,valid:false,health:null},
 portals:{available:false,valid:false,verified:false}},
 lifecycle:{available:true,...lifecycle('current',{
 states:[{source:'support',status:'active',count:5,checkedAt:now,
 consecutiveChecks:3,episodes:1,openSince:previous,lastPositiveAt:now,lastClearedAt:null}],
 events:[]})}};
assert.ok(ctx.view().includes('Atendimento'));
assert.ok(!ctx.view().includes('Processamento financeiro</h3>'));
runtime.session={user:{id:'admin-B'}};
assert.equal(ctx.current(),null);
assert.ok(!ctx.view().includes('Área responsável:'));
runtime.status='unauthenticated';assert.equal(ctx.view(),'');
const css=read('css/components.css');
assert.ok(css.includes('.admin-ops-alert-triage')&&css.includes('max-width:480px'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-operational-triage-v1-210.mjs'));
console.log('V1.210 PASS: deterministic explanation, severity ordering, real recurrence and growth, stale protections, functional routing, filters, mobile layout, role isolation.');
