import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin.js'),edge=read('supabase/functions/admin-ops/index.ts'),
 sql=read('supabase/migrations/20261013045700_alert_owner_acknowledgment_v1_214.sql');
new vm.Script(ui,{filename:'admin.js'});
const names=['adminOperationalFollowupsSafe','adminOperationalAlertModel',
 'adminOperationalAlertLifecycle','adminOperationalAlertsCurrent',
 'adminOperationalAlertHistoryDate','adminOperationalMyQueueModel',
 'adminOperationalMyQueueView','adminOperationalConfirmAck'];
function extract(name){
 const asyncStart=ui.indexOf('async function '+name+'(');
 const start=asyncStart>=0?asyncStart:ui.indexOf('function '+name+'(');
 const end=ui.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing '+name);
 return ui.slice(start,end+2);
}
const actor='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const now=new Date().toISOString(),due=new Date(Date.now()+86400000).toISOString();
const followup=(ackStatus,changes={})=>({
 source:'finance',ownerId:actor,dueAt:due,status:'open',note:'Verificar o financeiro.',
 revision:3,updatedAt:now,overdue:false,ownerEligible:true,urgency:'on_track',
 ackStatus,acknowledgedAt:ackStatus==='acknowledged'?now:null,...changes
});
const response=item=>({
 available:true,items:[item],
 owners:[{id:actor,role:'finance'},{id:owner,role:'superadmin'}],events:[],
 checkedAt:now
});
let role='finance',writes=[],refreshes=0,notice='',ready=true,actionPending=false;
const runtime={
 status:'ready',session:{user:{id:actor}},data:{currentAdmin:{admin_role:role}},
 actionPending,
 operationalAlerts:{data:null,loadedFor:actor,role,checkedAt:now,loading:false,error:null}
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({
 Date,Array,Number,String,Set,Object,Map,adminRuntime:runtime,esc,
 adminReady:()=>ready,
 adminRoleCanSection:x=>x==='alerts',
 adminCurrentRole:()=>role,toast:x=>notice=String(x),
 adminPerform:async(a,p)=>{writes.push({action:a,payload:p});return{source:'server_authoritative',revision:3,changed:true}},
 adminLoadOperationalAlerts:async()=>refreshes++
});
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.safe=adminOperationalFollowupsSafe;'+
 'this.view=adminOperationalMyQueueView;'+
 'this.confirm=adminOperationalConfirmAck;',ctx);
const pending=response(followup('pending'));
assert.ok(ctx.safe(pending));
const pendingHtml=ctx.view(ctx.safe(pending),actor);
assert.ok(pendingHtml.includes('Aguardando confirmação de ciência'));
assert.ok(pendingHtml.includes('Confirmar ciência'));
assert.ok(pendingHtml.includes('adminOperationalConfirmAck'));
runtime.operationalAlerts.data={source:'operational_alerts_v1_208',checkedAt:now,readOnly:true,
 groups:{incidents:{valid:true,open:0,critical:0,high:0},
 finance:{available:true,valid:true,rewardFailures:1,accountingFailures:0},
 support:{available:false},capture:{available:false},portals:{available:false}},
 followups:pending};
await ctx.confirm('finance',3);
assert.equal(writes.length,1);
assert.equal(writes[0].action,'operational-alert-ack');
assert.equal(writes[0].payload.source,'finance');
assert.equal(writes[0].payload.expectedRevision,3);
assert.equal(refreshes,1);
assert.ok(notice.includes('permanece em aberto'));
await ctx.confirm('finance',2);
assert.equal(writes.length,1,'Stale revision must not execute');
runtime.operationalAlerts.data.followups=response(followup('acknowledged'));
assert.ok(!ctx.view(ctx.safe(response(followup('acknowledged'))),actor).includes('Confirmar ciência</button>'));
assert.ok(ctx.view(ctx.safe(response(followup('acknowledged'))),actor).includes('Ciência confirmada'));
await ctx.confirm('finance',3);
assert.equal(writes.length,1,'Already acknowledged must not resubmit');
assert.ok(ctx.view(ctx.safe(response(followup('overdue'))),actor).includes('Ciência pendente há mais de 2 horas'));
assert.ok(ctx.view(ctx.safe(response(followup('overdue'))),actor).includes('Confirmar ciência'));
assert.ok(!ctx.view(ctx.safe(response(followup('pending',{ownerEligible:false})),actor).includes('Confirmar ciência</button>'));
assert.ok(!ctx.view(ctx.safe(response(followup('pending',{status:'closed',urgency:'closed'})),actor).includes('Confirmar ciência</button>'));
runtime.operationalAlerts.data.followups=response(followup('pending',{ownerId:owner}));
await ctx.confirm('finance',3);
assert.equal(writes.length,1,'Only assigned owner can confirm');
runtime.operationalAlerts.data.followups=pending;
role='operations';runtime.data.currentAdmin.admin_role=role;
await ctx.confirm('finance',3);
assert.equal(writes.length,1,'No cross-role action for finance');
assert.equal(ctx.safe(pending),null,'Financial followups remain role-scoped');
role='finance';runtime.data.currentAdmin.admin_role=role;
runtime.session={user:{id:owner}};
await ctx.confirm('finance',3);assert.equal(writes.length,1,'No cross-session ack');
runtime.session={user:{id:actor}};
assert.equal(ctx.safe(response(followup('untrusted'))),null,'ackStatus allowlisted');
assert.equal(ctx.safe(response(followup('acknowledged',{acknowledgedAt:'invalid'}))),null);
assert.ok(!ctx.view(ctx.safe(response(followup('pending',{ownerEligible:false})),actor).includes('Confirmar ciência</button>'));
ready=false;runtime.status='unauthenticated';
await ctx.confirm('finance',3);assert.equal(writes.length,1);
assert.ok(sql.includes('admin_alert_ack_once_per_revision_v1_214'));
assert.ok(sql.includes('ALERT_ACK_OWNER_ONLY'));
assert.ok(sql.includes('ALERT_FOLLOWUP_CONFLICT'));
assert.ok(sql.includes('ALERT_FOLLOWUP_ALREADY_CLOSED'));
assert.ok(sql.includes('p_actor_id'));
assert.ok(sql.includes('v_followup.owner_id<>p_actor_id'));
assert.ok(sql.includes('e.revision=f.revision'));
assert.ok(sql.includes("e.event_kind='acknowledged'"));
assert.ok(sql.includes("f.updated_at<=v_now-interval '2 hours'"));
assert.ok(sql.includes('on conflict (source,revision) where event_kind='));
assert.ok(sql.includes('platform_admin_audit'));
assert.ok(sql.includes('operational_alert_ack_financial'));
assert.ok(sql.includes('revoke all on function public.admin_ack_alert_followup_v1_214'));
assert.ok(sql.includes('to service_role'));
assert.ok(!sql.includes('update public.admin_alert_followups_v1_211'));
assert.ok(!sql.includes('pg_net')&&!sql.includes('http_post'));
assert.ok(edge.includes('"operational-alert-ack"'));
assert.ok(edge.includes('admin_ack_alert_followup_v1_214'));
assert.ok(edge.includes('p_actor_id:user.id'));
assert.ok(edge.includes('p_expected_revision:revision'));
assert.ok(read('css/components.css').includes('.admin-alert-ack-actions'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-alert-ack-v1-214.mjs'));
console.log('V1.214 passed: owner-only revision ack, stale/closed denial, role/session isolation, 2-hour receipt SLA, DB audit, mobile action and no incident or financial mutation.');
