import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),legal=read('js/legal.js');
const admin=read('js/admin.js'),adminAcquisition=read('js/admin-acquisition.js');
const css=read('css/components.css'),backend=read('js/backend.js');
const endpoint=read('supabase/functions/submit-public-request/index.ts');
for(const [path,src] of [['core',core],['legal',legal],['admin',admin],['admin-acquisition',adminAcquisition]]){
  new vm.Script(src,{filename:path+'.js'});
}
function cut(src,name){
  const begin=src.indexOf('function '+name+'(');
  assert.ok(begin>=0,'Missing function: '+name);
  const end=src.indexOf('\n}',begin);
  assert.ok(end>begin,'Unterminated: '+name);
  return src.slice(begin,end+2);
}
const helpRule=vm.createContext({URLSearchParams,location:{search:'?tamao_help=revenda&modulo=merchant-orders'}});
vm.runInContext(cut(legal,'contactProblemContext')+';this.help=contactProblemContext;',helpRule);
assert.equal(helpRule.help().role,'revenda');
assert.equal(helpRule.help().module,'merchant-orders');
helpRule.location.search='?tamao_help=cliente&modulo=tracking';
assert.equal(helpRule.help().role,'cliente');
assert.equal(helpRule.help().module,'tracking');
helpRule.location.search='?tamao_help=revenda&modulo=../../admin?token=secret';
assert.equal(helpRule.help().module,'outro','URL input must never become a privileged module label');
helpRule.location.search='?tamao_help=admin&modulo=orders';
assert.equal(helpRule.help(),null,'admin context cannot impersonate customer report');
helpRule.location.search='';
assert.equal(helpRule.help(),null);

const escapeText=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const legalCtx=vm.createContext({URLSearchParams,
  location:{search:'?tamao_help=revenda&modulo=merchant-orders'},
  esc:escapeText,shell:x=>x,legalHero:()=>'<section>',legalNav:()=>'',legalClose:()=>'</section>'});
vm.runInContext([cut(legal,'contactProblemContext'),cut(legal,'contactPrivacyOptions'),cut(legal,'contactPage')]
  .join('\n')+';this.page=contactPage;',legalCtx);
const html=legalCtx.page();
assert.match(html,/Reportar problema/);
assert.match(html,/Revenda \/ merchant-orders/);
assert.match(html,/option value="support" selected/);
assert.match(html,/public-request-ack/);
assert.match(html,/public-request-website/);
assert.match(html,/public-request-result/);
assert.doesNotMatch(html,/chama-merchant-selected|access_token/);

assert.match(core,/!adminPortal&&!testDemo&&r!=='contact'/,'no exposed live report in demo or admin');
assert.match(core,/tamao-help-shortcut/,'global accessible action across routes');
assert.match(core,/https:\/\/tamao\.com\.br\/\?tamao_help=/,'official support origin');
assert.match(core,/encodeURIComponent\(r\)/,'route must be URL encoded');
assert.match(css,/\.tamao-help-shortcut:focus-visible/,'keyboard accessibility');
assert.match(css,/@media\(min-width:760px\)/,'desktop placement');
assert.match(legal,/typedMessage\.length<10/,'context prefix must not pass empty report validation');
assert.match(legal,/\[Problema TAMÃO \| /,'source and module in ticket body');
assert.match(backend,/\/functions\/v1\/submit-public-request/,'existing database-backed intake');
assert.match(endpoint,/\["general","support","privacy"\]/,'server accepts support');
assert.match(endpoint,/consume_prelaunch_lead_quota/,'server-side abuse protection');
assert.match(endpoint,/request_idempotency_key/,'duplicate request protection');
assert.match(endpoint,/acknowledged_at/,'explicit contact consent');
assert.match(endpoint,/public_requests/,'private persisted source');

const adminContext=vm.createContext({adminPublicRequestCard:x=>'<article>'+escapeText(x.message)+'</article>'});
vm.runInContext(cut(adminAcquisition,'adminProblemReportsSection')+';this.view=adminProblemReportsSection;',adminContext);
const rows=[
 {request_kind:'support',status:'in_review',created_at:'2026-10-29T15:00:00Z',message:'Revenda: erro de checkout'},
 {request_kind:'privacy',status:'new',created_at:'2026-10-29T15:10:00Z',message:'Pedido LGPD'},
 {request_kind:'support',status:'new',created_at:'2026-10-29T15:20:00Z',message:'Cliente: problema de pagamento'},
 {request_kind:'general',status:'new',created_at:'2026-10-29T15:30:00Z',message:'Publicidade'}
];
const board=adminContext.view({publicRequests:rows});
assert.match(board,/2 pendente\(s\)/);
assert.match(board,/Cliente: problema de pagamento/);
assert.match(board,/Revenda: erro de checkout/);
assert.ok(board.indexOf('Cliente: problema')<board.indexOf('Revenda: erro'),'newest pending first');
assert.doesNotMatch(board,/Pedido LGPD|Publicidade/,'no unrelated private inquiries in operational error desk');
assert.match(board,/adminRefresh\(\)/,'manual refresh available');
assert.match(admin,/adminProblemReportsSection\(d\)/);
assert.match(admin,/activeOrderAttention\+openSupportCases\.length\+pendingHelpReports/);
console.log('PASS: cliente/revenda reporting, server-protected protocol, Admin triage, safe context, no demo write or private GitHub sync.');
