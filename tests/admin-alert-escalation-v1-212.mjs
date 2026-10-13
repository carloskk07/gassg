import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin.js'),migration=read('supabase/migrations/20261013041500_alert_followup_escalation_v1_212.sql');
new vm.Script(src,{filename:'admin.js'});
const names=['adminOperationalFollowupsSafe','adminOperationalFollowupCanWrite',
 'adminOperationalFollowupEditView','adminOperationalFollowupsEscalationsView',
 'adminOperationalFollowupsDormantView','adminOperationalAlertHistoryDate'];
const extract=name=>{
 const start=src.indexOf('function '+name+'(');
 const end=src.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Not found: '+name);
 return src.slice(start,end+2);
};
let role='superadmin';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const c=vm.createContext({Date,Array,String,Number,Map,Set,esc,
 adminCurrentRole:()=>role});
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.safe=adminOperationalFollowupsSafe;this.escalations=adminOperationalFollowupsEscalationsView;'+
 'this.card=adminOperationalFollowupEditView;',c);
const owner='22222222-2222-4222-8222-222222222222';
const validDate='2026-10-14T16:00:00Z';
const row=(source,urgency,overrides={})=>({
 source,ownerId:owner,dueAt:validDate,status:'open',note:'Conferir pendencias com a equipe.',
 revision:2,updatedAt:validDate,overdue:['overdue','severely_overdue'].includes(urgency),
 ownerEligible:urgency!=='owner_unavailable',urgency,...overrides
});
const pack=(items)=>({available:true,items,owners:[{id:owner,role:'superadmin'}],events:[]});
let x=c.safe(pack([
 row('support','due_soon'),row('finance','severely_overdue'),
 row('incidents','owner_unavailable'),row('capture','overdue')
]));
assert.ok(x);
let html=c.escalations(x);
assert.ok(html.includes('4 situação(ões) crítica(s)')===false);
assert.ok(html.includes('3 situação(ões) crítica(s)'));
assert.ok(html.includes('Responsável sem acesso atual'));
assert.ok(html.includes('Atraso superior a 24 horas'));
assert.ok(html.includes('Prazo próximo (até 2 horas)'));
assert.ok(html.indexOf('Incidentes')<html.indexOf('Processamento financeiro'));
assert.ok(html.indexOf('Processamento financeiro')<html.indexOf('Capturas comerciais'));
assert.ok(html.indexOf('Capturas comerciais')<html.indexOf('Atendimentos'));
assert.ok(html.includes('não são reatribuídos automaticamente'));
assert.ok(c.card('finance',x).includes('Prazo vencido há 24 horas'));
assert.ok(c.card('incidents',x).includes('Responsável sem acesso autorizado'));
assert.equal(c.escalations(c.safe(pack([row('support','on_track')]))),'');
assert.equal(c.escalations(c.safe(pack([row('support','closed',{
 status:'closed',overdue:false,ownerEligible:false})]))),'');
assert.ok(c.escalations(null).includes('não verificados'));
assert.equal(c.safe(pack([row('support','bogus')])),null);
assert.equal(c.safe(pack([row('support','due_soon',{ownerEligible:'true'})])),null);
assert.equal(c.safe(pack([row('support','due_soon',{dueAt:'<script>x</script>'})])),null);
const attack=pack([row('finance','overdue',{note:'<img src=x onerror=alert(1)>'})]);
assert.ok(!c.card('finance',c.safe(attack)).includes('<img'));
role='support';
assert.equal(c.safe(pack([row('finance','overdue')])),null);
assert.ok(!c.escalations(c.safe(pack([row('support','due_soon')]))).includes('Financeiro'));
role='readonly';
assert.ok(c.safe(pack([row('capture','owner_unavailable')])));
assert.equal(c.card('capture',c.safe(pack([row('capture','owner_unavailable')]))).includes('Salvar acompanhamento'),false);
assert.ok(migration.includes('create or replace function public.admin_list_alert_followups_v1_211'));
assert.ok(migration.includes('left join public.platform_admins owner on owner.user_id=f.owner_id'));
assert.ok(migration.includes("'ownerEligible'"));
assert.ok(migration.includes("'urgency',case"));
for(const t of ["'closed'","'owner_unavailable'","'severely_overdue'","'overdue'","'due_soon'","'on_track'"]){
 assert.ok(migration.includes(t),'SQL tier missing '+t);
}
assert.ok(migration.includes("owner.active is not true"));
assert.ok(migration.includes("f.due_at<=v_now-interval '24 hours'"));
assert.ok(migration.includes("f.due_at<=v_now+interval '2 hours'"));
assert.ok(migration.includes('admin_alert_source_allowed_v1_211(v_role,f.source,false)'));
assert.ok(migration.includes('revoke all on function public.admin_list_alert_followups_v1_211(uuid)'));
assert.ok(migration.includes('grant execute on function public.admin_list_alert_followups_v1_211(uuid)'));
assert.ok(!migration.includes('grant execute on function tamao_internal.'));
assert.ok(!migration.includes('update public.admin_alert_followups_v1_211'));
assert.ok(!migration.includes('http_post')&&!migration.includes('pg_net'));
assert.ok(src.includes('adminOperationalFollowupsEscalationsView('));
assert.ok(read('css/components.css').includes('.admin-alert-escalation-row'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-alert-escalation-v1-212.mjs'));
console.log('V1.212 OK: trustworthy database SLA tiers, inactive owners, 24h backlog, 2h advance notice, role scoping, no automatic reassignment or financial action.');
