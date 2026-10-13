import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'admin.js'});
const fn=name=>{
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing '+name);
 return source.slice(start,end+2);
};
const names=['adminOperationalFollowupsSafe','adminOperationalMyQueueModel',
 'adminOperationalMyQueueView','adminOperationalFollowupFocus',
 'adminOperationalAlertsCurrent','adminOperationalAlertHistoryDate'];
const actor='11111111-1111-4111-8111-111111111111';
const colleague='22222222-2222-4222-8222-222222222222';
const dueOffset=hours=>new Date(Date.now()+hours*3600000).toISOString();
const at=new Date().toISOString();
const mk=(source,ownerId,urgency,status='open',time=-1)=>({
 source,ownerId,dueAt:dueOffset(time),status,
 note:'Conferir prazo com a equipe.',revision:2,updatedAt:at,
 overdue:['overdue','severely_overdue'].includes(urgency),
 ownerEligible:urgency!=='owner_unavailable',urgency
});
const raw={
 available:true,checkedAt:at,items:[
  mk('support',actor,'due_soon','monitoring',1),
  mk('finance',colleague,'overdue','open',-2),
  mk('incidents',actor,'severely_overdue','open',-25),
  mk('capture',actor,'on_track','closed',48)
 ],owners:[{id:actor,role:'superadmin'},{id:colleague,role:'finance'}],
 events:[]
};
let role='superadmin';
const state={
 status:'ready',session:{user:{id:actor}},
 data:{currentAdmin:{admin_role:'superadmin'}},operationalAlertFilter:'high',
 operationalAlerts:{data:{groups:{},lifecycle:{},followups:raw},
   role:'superadmin',loadedFor:actor,checkedAt:at,loading:false,error:null}
};
let renders=0,scrolls=0,focuses=0,raf=0,lookups=0;
const nodes={
 'admin-followup-details-incidents':{
  tagName:'DETAILS',open:false,
  scrollIntoView:()=>scrolls++,
  querySelector:x=>x==='summary'?{focus:()=>focuses++}:null
 }
};
const htmlEsc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({
 Date,String,Math,Number,Array,Object,Set,Map,
 adminRuntime:state,adminReady:()=>state.status==='ready',
 adminRoleCanSection:x=>x==='alerts',adminCurrentRole:()=>role,
 adminOperationalAlertModel:()=>({alerts:[],unavailable:[]}),
 adminOperationalAlertLifecycle:()=>null,
 esc:htmlEsc,render:()=>renders++,
 document:{getElementById:id=>{lookups++;return nodes[id]||null}},
 requestAnimationFrame:callback=>{raf++;callback()}
});
vm.runInContext(names.map(fn).join('\n')+
 '\nthis.safe=adminOperationalFollowupsSafe;'+
 'this.model=adminOperationalMyQueueModel;'+
 'this.view=adminOperationalMyQueueView;'+
 'this.focus=adminOperationalFollowupFocus;',ctx);
const safe=ctx.safe(raw);
assert.ok(safe,'Authorized source list verified');
const model=ctx.model(safe,actor);
assert.equal(model.total,2,'Only own and not-closed tasks');
assert.equal(model.critical,1);
assert.equal(model.dueSoon,1);
assert.deepEqual(Array.from(model.items.map(x=>x.source)),['incidents','support'],
 'Critical and overdue tasks come first, regardless of database order');
assert.equal(ctx.model(safe,actor.toUpperCase()).total,2,'Stable UUID comparison');
const view=ctx.view(safe,actor);
assert.ok(view.includes('Meus acompanhamentos'));
assert.ok(view.includes('2 em aberto'));
assert.ok(view.includes('Atraso de 24 horas ou mais'));
assert.ok(view.includes('Vence em até 2 horas'));
assert.ok(view.includes('Abrir acompanhamento'));
assert.ok(view.includes('adminOperationalFollowupFocus'));
assert.ok(!view.includes('Processamento financeiro'),
 'Other admin assigned items are never included in the personal queue');
assert.ok(!view.includes('Capturas comerciais'),
 'Closed commitments do not inflate open personal work');
const noOwn=ctx.view(safe,colleague);
assert.ok(noOwn.includes('Processamento financeiro'));
assert.ok(!noOwn.includes('Incidentes'));
const empty=ctx.view(safe,'33333333-3333-4333-8333-333333333333');
assert.ok(empty.includes('Nenhum acompanhamento em aberto atribuído a você'));
assert.ok(empty.includes('não significa ausência de problemas'));
assert.equal(ctx.model(null,actor),null);
assert.ok(ctx.view(null,actor).includes('não verificadas'));
assert.equal(ctx.model(safe,'fake-user'),null);
assert.equal(ctx.model(safe,'<img onerror=alert(1)>'),null);
ctx.focus('incidents');
assert.equal(state.operationalAlertFilter,'all','Focus removes priority filter');
assert.equal(renders,1);
assert.equal(raf,1);
assert.equal(nodes['admin-followup-details-incidents'].open,true);
assert.equal(scrolls,1);
assert.equal(focuses,1);
const after=lookups;
ctx.focus('other');assert.equal(lookups,after,'Cannot focus unlisted source');
role='finance';state.data.currentAdmin.admin_role='finance';
assert.equal(ctx.safe(raw),null,'Unauthorized support and capture sources rejected at boundary');
assert.ok(ctx.view(ctx.safe(raw),actor).includes('não verificadas'));
state.operationalAlerts.role='superadmin'; // Mismatched role: blocked by current() even if data reused
ctx.focus('incidents');assert.equal(lookups,after,'Role transition invalidates old session data');
role='superadmin';state.data.currentAdmin.admin_role='superadmin';
state.session={user:{id:colleague}};
ctx.focus('incidents');assert.equal(lookups,after,'Cross-user data blocked');
state.status='unauthenticated';
ctx.focus('incidents');assert.equal(lookups,after,'Unauthenticated cannot interact');
assert.ok(source.includes('adminOperationalMyQueueView('));
assert.ok(source.includes("adminRuntime.session?.user?.id"));
assert.ok(source.includes("'admin-followup-details-'+source"));
assert.ok(source.includes("requestAnimationFrame(()=>"));
const css=read('css/components.css');
assert.ok(css.includes('.admin-my-alert-queue-item'));
assert.ok(css.includes('@media(max-width:650px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-my-alert-queue-v1-213.mjs'));
console.log('V1.213 PASS: own-work queue, overdue-first ordering, closed separation, no false all-clear, safe navigation, session/role isolation, mobile layout.');
