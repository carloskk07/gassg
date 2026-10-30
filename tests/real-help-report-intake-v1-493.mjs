import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),legal=read('js/legal.js');
const admin=read('js/admin.js'),acquisition=read('js/admin-acquisition.js');
const backend=read('js/backend.js'),css=read('css/components.css');
const endpoint=read('supabase/functions/submit-public-request/index.ts');
for(const [name,source] of [['core',core],['legal',legal],['admin',admin],['admin-acquisition',acquisition]]){
  new vm.Script(source,{filename:name+'.js'});
}
function cut(src,name){
  const start=src.indexOf('function '+name+'('),end=src.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing '+name);
  return src.slice(start,end+2);
}
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const ctx=vm.createContext({
  URLSearchParams,location:{search:'?tamao_help=revenda&modulo=merchant-orders'},
  shell:x=>x,esc,legalHero:()=>'<section>',legalNav:()=>'',legalClose:()=>'</section>'
});
vm.runInContext(cut(legal,'contactPrivacyOptions')+'\n'+cut(legal,'contactPage')+
 ';this.page=contactPage;',ctx);
assert.match(ctx.page(),/option value="support" selected/,'merchant help opens support subject');
assert.match(ctx.page(),/public-request-ack/,'explicit consent persists');
assert.match(ctx.page(),/public-request-result/,'receipt and protocol visible');
assert.match(ctx.page(),/public-request-website/,'spam honeypot persists');
ctx.location.search='?tamao_help=cliente&modulo=tracking';
assert.match(ctx.page(),/option value="support" selected/);
ctx.location.search='?tamao_help=admin&modulo=orders';
assert.doesNotMatch(ctx.page(),/option value="support" selected/,'only allowed client and partner intent');

assert.match(core,/!adminPortal&&!testDemo&&r!=='contact'/,'not in admin or synthetic demo');
assert.match(core,/tamao-help-shortcut/);
assert.match(core,/https:\/\/tamao\.com\.br\/\?tamao_help=/);
assert.match(core,/encodeURIComponent\(r\)/,'module encoded and no secrets');
assert.match(css,/\.tamao-help-shortcut:focus-visible/,'accessible keyboard shortcut');
assert.match(css,/@media\(min-width:760px\)/,'desktop positioning');
assert.match(backend,/\/functions\/v1\/submit-public-request/);
assert.match(backend,/landingPath:String\(location.pathname\+location.search\+location.hash\)/,
 'existing attribution captures harmless role and page in the protected intake');
assert.match(endpoint,/\["general","support","privacy"\]/);
assert.match(endpoint,/consume_prelaunch_lead_quota/);
assert.match(endpoint,/request_idempotency_key/);
assert.match(endpoint,/acknowledged_at/);
assert.match(endpoint,/\.from\("public_requests"\)/);

const queueCtx=vm.createContext({adminPublicRequestCard:x=>'<article>'+esc(x.message)+'</article>',
 adminHelpPager:()=>({page:0,items:null,total:null,loading:false,error:null})});
vm.runInContext(cut(acquisition,'adminProblemReportsSection')+';this.queue=adminProblemReportsSection;',queueCtx);
const rows=[
 {request_kind:'support',status:'in_review',created_at:'2026-10-29T15:00:00Z',message:'Revenda: erro'},
 {request_kind:'support',status:'new',created_at:'2026-10-29T15:20:00Z',message:'Cliente: problema'},
 {request_kind:'privacy',status:'new',created_at:'2026-10-29T15:30:00Z',message:'Pedido privado'},
 {request_kind:'general',status:'new',created_at:'2026-10-29T15:40:00Z',message:'Publicidade'}
];
const html=queueCtx.queue({publicRequests:rows});
assert.match(html,/2 pendente\(s\)/);
assert.ok(html.indexOf('Cliente: problema')<html.indexOf('Revenda: erro'));
assert.doesNotMatch(html,/Pedido privado|Publicidade/);
assert.match(html,/adminRefresh\(\)/);
assert.match(admin,/adminProblemReportsSection\(d\)/);
assert.match(admin,/activeOrderAttention\+openSupportCases\.length\+pendingHelpReports/);


// Security regression: a support report must retain role/module but never
// copy magic-link tokens, invite parameters or a full referrer to the Admin.
const attrCtx=vm.createContext({URL,URLSearchParams});
const helperNames=['safePublicRequestLandingPath','safePublicRequestReferrer'];
const helpers=helperNames.map(name=>cut(endpoint,name).replaceAll(':unknown','').replaceAll(':string',''));
vm.runInContext(helpers.join('\n')+
  ';this.safePath=safePublicRequestLandingPath;this.safeRef=safePublicRequestReferrer;',attrCtx);
const sensitive='/?tamao_help=revenda&modulo=merchant-orders&access_token=SENSITIVE&pilot=INVITE#secret';
const cleaned=attrCtx.safePath(sensitive,'support');
assert.equal(cleaned,'/?tamao_help=revenda&modulo=merchant-orders#contact');
assert.doesNotMatch(cleaned,/SENSITIVE|INVITE|access_token|pilot/);
assert.equal(attrCtx.safePath('/?tamao_help=cliente&modulo=tracking&token=PRIVATE','support'),
  '/?tamao_help=cliente&modulo=tracking#contact');
assert.equal(attrCtx.safePath('/?tamao_help=revenda&modulo=merchant-orders','privacy'),'#/contact'.replace('#/contact','/#contact'));
assert.equal(attrCtx.safePath('/?tamao_help=admin&modulo=orders','support'),'/'+'#contact');
assert.equal(attrCtx.safePath('https://other.example/?tamao_help=revenda','support'),'/'+'#contact');
assert.equal(attrCtx.safePath('/?tamao_help=cliente&modulo=%3Cscript%3E','support'),
  '/?tamao_help=cliente#contact');
assert.equal(attrCtx.safeRef('https://tamao.com.br/recover?token=SENSITIVE#hash'),'https://tamao.com.br');
assert.equal(attrCtx.safeRef('javascript:alert(1)'),null);
assert.ok(endpoint.includes('referrer:safePublicRequestReferrer(attribution.referrer)'));
assert.ok(endpoint.includes('landing_path:safePublicRequestLandingPath(attribution.landingPath,requestKind)'));
console.log('PASS: submitted report attribution is sanitized server-side, including untrusted clients.');



// Commercial support queue: role-specific data minimization and a separate
// high-priority query prevent more recent marketing enquiries from burying help.
const adminEdge=read('supabase/functions/admin-ops/index.ts');
assert.match(adminEdge,/support:new Set\(\[[^\]]*"public-request-status"/,
  'support operators can update public help cases');
const summaryScopeStart=adminEdge.indexOf('function scopeAdminSummary(');
const scopedRole=adminEdge.slice(adminEdge.indexOf('if(role==="support"){',summaryScopeStart),
  adminEdge.indexOf('if(role==="compliance"){',summaryScopeStart));
assert.match(scopedRole,/publicRequests:\(data\.publicRequests\?\?\[\]\)\.filter/,
  'support summary must exclude privacy and general requests before returning JSON');
assert.match(scopedRole,/request_kind==="support"/);

const scopedExec=vm.createContext({});
vm.runInContext('function scopeForSupport(data){const role="support",adminSelf=[];\n'+
  scopedRole.replaceAll('(m:any)','(m)').replaceAll('(x:any)','(x)')+
  '\n}this.scope=scopeForSupport;',scopedExec);
const redacted=scopedExec.scope({merchants:[],publicRequests:[
  {id:'case-a',request_kind:'support',message:'Pedido não acompanha'},
  {id:'case-private',request_kind:'privacy',message:'Documento e dados privados'},
  {id:'case-general',request_kind:'general',message:'Consulta comercial'}
]});
assert.equal(redacted.publicRequests.length,1);
assert.equal(redacted.publicRequests[0].id,'case-a');
assert.doesNotMatch(JSON.stringify(redacted),/case-private|Documento e dados privados|case-general/);

assert.match(adminEdge,/if\(action==="public-request-status"&&adminAccess\.admin_role==="support"\)/);
assert.match(adminEdge,/check\.data\?\.request_kind!=="support"/,
  'an operator cannot resolve a privacy request by forging a POST');
const priorityStart=adminEdge.indexOf('const pendingSupportPromise=admin.from("public_requests")');
const priorityEnd=adminEdge.indexOf(';',priorityStart);
const priorityQuery=adminEdge.slice(priorityStart,priorityEnd+1);
assert.match(priorityQuery,/\.eq\("request_kind","support"\)/);
assert.match(priorityQuery,/\.in\("status",\["new","in_review"\]\)/);
assert.match(priorityQuery,/\{count:"exact"\}/);
assert.match(priorityQuery,/\.limit\(30\)/);
assert.match(adminEdge,/pendingHelpReportTotal:pendingSupport\.count/,
  'total count must be independent of sample size');
const mergeSource=cut(adminEdge,'mergePriorityHelpRequests')
 .replace('recent:any[],pending:any[]','recent,pending')
 .replace('new Set<string>()','new Set()')
 .replace('(x:any)=>','(x)=>');
const mergeCtx=vm.createContext({});
vm.runInContext(mergeSource+';this.merge=mergePriorityHelpRequests;',mergeCtx);
const unresolved={id:'support-0',request_kind:'support',status:'new'};
const recent=[...Array.from({length:200},(_,i)=>({id:'general-'+i,request_kind:'general'})),
  unresolved];
const priority=[unresolved,{id:'support-1',request_kind:'support',status:'in_review'}];
const combined=Array.from(mergeCtx.merge(recent,priority));
assert.equal(combined[0].id,'support-0');
assert.equal(combined[1].id,'support-1');
assert.equal(combined.filter(x=>x.id==='support-0').length,1,'dedup rows between queues');
assert.equal(combined.length,202);
const supportCtx=vm.createContext({adminCurrentRole:()=> 'support'});
vm.runInContext(cut(acquisition,'adminPublicRequestActionButtons')+
 ';this.actions=adminPublicRequestActionButtons;',supportCtx);
assert.equal(supportCtx.actions({request_kind:'privacy',status:'new',id:'example'}),'');
assert.match(supportCtx.actions({request_kind:'support',status:'new',id:'example'}),/Em análise/);
const prioritizedCtx=vm.createContext({adminPublicRequestCard:x=>'<div>'+esc(x.id)+'</div>',
  adminHelpPager:()=>({page:0,items:null,total:null,loading:false,error:null})});
vm.runInContext(cut(acquisition,'adminProblemReportsSection')+
 ';this.view=adminProblemReportsSection;',prioritizedCtx);
const prioritized=prioritizedCtx.view({publicRequests:[
 {id:'support-0',request_kind:'support',status:'new',created_at:'2026-10-28T01:00:00Z'},
 {id:'support-1',request_kind:'support',status:'in_review',created_at:'2026-10-29T01:00:00Z'}
],pendingHelpReportTotal:75});
assert.match(prioritized,/75 pendente\(s\)/);
assert.match(prioritized,/Há 73 pendente\(s\) além desta amostra/);
assert.match(prioritized,/Página 1 de 3/);
assert.match(prioritized,/adminHelpReportsPage\(1\)/);
assert.match(admin,/pendingHelpReportTotal/,'navigation displays true server backlog');


// Pagination must be server-backed, role restricted, session scoped and
// never leak previously loaded customer contacts after admin logout.
const pagerRuntime={session:{user:{id:'admin-a'}},helpReportPager:null};
let pageCall=null,renderCount=0,summaryRefreshes=0;
const pagingCtx=vm.createContext({
  adminRuntime:pagerRuntime,
  adminReady:()=>true,
  adminRoleCanSection:section=>section==='orders',
  adminInvoke:async body=>{
    pageCall=body;
    return {source:'admin_support_reports_page_v1',readOnly:true,
      page:body.page,pageSize:30,total:78,
      items:[{id:'report-31',request_kind:'support',status:'new',
        contact_value:'private@example.com',created_at:'2026-10-29T01:00:00Z'}]};
  },
  adminRefresh:async()=>{summaryRefreshes++;},
  render:()=>{renderCount++;},
  globalThis:{retryAmbiguousOnce:op=>op()}
});
vm.runInContext(cut(acquisition,'adminHelpPager')+'\nasync '+
 cut(acquisition,'adminHelpReportsPage')+
 ';this.pager=adminHelpPager;this.load=adminHelpReportsPage;',pagingCtx);
await pagingCtx.load(1);
assert.equal(pageCall.action,'support-reports-page');
assert.equal(pageCall.page,1);
assert.equal(pagerRuntime.helpReportPager.page,1);
assert.equal(pagerRuntime.helpReportPager.total,78);
assert.equal(pagerRuntime.helpReportPager.items[0].id,'report-31');
assert.ok(renderCount>0);
const secondPageCtx=vm.createContext({
  adminHelpPager:()=>pagerRuntime.helpReportPager,
  adminPublicRequestCard:x=>'<div>'+esc(x.id)+'</div>',
  esc
});
vm.runInContext(cut(acquisition,'adminProblemReportsSection')+
  ';this.view=adminProblemReportsSection;',secondPageCtx);
const secondPage=secondPageCtx.view({publicRequests:[
  {id:'report-1',request_kind:'support',status:'new'}],pendingHelpReportTotal:78});
assert.match(secondPage,/Página 2 de 3/);
assert.match(secondPage,/report-31/);
assert.doesNotMatch(secondPage,/report-1</);
assert.match(secondPage,/adminHelpReportsPage\(2\)/);
assert.match(secondPage,/adminHelpReportsPage\(0\)/);
await pagingCtx.load(0);
assert.equal(summaryRefreshes,1);
assert.equal(pagerRuntime.helpReportPager.page,0);
assert.equal(pagerRuntime.helpReportPager.items,null);
await pagingCtx.load(-1);
assert.equal(summaryRefreshes,1,'invalid page must not trigger network');
pagerRuntime.session={user:{id:'admin-b'}};
assert.equal(pagingCtx.pager().page,0);
assert.equal(pagingCtx.pager().items,null,
  'new account must not receive previous account PII');
const adminEdgeRead=adminEdge.slice(adminEdge.indexOf('if(action==="support-reports-page"){'),
  adminEdge.indexOf('if(action==="clube-coupon-mp-payout-inspect"){'));
assert.match(adminEdgeRead,/superadmin","operations","support/);
assert.match(adminEdgeRead,/ADMIN_PERMISSION_DENIED/);
assert.match(adminEdgeRead,/\.eq\("request_kind","support"\)/);
assert.match(adminEdgeRead,/\.in\("status",\["new","in_review"\]\)/);
assert.match(adminEdgeRead,/\.range\(page\*30,page\*30\+29\)/);
assert.match(adminEdgeRead,/readOnly:true/);
assert.match(admin,/adminRuntime.helpReportPager=null/);
console.log('PASS: all pending support pages accessible with authorization and account isolation.');

console.log('PASS: support-only role scope, permission gate and independent prioritized report backlog.');

console.log('PASS: protected complaint intake available on every real client and merchant page, filtered admin triage and original legal safeguards.');


// A browser may lose the response after Supabase has saved a support case.
// A second click must replay the original request key, not create another row.
assert.match(backend,/let pendingPublicRequest=null;/);
const attempts=[];
let transport='outage',seq=0;
const intakeCtx=vm.createContext({
  CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'public-test-key'},
  prelaunchAttribution:()=>({source:'tamao',landingPath:'/?tamao_help=cliente#contact'}),
  liveIdempotency:prefix=>prefix+':test-'+(++seq),
  retryAmbiguousOnce:async operation=>{
    try{return await operation()}
    catch(error){
      if(error.status===503)return operation();
      throw error;
    }
  },
  chamaFetch:async(url,init)=>{
    attempts.push({url,key:init.headers['Idempotency-Key'],body:JSON.parse(init.body)});
    if(transport==='outage')return {ok:false,status:503,json:async()=>({error:'TEMPORARY'})};
    return {ok:true,status:200,json:async()=>({ok:true,protocol:'TEST1234',replayed:true})};
  }
});
vm.runInContext('let pendingPublicRequest=null;\nasync '+cut(backend,'publicRequestSubmit')+
  ';this.send=publicRequestSubmit;',intakeCtx);
const draft={requestKind:'support',contactName:'Pessoa de teste',
  contactChannel:'email',contactValue:'qa@example.com',
  message:'Falha temporária no acompanhamento do pedido',
  website:'',acknowledged:true};
await assert.rejects(()=>intakeCtx.send(draft),/TEMPORARY/);
assert.equal(attempts.length,2,'internal retry must be attempted');
assert.equal(attempts[0].key,attempts[1].key,'internal retry must keep same key');
transport='ok';
assert.equal((await intakeCtx.send(draft)).protocol,'TEST1234');
assert.equal(attempts[2].key,attempts[0].key,
  'second user click after ambiguous failure must replay original key');
await intakeCtx.send(draft);
assert.notEqual(attempts[3].key,attempts[2].key,
  'confirmed success should free key for a separate later report');
transport='outage';
await assert.rejects(()=>intakeCtx.send({...draft,message:'Erro A'}),/TEMPORARY/);
const failedKey=attempts.at(-1).key;
transport='ok';
await intakeCtx.send({...draft,message:'Erro B'});
assert.notEqual(attempts.at(-1).key,failedKey,
  'changed report content must not be sent under an earlier idempotency key');
assert.equal(attempts[0].body.requestKind,'support');
console.log('PASS: ambiguous timeout/server error replays the same support request key across clicks.');
