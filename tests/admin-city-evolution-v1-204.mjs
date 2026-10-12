import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin-acquisition.js'),admin=read('js/admin.js');
new vm.Script(source,{filename:'admin-acquisition.js'});
new vm.Script(admin,{filename:'admin.js'});
const fn=name=>{
 const asyncAt=source.indexOf('async function '+name+'(');
 const a=asyncAt>=0?asyncAt:source.indexOf('function '+name+'(');
 const b=source.indexOf('\n}',a);
 assert.ok(a>=0&&b>a,'Missing '+name);
 return source.slice(a,b+2);
};
let role='operations',fresh=true,valid=true,limited=false,renders=0,refreshes=0,radarRefreshes=0;
const base=[
 {key:'RS:sao-gabriel',label:'São Gabriel/RS',paused:false,available:1,registered:1,
  interests:12,anp:5,overdue:0,openProspects:0,onboarding:0},
 {key:'RS:pelotas',label:'Pelotas/RS',paused:false,available:0,registered:1,
  interests:20,anp:5,overdue:2,openProspects:2,onboarding:1},
 {key:'RS:santa-maria',label:'Santa Maria/RS',paused:false,available:0,registered:0,
  interests:7,anp:4,overdue:0,openProspects:2,onboarding:0},
 {key:'RS:bage',label:'Bagé/RS',paused:false,available:0,registered:0,
  interests:5,anp:null,overdue:null,openProspects:null,onboarding:0},
 {key:'RS:alegrete',label:'Alegrete/RS',paused:true,available:2,registered:2,
  interests:8,anp:2,overdue:0,openProspects:0,onboarding:0},
 {key:'RS:cacequi',label:'Cacequi/RS',paused:false,available:null,registered:0,
  interests:null,anp:null,overdue:null,openProspects:null,onboarding:null}
];
let rows=base.map(x=>({...x}));
const state={status:'ready',session:{user:{id:'user-one'}},data:{},cityEvolutionBaseline:null,
  cityEvolutionRefreshing:false,lastSyncAt:new Date().toISOString(),
  expansionRadarCheckedAt:new Date().toISOString()};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({adminRuntime:state,Date,String,Number,Object,Array,Map,
 esc,render:()=>renders++,toast:()=>{},
 adminRoleCanSection:section=>section==='prospects'&&role!=='finance',
 adminCityPipelineSnapshot:()=>({valid,fresh,items:rows,limited,cityCount:rows.length}),
 adminRefresh:async()=>{refreshes++;state.lastSyncAt=new Date(Date.now()+1000).toISOString()},
 adminLoadExpansionRadar:async()=>{radarRefreshes++;state.expansionRadarCheckedAt=new Date(Date.now()+2000).toISOString()}});
const names=['adminCityEvolutionStage','adminCityEvolutionSnapshot',
 'adminCityEvolutionCapture','adminCityEvolutionClear','adminCityEvolutionRefresh',
 'adminCityEvolutionCityNote','adminCityEvolutionView'];
vm.runInContext(names.map(fn).join('\n')+
 '\nthis.stage=adminCityEvolutionStage;this.snapshot=adminCityEvolutionSnapshot;'+
 'this.capture=adminCityEvolutionCapture;this.clear=adminCityEvolutionClear;'+
 'this.refresh=adminCityEvolutionRefresh;this.note=adminCityEvolutionCityNote;'+
 'this.view=adminCityEvolutionView;',ctx);
let snap=ctx.snapshot({});
assert.equal(snap.status,'none');
assert.equal(snap.rows.length,6);
assert.equal(snap.totals.offer,1);
assert.equal(snap.totals.registered,1);
assert.equal(snap.totals.prospecting,1);
assert.equal(snap.totals.interest,1);
assert.equal(snap.totals.paused,1);
assert.equal(snap.totals.unknown,1);
assert.ok(ctx.view(snap).includes('Como estão evoluindo as cidades?'));
assert.ok(ctx.view(snap).includes('não é histórico permanente'));
assert.ok(!ctx.view(snap).includes('Vendas confirmadas'));
assert.ok(ctx.note('RS:sao-gabriel',snap).includes('Oferta verificada'));
ctx.capture();
assert.ok(state.cityEvolutionBaseline);
assert.equal(state.cityEvolutionBaseline.user,'user-one');
assert.equal(ctx.snapshot({}).status,'waiting');
const initial=state.cityEvolutionBaseline;
assert.equal(initial.rows.length,6);
rows[1].available=1;
rows[1].interests=23;
rows[0].overdue=3;
rows=[rows[1],rows[0],...rows.slice(2)]; // city order changes when commercial priorities change
assert.equal(ctx.snapshot({}).status,'waiting','must re-check BOTH sources');
await ctx.refresh();
assert.equal(refreshes,1);assert.equal(radarRefreshes,1);
snap=ctx.snapshot({});
assert.equal(snap.status,'compared','city identity, not display order, defines comparable coverage');
assert.equal(snap.changes.get('RS:pelotas').delta.interests,3);
assert.equal(snap.changes.get('RS:pelotas').delta.available,1);
assert.equal(snap.changes.get('RS:sao-gabriel').delta.overdue,3);
assert.ok(ctx.note('RS:pelotas',snap).includes('Mudança de sinal'));
assert.ok(ctx.note('RS:pelotas',snap).includes('interesses +3'));
assert.ok(ctx.view(snap).includes('não comprovam conversão individual'));
ctx.capture();
assert.equal(ctx.snapshot({}).status,'waiting','new reference resets comparison');
rows.push({key:'RS:new-town',label:'Outra cidade/RS',paused:false,interests:3,available:null,registered:0});
state.expansionRadarCheckedAt=new Date(Date.now()+6000).toISOString();
state.lastSyncAt=new Date(Date.now()+6000).toISOString();
snap=ctx.snapshot({});
assert.equal(snap.status,'coverage','changing city set must invalidate deltas');
assert.equal(snap.changes.size,0);
assert.ok(ctx.view(snap).includes('cobertura de municípios mudou'));
ctx.clear();
assert.equal(state.cityEvolutionBaseline,null);
limited=true;
ctx.capture();
assert.equal(state.cityEvolutionBaseline,null,'never allow sampled reference');
snap=ctx.snapshot({});
assert.ok(ctx.view(snap).includes('Amostra parcial'));
assert.ok(ctx.view(snap).includes('disabled title="Amostra parcial'));
limited=false;
valid=false;ctx.capture();
assert.equal(state.cityEvolutionBaseline,null);
valid=true;fresh=false;ctx.capture();
assert.equal(state.cityEvolutionBaseline,null);
assert.equal(ctx.snapshot({}).status,'stale');
fresh=true;
role='finance';ctx.capture();
assert.equal(state.cityEvolutionBaseline,null);
role='operations';state.status='unauthenticated';ctx.capture();
assert.equal(state.cityEvolutionBaseline,null);
state.status='ready';ctx.capture();
assert.ok(state.cityEvolutionBaseline);
state.session={user:{id:'user-two'}};
assert.equal(ctx.snapshot({}).status,'none','cross-account reference must not be visible');
state.session={user:{id:'user-one'}};
state.cityEvolutionBaseline.capturedAt=Date.now()-25*60*60*1000;
assert.equal(ctx.snapshot({}).status,'expired');
state.cityEvolutionBaseline.capturedAt=Date.now();
state.expansionRadarCheckedAt=new Date(Date.now()+5000).toISOString();
state.lastSyncAt=new Date(Date.now()+5000).toISOString();
rows[0].interests=null;
const stage=ctx.stage({available:null,registered:null,interests:null,anp:null,
  onboarding:null,openProspects:null,paused:false});
assert.equal(stage.id,'unknown','null values cannot become funnel progress');
const bad=ctx.note('RS:pelotas',{rows:[{key:'RS:pelotas',stageLabel:'<script>bad</script>'}],
 status:'none'});
assert.ok(!bad.includes('<script>'));
assert.ok(bad.includes('&lt;script&gt;'));
assert.equal((admin.match(/adminRuntime[.]cityEvolutionBaseline=null;/g)||[]).length,3);
assert.ok(admin.includes('cityEvolutionBaseline:null'));
assert.ok(admin.includes('cityEvolutionRefreshing:false'));
assert.ok(source.includes('adminCityEvolutionView(evolution)'));
assert.ok(source.includes('adminCityEvolutionCityNote(row.key,evolution)'));
assert.ok(!names.map(fn).join('\n').includes('adminPerform('));
assert.ok(!names.map(fn).join('\n').includes('adminSaveProspect('));
assert.ok(read('css/components.css').includes('.admin-evolution-kpis'));
assert.ok(read('css/components.css').includes('@media(max-width:340px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-city-evolution-v1-204.mjs'));
console.log('V1.204 OK: city signal stages, session-only reference, freshness, coverage, RBAC, escaping and zero writes.');
