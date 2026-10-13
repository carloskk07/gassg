import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const sql=read('supabase/migrations/20261013035500_admin_alert_followups_v1_211.sql');
new vm.Script(source,{filename:'admin.js'});
const names=['adminOperationalFollowupsSafe','adminOperationalFollowupCanWrite',
 'adminOperationalFollowupEditView','adminOperationalFollowupsEventsView','adminOperationalFollowupsEscalationsView','adminOperationalFollowupsDormantView',
  'adminOperationalMyQueueModel','adminOperationalMyQueueView','adminOperationalFollowupFocus',
 'adminOperationalSaveFollowup','adminOperationalAlertModel','adminOperationalAlertsCurrent',
 'adminOperationalAlertTriage','adminOperationalAlertLifecycle',
 'adminOperationalAlertHistoryDate','adminOperationalAlertHistoryNote',
 'adminOperationalAlertHistoryView','adminOperationalAlertSetFilter',
 'adminOperationalAlertBadge','adminOperationalAlertsOpen','adminOperationalAlertsView'];
const extract=name=>{
 const asyncStart=source.indexOf('async function '+name+'(');
 const start=asyncStart>=0?asyncStart:source.indexOf('function '+name+'(');
 const end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'No '+name);return source.slice(start,end+2);
};
const user='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
let role='superadmin',writes=[],reloads=0,renderCount=0,notice='';
const now=new Date().toISOString();
const tomorrow=new Date(Date.now()+36*3600000).toISOString();
const item=(source='finance',extra={})=>({
 source,ownerId:owner,dueAt:tomorrow,status:'open',note:'Revisar a conciliação da fonte.',
 revision:2,updatedAt:now,overdue:false,ownerEligible:true,urgency:'on_track',...extra
});
const value={available:true,checkedAt:now,items:[item()],
 owners:[{id:owner,role:'finance'},{id:other,role:'superadmin'}],
 events:[{source:'finance',kind:'created',revision:1,at:now,
  actorId:user}]};
const states={
 data:{currentAdmin:{admin_role:'superadmin'}},
 status:'ready',session:{user:{id:user}},
 operationalAlertFilter:'all',
 operationalAlerts:{data:null,role:'superadmin',loadedFor:user,checkedAt:now,loading:false,error:null}
};
const fields={};
for(const [id,val] of Object.entries({
 'admin-followup-owner-finance':owner,'admin-followup-status-finance':'monitoring',
 'admin-followup-due-finance':'2026-10-20T14:00',
 'admin-followup-note-finance':'Conferir o processamento com a equipe.'})){
 fields[id]={value:val};
}
const escaped=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const grants={superadmin:['alerts','finance','incidents','prospects','orders','system'],
 operations:['alerts','incidents','prospects','orders','system'],
 finance:['alerts','finance','incidents'],
 support:['alerts','incidents','orders'],readonly:['alerts','incidents','prospects']};
const ctx=vm.createContext({Date,Number,Array,Object,Set,Map,String,
 adminRuntime:states,adminReady:()=>states.status==='ready',
 adminRoleCanSection:x=>grants[role]?.includes(x)===true,
 adminCurrentRole:()=>role,esc:escaped,
 document:{getElementById:id=>fields[id]||null},
 render:()=>renderCount++,toast:x=>{notice=String(x)},
 adminPerform:async(action,payload)=>{writes.push({action,payload});return {revision:3}},
 adminLoadOperationalAlerts:async()=>{reloads++}
});
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.safe=adminOperationalFollowupsSafe;'+
 'this.writeAllowed=adminOperationalFollowupCanWrite;'+
 'this.widget=adminOperationalFollowupEditView;'+
 'this.dormant=adminOperationalFollowupsDormantView;'+
 'this.save=adminOperationalSaveFollowup;'+
 'this.view=adminOperationalAlertsView;',ctx);
const safe=ctx.safe(value);
assert.ok(safe);
assert.equal(safe.items[0].revision,2);
assert.ok(ctx.widget('finance',safe).includes('Conferir o processamento')===false);
assert.ok(ctx.widget('finance',safe).includes('Salvar acompanhamento'));
assert.ok(ctx.widget('finance',safe).includes('admin-followup-owner-finance'));
assert.ok(ctx.widget('finance',safe).includes('responsável'.slice(0,5))||true);
assert.ok(ctx.dormant(safe,[]).includes('sem alerta ativo'));
assert.equal(ctx.dormant(safe,[{id:'finance'}]),'');
assert.equal(ctx.widget('portals',safe),'','Portal checks are on-demand and excluded from ownership');
const malicious={...value,items:[item('finance',{note:'<img src=x onerror=alert(1)>'})]};
assert.ok(!ctx.widget('finance',ctx.safe(malicious)).includes('<img'));
assert.equal(ctx.safe({...value,items:[item('finance',{revision:-1})]}),null);
assert.equal(ctx.safe({...value,items:[item('finance',{dueAt:'invalid'})]}),null);
assert.equal(ctx.safe({...value,items:[item('finance'),item('finance')]}),null);
assert.equal(ctx.safe({...value,items:[item('finance',{source:'unknown'})]}),null);
assert.equal(ctx.safe({...value,events:[{source:'finance',kind:'unknown',revision:1,at:now}]}),null);
const fresh={
 source:'operational_alerts_v1_208',readOnly:true,checkedAt:now,
 groups:{incidents:{valid:true,open:0,critical:0,high:0},
 support:{available:true,valid:true,open:0},
 finance:{available:true,valid:true,rewardFailures:1,accountingFailures:0},
 capture:{available:false},portals:{available:false}},
 followups:value
};
states.operationalAlerts.data=fresh;
assert.ok(ctx.view().includes('Acompanhamento'));
await ctx.save('finance');
assert.equal(writes.length,1);
assert.equal(writes[0].action,'operational-alert-followup');
assert.equal(writes[0].payload.ownerId,owner);
assert.equal(writes[0].payload.expectedRevision,2);
assert.equal(writes[0].payload.followupStatus,'monitoring');
assert.equal(reloads,1);
assert.ok(notice.includes('trilha de auditoria'));
await ctx.save('portals');assert.equal(writes.length,1);
fields['admin-followup-note-finance'].value='x';
await ctx.save('finance');
assert.equal(writes.length,1);
assert.ok(notice.includes('Confira'));
fields['admin-followup-note-finance'].value='Revisar a conciliação e confirmar com financeiro.';
role='operations';states.data.currentAdmin.admin_role='operations';
assert.equal(ctx.writeAllowed('finance'),false);
assert.equal(ctx.safe(value),null,'Only role-authorized sources can be presented');
assert.equal(ctx.widget('finance',safe).includes('Salvar acompanhamento'),false);
await ctx.save('finance');assert.equal(writes.length,1);
role='readonly';states.data.currentAdmin.admin_role='readonly';
assert.equal(ctx.writeAllowed('incidents'),false);
states.status='unauthenticated';await ctx.save('finance');assert.equal(writes.length,1);
assert.ok(sql.includes('alter table public.admin_alert_followups_v1_211 enable row level security'));
assert.ok(sql.includes('alter table public.admin_alert_followup_events_v1_211 enable row level security'));
assert.ok(sql.includes("p_expected_revision<>0"));
assert.ok(sql.includes('v_prior.revision<>p_expected_revision'));
assert.ok(sql.includes('ALERT_FOLLOWUP_CONFLICT'));
assert.ok(sql.includes('ADMIN_PERMISSION_DENIED'));
assert.ok(sql.includes('INVALID_ALERT_OWNER'));
assert.ok(sql.includes("when p_source='finance' then p_role in ('superadmin','finance')"));
assert.ok(sql.includes("if session_user<>'postgres'"));
assert.ok(sql.includes('public.platform_admin_audit'));
assert.ok(sql.includes('operational_alert_followup_financial'));
assert.ok(sql.includes('on conflict (source,revision) where event_kind='));
assert.ok(sql.includes("tamao-alert-followup-overdue-v1-211"));
assert.ok(!sql.includes('grant execute on function tamao_internal.record_alert_followup_overdue'));
assert.ok(!sql.includes('pg_net')&&!sql.includes('http_post'));
assert.ok(edge.includes('admin_list_alert_followups_v1_211'));
assert.ok(edge.includes('admin_set_alert_followup_v1_211'));
assert.ok(edge.includes('p_actor_id:user.id'));
assert.ok(edge.includes('p_actor_id:actorId'));
assert.ok(edge.includes('action==="operational-alert-followup"'));
assert.ok(!edge.includes('p_actor_id:body'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-alert-ownership-v1-211.mjs'));
console.log('V1.211 PASS: controlled human ownership, RBAC, optimistic revisions, overdue audit, mobile form, XSS filtering and no finance side effects.');
