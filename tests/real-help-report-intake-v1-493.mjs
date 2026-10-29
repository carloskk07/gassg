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

const queueCtx=vm.createContext({adminPublicRequestCard:x=>'<article>'+esc(x.message)+'</article>'});
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
console.log('PASS: protected complaint intake available on every real client and merchant page, filtered admin triage and original legal safeguards.');
