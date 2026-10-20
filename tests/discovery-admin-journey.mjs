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
const docKey='00000000-0000-0000-0000-000000000011/'+validId+
 '/22222222-2222-2222-2222-222222222222.pdf';
let documentReads=0,documentSigns=0,unsafeSigned=false;
const reports=[{id:17,listing_id:validId,vertical:'professionals',title:'<script>alert(1)</script>',listing_status:'published',reason:'suspected_fraud',details:'<img src=x onerror=alert(1)>',status:'open'}];
const pausedId='22222222-2222-4222-8222-222222222222';
const active=[{id:validId,vertical:'professionals',title:'<script>alert(1)</script>',status:'published',city_name:'São Gabriel',state_code:'RS',city_vertical_enabled:true},
 {id:pausedId,vertical:'stays',title:'Pousada do centro',status:'paused',city_name:'São Gabriel',state_code:'RS',city_vertical_enabled:false}];
const client={
 from(name){assert.equal(name,'discovery_documents');return{
  select(){return {eq(_column,_id){assert.equal(_id,validId);return {
   limit:async()=>{documentReads++;return {data:[{id:validId,kind:'supporting',object_path:docKey}],error:null};}
  };}};}
 };},
 storage:{from(bucket){assert.equal(bucket,'tamao-discovery-documents');return{
  createSignedUrl:async(key,seconds,options)=>{assert.equal(key,docKey);assert.equal(seconds,90);assert.equal(options?.download,true);documentSigns++;
   return {data:{signedUrl:unsafeSigned?'https://evil.test/steal':
     'https://project.supabase.co/storage/v1/object/sign/tamao-discovery-documents/'+key+'?token=temporary'},error:null};}
 };}},
 rpc:async(name,args)=>{
 requested.push([name,args]);
 if(name==='discovery_admin_review_queue')return {data:queue,error:null};
 if(name==='discovery_admin_report_queue')return {data:reports,error:null};
 if(name==='discovery_admin_listing_overview')return {data:active,error:null};
 if(name==='discovery_review_report'){reports.length=0;return {data:args.p_status,error:null};}
 if(name==='discovery_transition_listing')return {data:args.p_next_status,error:null};
 if(name==='discovery_set_vertical_city')return {data:null,error:null};
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
 document:{getElementById:id=>({value:({
  'admin-discovery-city-kind':'stays','admin-discovery-city-state':'RS',
  'admin-discovery-city-name':'São Gabriel',
  'admin-discovery-city-reason':'Ativação manual conferida'
 })[id]??reason})}
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
assert.match(html,/Conferir comprovantes privados/);
assert.match(html,/Denúncias de anúncios/);
assert.match(html,/Publicações e pausas/);
assert.match(html,/Pausar publicação/);
assert.match(html,/disabled>Reativar anúncio/);
assert.match(html,/Possível fraude/);
assert.match(html,/&lt;img src=x onerror=/);
assert.doesNotMatch(html,/<img src=x onerror=/);
await ctx.adminDiscoveryDocuments(validId);
assert.equal(documentReads,1);
assert.equal(documentSigns,1);
assert.match(ctx.adminDiscoveryView(),/link temporário/);
assert.match(ctx.adminDiscoveryView(),/tamao-discovery-documents/);
unsafeSigned=true;
await ctx.adminDiscoveryDocuments(validId);
assert.equal(documentReads,2);
assert.doesNotMatch(ctx.adminDiscoveryView(),/link temporário/);
assert.ok(notes.some(x=>x.includes('Não foi possível abrir')));
unsafeSigned=false;
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
assert.equal(ctx.adminDiscoveryCitySlug('São Gabriel'),'sao-gabriel');
await ctx.adminDiscoverySetCity(true);
const cityAction=requested.find(r=>r[0]==='discovery_set_vertical_city');
assert.equal(cityAction[1].p_vertical,'stays');
assert.equal(cityAction[1].p_city_key,'sao-gabriel');
assert.equal(cityAction[1].p_enabled,true);
role='operations';
await ctx.adminDiscoveryReviewReport(17,'resolved');
assert.equal(requested.filter(r=>r[0]==='discovery_review_report').length,0);
await ctx.adminDiscoveryDocuments(validId);
assert.equal(documentReads,2,'non-admin must not fetch private evidence');
await ctx.adminDiscoveryLoad();
assert.equal(requested.filter(r=>r[0]==='discovery_admin_review_queue').length,3);
assert.equal(requested.filter(r=>r[0]==='discovery_admin_report_queue').length,3);
assert.equal(requested.filter(r=>r[0]==='discovery_admin_listing_overview').length,3);
await ctx.adminDiscoveryDecision(validId,'rejected');
assert.equal(requested.filter(r=>r[0]==='discovery_transition_listing').length,1);
assert.equal(ctx.adminDiscoveryView(),'');
role='superadmin';
assert.match(ctx.adminDiscoveryView(),/Suspender anúncio/);
ctx.prompt=()=> 'Anúncio suspenso até verificação da denúncia';
await ctx.adminDiscoverySuspendReportedListing(validId);
const suspension=requested.filter(x=>x[0]==='discovery_transition_listing'&&x[1].p_next_status==='paused');
assert.equal(suspension.length,1,'a suspensão é ação do superadmin via RPC existente');
assert.equal(suspension[0][1].p_reason,'Anúncio suspenso até verificação da denúncia');
ctx.prompt=()=> 'Análise e providências registradas';
await ctx.adminDiscoveryReviewReport(17,'resolved');
const reviewed=requested.filter(r=>r[0]==='discovery_review_report');
assert.equal(reviewed.length,1);
assert.equal(reviewed[0][1].p_status,'resolved');
assert.equal(reviewed[0][1].p_report_id,17);
assert.doesNotMatch(ctx.adminDiscoveryView(),/<img src=x onerror=/);
ctx.prompt=()=> 'Revisão de publicação após checagem de contatos';
await ctx.adminDiscoveryChangeLive(pausedId,'published');
assert.equal(requested.filter(x=>x[0]==='discovery_transition_listing'&&
  x[1].p_listing_id===pausedId).length,0,'disabled city prevents reinstatement');
active[1].city_vertical_enabled=true;
await ctx.adminDiscoveryChangeLive(pausedId,'published');
const resume=requested.filter(x=>x[0]==='discovery_transition_listing'&&
  x[1].p_listing_id===pausedId);
assert.equal(resume.length,1,'resumption must use existing audited RPC');
assert.equal(resume[0][1].p_next_status,'published');
role='operations';
await ctx.adminDiscoveryChangeLive(validId,'paused');
assert.equal(requested.filter(x=>x[0]==='discovery_transition_listing'&&
  x[1].p_listing_id===validId&&x[1].p_reason==='Revisão de publicação após checagem de contatos').length,0);
role='superadmin';
assert.ok(src.includes("discovery:new Set(['superadmin'])"));
assert.ok(src.includes("adminMenuButton('discovery','Anúncios'"));
assert.ok(src.includes("adminPanel('discovery'"));
assert.ok(src.includes("if(next==='discovery')adminDiscoveryLoad()"));
assert.ok(src.includes("onclick=\"adminDiscoverySetCity(true)\""));
const sql=read('supabase/migrations/20261018131000_discovery_shared_verticals.sql');
assert.ok(sql.includes('create function public.discovery_admin_review_queue'));
assert.ok(sql.includes("a.admin_role='superadmin'"));
assert.match(sql,/create table public.discovery_listing_reports/);
assert.match(sql,/create function public.discovery_admin_report_queue/);
assert.match(sql,/create function public.discovery_review_report/);
assert.match(sql,/create function public.discovery_admin_listing_overview/);
assert.match(sql,/UNRESOLVED_REPORT_BLOCKS_REACTIVATION/);
console.log('PASS: admin-only queue, safe markup, city gate, reason gate, RPC action, existing panel integration.');
