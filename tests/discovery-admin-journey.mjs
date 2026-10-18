import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin.js');
const begin=src.indexOf('/* TAMÃO Discovery: one moderation workspace');
const end=src.indexOf('const ADMIN_SECTION_ROLES=',begin);
assert.ok(begin>=0&&end>begin,'single protected admin implementation must exist');
const part=src.slice(begin,end);
assert.doesNotThrow(()=>new vm.Script(part));
const validId='11111111-1111-1111-1111-111111111111';
let role='superadmin',requested=[],rendered=0,notes=[],reason='Documentação conferida para publicação';
const queue=[{
 id:validId,status:'review',vertical:'professionals',
 title:'<script>alert(1)</script>',description:'Prestador no bairro',
 state_code:'RS',city_name:'São Gabriel',photo_urls:[],
 city_vertical_enabled:false,occupation:'Eletricista'
}];
const client={rpc:async(name,args)=>{
 requested.push([name,args]);
 if(name==='discovery_admin_review_queue')return {data:queue,error:null};
 if(name==='discovery_transition_listing')return {data:args.p_next_status,error:null};
 throw Error('Unexpected RPC');
}};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const ctx={
 CHAMA_BACKEND:{url:'https://project.supabase.co'},
 adminRuntime:{client,section:'discovery'},
 adminReady:()=>true,adminCurrentRole:()=>role,
 esc,render:()=>{rendered++;},toast:s=>notes.push(s),
 document:{getElementById:()=>({value:reason})}
};ctx.globalThis=ctx;
vm.runInNewContext(part,ctx,{filename:'admin/discovery-workspace'});
let html=ctx.adminDiscoveryView();
assert.match(html,/Revisão de anúncios/);
await ctx.adminDiscoveryLoad();
assert.equal(rendered,1);
html=ctx.adminDiscoveryView();
assert.match(html,/&lt;script&gt;/);
assert.doesNotMatch(html,/<script>alert/);
assert.match(html,/Aprovar anúncio<\/button>/);
assert.match(html,/disabled>Aprovar anúncio<\/button>/,'disabled city must block approval');
await ctx.adminDiscoveryDecision(validId,'published');
assert.equal(requested.filter(r=>r[0]==='discovery_transition_listing').length,0);
queue[0].city_vertical_enabled=true;
reason='curto';
await ctx.adminDiscoveryDecision(validId,'published');
assert.equal(requested.filter(r=>r[0]==='discovery_transition_listing').length,0);
reason='Conferência de anúncio concluída';
await ctx.adminDiscoveryDecision(validId,'published');
const published=requested.filter(r=>r[0]==='discovery_transition_listing');
assert.equal(published.length,1);
assert.equal(published[0][1].p_next_status,'published');
assert.equal(published[0][1].p_reason,reason);
role='operations';
await ctx.adminDiscoveryLoad();
assert.equal(requested.filter(r=>r[0]==='discovery_admin_review_queue').length,2);
await ctx.adminDiscoveryDecision(validId,'rejected');
assert.equal(requested.filter(r=>r[0]==='discovery_transition_listing').length,1);
assert.equal(ctx.adminDiscoveryView(),'');
assert.ok(src.includes("discovery:new Set(['superadmin'])"));
assert.ok(src.includes("adminMenuButton('discovery','Anúncios'"));
assert.ok(src.includes("adminPanel('discovery'"));
assert.ok(src.includes("if(next==='discovery')adminDiscoveryLoad()"));
const sql=read('supabase/migrations/20261018131000_discovery_shared_verticals.sql');
assert.ok(sql.includes('create function public.discovery_admin_review_queue'));
assert.ok(sql.includes("a.admin_role='superadmin'"));
console.log('PASS: admin-only queue, safe markup, city gate, reason gate, RPC action, existing panel integration.');
