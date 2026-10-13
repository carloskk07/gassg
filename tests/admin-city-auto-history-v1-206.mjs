import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013011500_daily_city_commercial_history_v1_206.sql');
const acq=read('js/admin-acquisition.js'),admin=read('js/admin.js');
new vm.Script(acq,{filename:'admin-acquisition.js'});
new vm.Script(admin,{filename:'admin.js'});
const must=x=>assert.ok(sql.includes(x),'Missing SQL: '+x);
must('alter column actor_user_id drop not null');
must("capture_origin='manual' and actor_user_id is not null");
must("capture_origin='scheduled' and actor_user_id is null");
must('create schema if not exists tamao_internal');
must('revoke all on schema tamao_internal from public,anon,authenticated,service_role');
must('security invoker');
must("session_user <> 'postgres'");
must('public.admin_expansion_radar(60)');
must("r.anp_source_status='ok'");
must("where snapshot_bucket=v_bucket");
must('on conflict(snapshot_bucket) do nothing');
must("select tamao_internal.capture_city_commercial_history_auto_v1_206();");
must("revoke all on function tamao_internal.capture_city_commercial_history_auto_v1_206()");
must("from public,anon,authenticated,service_role");
must("capture_origin text not null default 'manual'");
must("'origin',s.capture_origin");
must("'scheduler',jsonb_build_object");
must("j.active");
must("'18 12 * * *'");
assert.equal((sql.match(/cron[.]schedule[(]/g)||[]).length,1);
assert.ok(!sql.includes('grant usage on schema tamao_internal to authenticated'));
assert.ok(!sql.includes('grant execute on function tamao_internal.'));
assert.ok(!sql.includes('pg_net'));
assert.ok(!sql.includes('http_post'));
assert.ok(!sql.includes('service_role_key'));
assert.ok(!sql.includes('actor_user_id uuid not null'));
const extract=name=>{
  const asyncName=['adminLoadCityHistory'].includes(name);
  const start=acq.indexOf((asyncName?'async ':'')+'function '+name+'(');
  const end=acq.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,name+' missing');return acq.slice(start,end+2);
};
let reads=0,renderCount=0,permission='operations',response={
  source:'database_authoritative',
  scheduler:{active:true,cadence:'daily',utcTime:'12:18'},
  snapshots:[{id:'a',capturedAt:new Date('2026-10-13T12:18:00Z').toISOString(),
    cityCount:1,sampled:false,origin:'scheduled',rows:[{key:'RS:sao-gabriel',
    label:'São Gabriel/RS',interests:2,registered:1,eligible:1,overdue:0}]},
    {id:'b',capturedAt:'2026-10-12T12:18:00Z',
    cityCount:1,sampled:false,origin:'manual',rows:[{key:'RS:sao-gabriel',
    label:'São Gabriel/RS',interests:1,registered:1,eligible:0,overdue:1}]}]
};
const runtime={status:'ready',session:{user:{id:'A'}},cityHistory:{
  items:[],loaded:false,loadedFor:null,scheduler:null,loading:false,error:null,chosen:null
}};
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({Date,Number,Object,Array,String,Map,adminRuntime:runtime,
  esc:escape,adminReady:()=>runtime.status==='ready',
  adminRoleCanSection:section=>section==='prospects'&&permission!=='finance',
  adminCurrentRole:()=>permission,
  adminInvoke:async body=>{assert.equal(body.action,'commercial-history-list');reads++;return response;},
  render:()=>renderCount++
});
const names=['adminCityHistoryReset','adminLoadCityHistory','adminCityHistoryCompare',
  'adminCityCommercialHistoryView'];
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.load=adminLoadCityHistory;this.view=adminCityCommercialHistoryView;'+
 'this.reset=adminCityHistoryReset;this.compare=adminCityHistoryCompare;',ctx);
await ctx.load();
assert.equal(reads,1);
assert.equal(runtime.cityHistory.scheduler.active,true);
let view=ctx.view();
assert.ok(view.includes('Agendamento diário: ativo'));
assert.ok(view.includes('09h18'));
assert.ok(view.includes('Automático'));
assert.ok(view.includes('manual'));
assert.ok(view.includes('revendas aptas: +1'));
assert.ok(!view.includes('faturamento confirmado'));
response={...response,scheduler:{...response.scheduler,active:false}};
await ctx.load({force:true});
assert.equal(reads,2);
assert.ok(ctx.view().includes('Agendamento diário: inativo'));
response={...response,scheduler:null};
await ctx.load({force:true});
assert.ok(ctx.view().includes('Agendamento diário: não verificado'));
response={...response,
  snapshots:response.snapshots.map((s,i)=>({...s,origin:i===0?'scheduled':'manual',
    capturedAt:i===0?'<script>alert(1)</script>':s.capturedAt}))};
await ctx.load({force:true});
assert.ok(!ctx.view().includes('<script>'),'History timestamps must be escaped/invalidated');
runtime.session={user:{id:'B'}};
view=ctx.view();
assert.ok(!view.includes('Agendamento diário:'));
assert.ok(!view.includes('revendas aptas: +1'));
ctx.reset();
assert.equal(runtime.cityHistory.scheduler,null);
assert.ok(admin.includes('scheduler:null'));
assert.equal((admin.match(/adminRuntime[.]cityHistory=[{]items:[[]]/g)||[]).length,3);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-city-auto-history-v1-206.mjs'));
console.log('V1.206 passed: private cron function, no human spoofing, daily schedule, server source, dedupe, role protections, UI provenance and state isolation.');
