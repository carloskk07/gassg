import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin-acquisition.js');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const sql=read('supabase/migrations/20261012231000_admin_city_commercial_history_v1_205.sql');
new vm.Script(source,{filename:'admin-acquisition.js'});
new vm.Script(admin,{filename:'admin.js'});
const extract=name=>{
  const start=source.indexOf((name==='adminLoadCityHistory'||name==='adminCaptureCityHistory'?'async ':'')+'function '+name+'(');
  const end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing '+name);
  return source.slice(start,end+2);
};
const iso=(mins)=>new Date(Date.now()+mins*60000).toISOString();
const makeRows=(registered=0)=>[
 {key:'RS:sao-gabriel',label:'São Gabriel/RS',interests:8,registered,eligible:0,overdue:3,paused:false},
 {key:'RS:pelotas',label:'Pelotas/RS',interests:7,registered:0,eligible:0,overdue:0,paused:false}
];
const snapshot=(id,time,rows,extra={})=>({id,capturedAt:iso(time),
 cityCount:rows.length,sampled:false,source:'admin_expansion_radar_v1_154',rows,...extra});
const list=[snapshot('new',0,makeRows(2)),snapshot('old',-90,makeRows(1))];
const runtime={status:'ready',session:{user:{id:'person-A'}},
 cityHistory:{items:[],loading:false,loaded:false,error:null,loadedFor:null,chosen:null,saving:false},
 data:{}};
let role='operations',readCalls=0,writeCalls=0,renders=0,toastText='',responseList=list;
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let respond=async body=>{
 if(body.action==='commercial-history-list'){readCalls++;return {source:'database_authoritative',snapshots:responseList};}
 if(body.action==='commercial-history-capture'){writeCalls++;return {id:'new',inserted:true,source:'server_authoritative'};}
 throw new Error('unexpected action');
};
const context=vm.createContext({
 adminRuntime:runtime,Date,Number,String,Array,Object,Map,
 adminReady:()=>runtime.status==='ready',
 adminRoleCanSection:section=>section==='prospects'&&role!=='finance',
 adminCurrentRole:()=>role,
 adminInvoke:(...args)=>respond(...args),
 adminIdempotency:()=> 'commercial-history:uuid-v1-205',
 render:()=>renders++,
 toast:t=>{toastText=t;},
 esc
});
const funcs=['adminCityHistoryReset','adminLoadCityHistory','adminCaptureCityHistory',
 'adminChooseCityHistory','adminCityHistoryCompare','adminCityCommercialHistoryView'];
vm.runInContext(funcs.map(extract).join('\n')+
 '\nthis.reset=adminCityHistoryReset;this.load=adminLoadCityHistory;'+
 'this.capture=adminCaptureCityHistory;this.choose=adminChooseCityHistory;'+
 'this.compare=adminCityHistoryCompare;this.view=adminCityCommercialHistoryView;',context);
let cmp=context.compare(list,null);
assert.equal(cmp.status,'comparable');
assert.equal(cmp.changes.length,1);
assert.equal(cmp.changes[0].metrics.registered,1);
assert.equal(cmp.changes[0].metrics.interests,0);
assert.equal(context.compare([list[0]],null).status,'insufficient');
assert.equal(context.compare([{...list[0],sampled:true},list[1]],null).status,'sampled');
assert.equal(context.compare([list[0],{...list[1],rows:[list[1].rows[0]]}],null).status,'coverage');
assert.equal(context.compare([list[0],{...list[1],cityCount:9}],null).status,'coverage');
assert.equal(context.compare([list[0],{...list[1],rows:[list[1].rows[1],list[1].rows[0]]}],null).status,'comparable',
 'Reordered city identities stay comparable');
assert.equal(context.compare([list[0],{...list[1],rows:makeRows(1).map(x=>({...x,registered:null}))}],null)
 .changes.length,0,'Unknown historical metrics never become artificial zero differences');
assert.equal(context.view().includes('Evolução registrada no banco'),true);
assert.ok(context.view().includes('Retratos oficiais por cidade'));
await context.load();
assert.equal(readCalls,1);
assert.equal(runtime.cityHistory.items.length,2);
assert.equal(runtime.cityHistory.loadedFor,'person-A');
assert.ok(context.view().includes('revendas cadastradas: +1'));
assert.ok(context.view().includes('Não mede')||context.view().includes('não mede taxa de conversão'));
await context.load();
assert.equal(readCalls,1,'Loaded history is not fetched repeatedly');
context.choose('old');
assert.equal(runtime.cityHistory.chosen,'old');
context.choose('malicious');
assert.equal(runtime.cityHistory.chosen,'old');
context.choose('');
assert.equal(runtime.cityHistory.chosen,null);
await context.capture();
assert.equal(writeCalls,1);
assert.equal(readCalls,2,'Capture must reload database-authoritative data');
assert.ok(toastText.includes('registrado'));
role='readonly';await context.capture();
assert.equal(writeCalls,1,'Readonly cannot capture');
assert.ok(context.view().includes('Consultar histórico'));
assert.ok(!context.view().includes('Registrar retrato agora'));
role='finance';assert.equal(context.view(),'');
await context.load({force:true});
assert.equal(readCalls,2,'Finance role cannot load commercial history');
role='operations';runtime.status='unauthenticated';
await context.capture();
assert.equal(writeCalls,1);
runtime.status='ready';
responseList=[snapshot('evil',0,[{...makeRows()[0],
 label:'<script>alert(1)</script>', key:"x' onclick='alert(1)"}]),list[1]];
await context.load({force:true});
assert.ok(!context.view().includes('<script>'));
assert.ok(!context.view().includes("onclick='alert(1)'"));
runtime.session={user:{id:'person-B'}};
assert.ok(!context.view().includes('revendas cadastradas: +1'),'Cross-session data must be hidden');
context.reset();
assert.equal(runtime.cityHistory.loaded,false);
assert.ok(admin.includes('cityHistory:{items:[],loading:false'));
assert.equal((admin.match(/adminRuntime[.]cityHistory=\{items:\[\]/g)||[]).length,3,
 'Logout, 403 and 401 cleanup must erase persistent history state');
assert.ok(admin.includes('adminLoadCityHistory().catch(()=>{})'));
assert.ok(source.includes('adminCityCommercialHistoryView()+adminExpansionRadarSection()'));
assert.ok(source.includes('idempotencyKey:adminIdempotency'));
assert.ok(!funcs.map(extract).join('\n').includes('adminPerform('));
assert.ok(!funcs.map(extract).join('\n').includes('adminSaveProspect('));
assert.ok(read('css/components.css').includes('.admin-city-history-compare'));
assert.ok(read('css/components.css').includes('@media(max-width:340px)'));
assert.ok(edge.includes('"commercial-history-list"'));
assert.ok(edge.includes('action==="commercial-history-capture"'));
assert.ok(edge.includes('admin_capture_city_commercial_history_v1_205'));
assert.ok(edge.includes('admin_list_city_commercial_history_v1_205'));
assert.ok(edge.includes('const adminAccess=await requireAdmin(admin,user.id)'));
assert.ok(sql.includes('enable row level security'));
assert.ok(sql.includes('revoke all on table'));
assert.ok(sql.includes('grant select,insert on table'));
assert.ok(sql.includes('to service_role;'));
assert.ok(sql.includes('on conflict(snapshot_bucket) do nothing'));
assert.ok(sql.includes('public.admin_expansion_radar(60)'));
assert.ok(!sql.includes('grant execute on function public.admin_capture_city_commercial_history_v1_205(uuid)\n  to authenticated'));
assert.ok(!sql.includes('create policy'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-city-commercial-history-v1-205.mjs'));
console.log('V1.205 persistent history passed: authenticated server-only snapshots, immutable time buckets, RBAC, no PII, safe comparisons, session hygiene and no commercial writes.');
