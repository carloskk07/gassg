import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261015024000_merchant_catalog_history_v1_280.sql');
const ops=read('supabase/functions/merchant-ops/index.ts');
const backend=read('js/backend.js'),js=read('js/merchant.js');
const css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
new vm.Script(js,{filename:'merchant.js'});
new vm.Script(backend,{filename:'backend.js'});
const extract=(source,name,asyncFn=false)=>{
 const a=source.indexOf((asyncFn?'async ':'')+'function '+name+'(');
 assert.ok(a>=0,'Missing '+name);
 const b=source.indexOf('\n}',a);
 assert.ok(b>a,'Unterminated '+name);
 return source.slice(a,b+2);
};
assert.match(sql,/create table if not exists public\.merchant_catalog_change_events/i);
assert.match(sql,/alter table public\.merchant_catalog_change_events enable row level security/i);
assert.match(sql,/revoke all on table public\.merchant_catalog_change_events from public,anon,authenticated/i);
assert.match(sql,/grant select on table public\.merchant_catalog_change_events to service_role/i);
assert.doesNotMatch(sql,/grant (insert|update|delete) on table public\.merchant_catalog_change_events to (anon|authenticated)/i);
assert.match(sql,/source_key text not null unique/i);
assert.match(sql,/v_before:=v_catalog/);
assert.match(sql,/when v_existing then v_before\.price_cents else null/);
assert.match(sql,/when v_existing then v_before\.available_stock else null/);
assert.match(sql,/p_user_id,v_role/);
assert.match(sql,/p_idempotency_key/);
assert.match(sql,/if v_action\.completed_at is not null then\s+return v_action\.result_json;/);
assert.ok(sql.indexOf('if v_action.completed_at is not null')<sql.indexOf('insert into public.merchant_catalog_change_events'));
assert.ok(sql.indexOf('insert into public.merchant_catalog_change_events')<sql.indexOf('update public.merchants'));
assert.match(sql,/revoke all on function public\.merchant_catalog_action[\s\S]*from public,anon,authenticated/);
assert.match(ops,/action==="catalog-history"/);
assert.match(ops,/if\(!canManage\(role\)\)throw new DomainError\("MERCHANT_ACCESS_DENIED"/);
const queryBlock=ops.slice(ops.indexOf('if(action==="catalog-history")'),ops.indexOf('if(action==="update-product")'));
assert.match(queryBlock,/\.from\("merchant_catalog_change_events"\)/);
assert.match(queryBlock,/\.eq\("merchant_id",merchantId\)/);
assert.match(queryBlock,/\.limit\(31\)/);
assert.match(queryBlock,/readOnly:true/);
assert.doesNotMatch(queryBlock,/\.insert\(|\.update\(|\.delete\(/);
assert.match(ops,/\.eq\("user_id",user.id\)/);

const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const rt={status:'ready',session:{user:{id:'00000000-0000-4000-8000-000000000007'}},merchant:{merchantId:'00000000-0000-4000-8000-000000000003',memberRole:'owner'},
 catalog:[{productCode:'P13',productName:'Botijão P13'}]};
const mctx=vm.createContext({esc,Date,BRL:{format:n=>'R$ '+Number(n).toFixed(2)},
 globalThis:{merchantRuntime:rt},render:()=>{},merchantCatalogHistoryLive:async()=>[]});
vm.runInContext(extract(js,'merchantCatalogHistoryView')+';this.view=merchantCatalogHistoryView;',mctx);
let html=mctx.view(rt);
assert.match(html,/Histórico real de preços e estoque/);
assert.match(html,/Consultar histórico/);
assert.match(html,/a partir da ativação/);
assert.doesNotMatch(html,/<article/);
mctx.globalThis.merchantCatalogHistoryState={merchantId:rt.merchant.merchantId,userId:rt.session.user.id,status:'ready',events:[
 {id:1,productCode:'P13',actorName:'Gerente <script>bad()</script>',actorRole:'manager',
  actorId:'00000000-0000-4000-8000-000000000002',action:'updated',
  oldPriceCents:12000,newPriceCents:12500,oldStock:3,newStock:5,
  oldActive:true,newActive:false,recordedAt:'2026-10-15T02:00:00Z'},
 {id:2,productCode:'NEWITEM',actorName:'',actorRole:'owner',actorId:'00000000-0000-4000-8000-000000000001',
  action:'created',oldPriceCents:null,newPriceCents:1900,oldStock:null,newStock:2,
  oldActive:null,newActive:true,recordedAt:'2026-10-15T02:01:00Z'}
]};
html=mctx.view(rt);
assert.match(html,/merchant-catalog-history" open/);
assert.match(html,/Botijão P13/);
assert.match(html,/R\$ 120\.00 → R\$ 125\.00/);
assert.match(html,/3 → 5/);
assert.match(html,/Responsável 00000000/);
assert.match(html,/Gerente &lt;script&gt;/);
assert.doesNotMatch(html,/<script>bad/);
assert.match(html,/Cadastro do produto/);
assert.match(html,/Disponibilidade: Ativo → Pausado/);
assert.match(html,/até 30 por página/);
rt.merchant.memberRole='operator';
assert.equal(mctx.view(rt),'');
rt.merchant.memberRole='manager';
assert.match(mctx.view(rt),/Histórico real/);
rt.merchant.merchantId='00000000-0000-4000-8000-000000000099';
assert.doesNotMatch(mctx.view(rt),/Gerente &lt;script&gt;/,'Never show a different merchant history');
rt.merchant.merchantId='00000000-0000-4000-8000-000000000003';

let received=[],requests=0;
const bctx=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async(_fn,payload)=>{
 received.push(payload);return {source:'merchant_catalog_history_v1_280',merchantId:rt.merchant.merchantId,
 readOnly:true,events:[{id:10}]};
 }});
vm.runInContext(extract(backend,'merchantCatalogHistoryLive',true)+';this.load=merchantCatalogHistoryLive;',bctx);
let loaded=await bctx.load(rt.merchant.merchantId);
assert.equal(loaded.length,1);
assert.equal(received[0].action,'catalog-history');
assert.equal(received[0].merchantId,rt.merchant.merchantId);
rt.merchant.memberRole='operator';
await assert.rejects(()=>bctx.load(rt.merchant.merchantId),/proprietário ou gerente/);
rt.merchant.memberRole='owner';
await assert.rejects(()=>bctx.load('wrong-merchant'),/proprietário ou gerente/);
bctx.merchantInvoke=async()=>({source:'wrong',merchantId:rt.merchant.merchantId,events:[]});
await assert.rejects(()=>bctx.load(rt.merchant.merchantId),/Histórico não confirmado/);

let resolve;
const promised=new Promise(r=>resolve=r);
let renders=0;
const client=vm.createContext({globalThis:{merchantRuntime:rt},render:()=>{renders++;},
 merchantCatalogHistoryPageLive:()=>promised});
vm.runInContext(extract(js,'merchantQuickHistoryLoad',true)+';this.start=merchantQuickHistoryLoad;',client);
const pending=client.start();
assert.equal(client.globalThis.merchantCatalogHistoryState.status,'loading');
assert.equal(renders,1);
const repeated=await client.start();
assert.equal(repeated,undefined);
rt.merchant.merchantId='00000000-0000-4000-8000-000000000099';
resolve({events:[{id:44}],hasMore:false,nextBeforeId:null});await pending;
assert.equal(client.globalThis.merchantCatalogHistoryState.merchantId,'00000000-0000-4000-8000-000000000003');
assert.notEqual(client.globalThis.merchantCatalogHistoryState.status,'ready','No cross-merchant leak after async switch');
assert.equal(renders,1);
rt.merchant.merchantId='00000000-0000-4000-8000-000000000003';
rt.merchant.memberRole='driver';
assert.equal(await client.start(),undefined);
rt.merchant.memberRole='owner';

assert.match(css,/\.merchant-catalog-history-rows/);
assert.match(audit,/node tests\/merchant-audit-history-v1-280.mjs/);
console.log('V1.280 PASS — transactional audit contract, scoped history query, XSS, roles and async merchant isolation.');
