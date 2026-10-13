import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin.js');
const sql=read('supabase/migrations/20261013052500_alert_ack_overdue_v1_215.sql');
new vm.Script(src,{filename:'admin.js'});
const names=['adminOperationalFollowupsSafe','adminOperationalFollowupsEventsView',
 'adminOperationalFollowupsEscalationsView','adminOperationalMyQueueModel',
 'adminOperationalMyQueueView','adminOperationalAlertHistoryDate'];
const get=name=>{
 const start=src.indexOf('function '+name+'('),end=src.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing function '+name);
 return src.slice(start,end+2);
};
const actor='11111111-1111-4111-8111-111111111111';
const another='22222222-2222-4222-8222-222222222222';
const now=new Date().toISOString();
const due=new Date(Date.now()+24*3600000).toISOString();
const form=(source,ownerId,urgency,ackStatus)=>({
 source,ownerId,dueAt:due,status:'open',
 note:'Confirmar ciência e tratamento.',revision:3,updatedAt:now,
 overdue:false,ownerEligible:true,urgency,ackStatus,
 acknowledgedAt:null
});
let role='superadmin';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const vmContext=vm.createContext({Date,String,Number,Array,Set,Map,esc,
 adminCurrentRole:()=>role,adminOperationalConfirmAck(){},adminOperationalFollowupFocus(){}});
vm.runInContext(names.map(get).join('\n')+
 '\nthis.safe=adminOperationalFollowupsSafe;'+
 'this.escalation=adminOperationalFollowupsEscalationsView;'+
 'this.queueModel=adminOperationalMyQueueModel;'+
 'this.queueView=adminOperationalMyQueueView;'+
 'this.eventsView=adminOperationalFollowupsEventsView;',vmContext);
const data={available:true,checkedAt:now,
 items:[form('support',actor,'on_track','overdue'),
        form('capture',actor,'overdue','acknowledged'),
        form('incidents',another,'on_track','pending')],
 owners:[{id:actor,role:'superadmin'},{id:another,role:'operations'}],
 events:[{source:'support',kind:'ack_overdue',revision:3,at:now,actorId:null}]};
const val=vmContext.safe(data);
assert.ok(val);
const html=vmContext.escalation(val);
assert.ok(html.includes('Prazos que exigem atenção'));
assert.ok(html.includes('Ciência do responsável não confirmada há mais de 2 horas'));
assert.ok(html.includes('Atendimentos'));
assert.ok(html.includes('Capturas comerciais'));
assert.equal((html.match(/admin-alert-escalation-row/g)||[]).length,2,
 'One escalation row per source, even when due date and acknowledgment are both overdue');
const q=vmContext.queueModel(val,actor);
assert.equal(q.total,2);
assert.equal(q.critical,2,'Overdue acknowledgement counts even with future delivery deadline');
assert.equal(q.items[0].source,'support','Owner acknowledgement outranks a later deadline');
assert.ok(vmContext.queueView(val,actor).includes('Ciência pendente há mais de 2 horas'));
assert.ok(vmContext.eventsView(val).includes('Ciência do responsável não confirmada no prazo'));
assert.equal(vmContext.safe({...data,events:[{source:'support',kind:'unapproved',
  revision:3,at:now}]}),null);
role='finance';
assert.equal(vmContext.safe(data),null,'No cross-department financial leakage');
role='support';
const support=vmContext.safe({...data,items:[form('support',actor,'on_track','overdue')],
 events:[{source:'support',kind:'ack_overdue',revision:3,at:now,actorId:null}]});
assert.ok(support);
assert.ok(vmContext.escalation(support).includes('Ciência do responsável não confirmada'));
for(const required of [
 'admin_alert_followup_events_v1_211_event_kind_check',
 "'ack_overdue'",
 "unique index if not exists admin_alert_ack_overdue_once_v1_215",
 'create or replace function tamao_internal.record_alert_ack_overdue_v1_215()',
 'security invoker',
 "session_user<>'postgres'",
 "f.status<>'closed'",
 'owner.active',
 "f.updated_at<=clock_timestamp()-interval '2 hours'",
 "e.event_kind='acknowledged'",
 "e.actor_user_id=f.owner_id",
 "on conflict (source,revision) where event_kind='ack_overdue' do nothing",
 "revoke all on function tamao_internal.record_alert_ack_overdue_v1_215()",
 'from public,anon,authenticated,service_role',
 "'23 * * * *'"
])assert.ok(sql.includes(required),'Missing SQL contract: '+required);
assert.ok(!sql.includes('grant execute on function tamao_internal'));
assert.ok(!sql.includes('http_post')&&!sql.includes('pg_net'));
assert.ok(!sql.includes('update public.admin_alert_followups'));
assert.ok(!sql.includes('delete from public'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-alert-ack-escalation-v1-215.mjs'));
console.log('V1.215 PASS: reliable overdue acknowledgment, deduplication, safe chronology, clear owner routing and strict admin roles.');
