import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin.js'),edge=read('supabase/functions/admin-ops/index.ts');
const sql=read('supabase/migrations/20261013024000_operational_alert_lifecycle_v1_209.sql');
new vm.Script(ui,{filename:'admin.js'});
const names=['adminOperationalAlertLifecycle','adminOperationalAlertHistoryDate',
  'adminOperationalAlertHistoryNote','adminOperationalAlertHistoryView'];
const extract=name=>{
  const start=ui.indexOf('function '+name+'(');
  const end=ui.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing '+name);
  return ui.slice(start,end+2);
};
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const c=vm.createContext({Date,Number,String,Array,Object,Set,esc:escape});
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.check=adminOperationalAlertLifecycle;'+
 'this.history=adminOperationalAlertHistoryView;'+
 'this.note=adminOperationalAlertHistoryNote;',c);
const moment='2026-10-13T02:43:00Z';
const row=(source='incidents',overrides={})=>({source,status:'active',count:4,
 openSince:moment,lastPositiveAt:moment,lastClearedAt:null,checkedAt:moment,
 consecutiveChecks:3,episodes:1,...overrides});
const transition=(source='incidents',status='active',previous=null)=>({
 source,previous,status,at:moment,count:4
});
const data=(status='current',overrides={})=>({
 available:true,monitor:{status,checkedAt:moment,asOf:moment,cadence:'hourly'},
 states:[row()],events:[transition()],...overrides
});
assert.equal(c.check(null),null);
assert.equal(c.check({available:false}),null);
assert.ok(c.check(data('awaiting_first')));
assert.ok(c.history(c.check(data('awaiting_first'))).includes('Primeira verificação horária'));
assert.ok(!c.history(c.check(data('awaiting_first'))).includes('Normalização confirmada'));
assert.ok(c.note('incidents',c.check(data())).includes('Recorrente'));
assert.ok(c.note('incidents',c.check(data())).includes('3 verificação(ões)'));
assert.equal(c.note('incidents',c.check(data('stale'))),'');
assert.equal(c.note('portals',c.check(data())),'');
assert.ok(c.note('incidents',c.check(data('current',{
 states:[row('incidents',{consecutiveChecks:1})]}))).includes('Primeira detecção'));
assert.ok(c.note('incidents',c.check(data('current',{
 states:[row('incidents',{consecutiveChecks:2})]}))).includes('Persistente em duas'));
assert.equal(c.check(data('invalid')),null);
assert.equal(c.check(data('current',{states:[row('finance',{source:'evil'})]})),null);
assert.equal(c.check(data('current',{states:[row(),row()]})),null);
assert.equal(c.check(data('current',{states:[row('incidents',{count:-1})]})),null);
assert.equal(c.check(data('current',{states:[row('incidents',{checkedAt:'<script>alert(1)</script>'})]})),null);
assert.equal(c.check(data('current',{events:[transition('x')]})),null);
assert.equal(c.check(data('current',{events:Array.from({length:13},()=>transition())})),null);
assert.equal(c.check(data('current',{monitor:{status:'current',checkedAt:'x',asOf:moment}})),null);
let page=c.history(c.check(data('current',{
 events:[transition('incidents','clear','active'),transition('finance','active','active'),
  transition('capture','unknown','active'),transition('support','clear','unknown')]
})));
assert.ok(page.includes('Normalização confirmada'));
assert.ok(page.includes('Agravamento observado'));
assert.ok(page.includes('Fonte não confirmada'));
assert.ok(page.includes('Fonte novamente verificada'));
assert.ok(!page.includes('<script>'));
assert.ok(c.history(null).includes('não confirmado pelo servidor'));
assert.ok(c.history(c.check(data('job_disabled'))).includes('desativado'));
assert.ok(c.history(c.check(data('stale'))).includes('desatualizado'));
for(const marker of [
 'create table if not exists tamao_internal.operational_alert_state_v1_209',
 'create table if not exists tamao_internal.operational_alert_events_v1_209',
 "source in ('incidents','support','finance','capture')",
 "status in ('active','clear','unknown')",
 "when v_next='active' and v_prior.status='active'",
 "when v_next='active' then 1 else 0",
 "when v_next='clear' and v_prior.status='active'",
 "v_next:='unknown'",
 "v_prior.status='active' and v_next='active'",
 "v_count>coalesce(v_prior.current_count,0)",
 'exception when others then',
 'when v_next=\'active\'',
 'public.platform_incidents',
 'public.support_cases',
 'public.reward_processing_failures',
 'public.settlement_accounting_failures',
 'tamao_internal.city_history_health_v1_207(v_now)',
 'if session_user<>\'postgres\'',
 'security invoker',
 'security definer',
 'public.platform_admins',
 'v_sources:=case v_role',
 "when 'finance' then array['incidents','finance']",
 "when 'readonly' then array['incidents','capture']",
 "when 'support' then array['incidents','support']",
 "when v_now-v_checked>interval '90 minutes' then 'stale'",
 'grant execute on function public.admin_operational_alert_lifecycle_v1_209(uuid)',
 "from public,anon,authenticated,service_role",
 "'43 * * * *'",
 'on tamao_internal.operational_alert_events_v1_209(observed_at desc,id desc)'
])assert.ok(sql.includes(marker),'Missing SQL contract: '+marker);
assert.ok(!sql.includes('grant execute on function tamao_internal.'));
assert.ok(!sql.includes('http_post')&&!sql.includes('pg_net'));
assert.ok(!sql.includes('platform_incidents set'));
assert.ok(!sql.includes('update public.platform'));
assert.ok(!sql.includes('auth.users'));
assert.ok(edge.includes('admin_operational_alert_lifecycle_v1_209'));
assert.ok(edge.includes('p_actor_user_id:actorId'));
assert.ok(edge.includes('operational_alerts_v1_208'));
assert.ok(edge.includes('states:data.states,events:data.events'));
assert.ok(ui.includes('adminOperationalAlertHistoryView(present?.lifecycle||null)'));
assert.ok(ui.includes('adminOperationalAlertHistoryNote(item.id,present?.lifecycle)'));
assert.ok(ui.includes('adminOperationalAlertLifecycle(x.data.lifecycle)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-operational-alert-lifecycle-v1-209.mjs'));
console.log('V1.209 passed: DB-only hourly episodes, worsening, unknown-source continuity, normalization, RBAC, history escaping and server-only provenance.');
