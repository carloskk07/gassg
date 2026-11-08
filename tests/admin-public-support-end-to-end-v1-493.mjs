import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const raw=read('js/admin-acquisition.js');
const audit=read('.github/workflows/audit.yml');
const pick=name=>{
 const re=new RegExp('(?:async )?function '+name+'\\('),match=raw.match(re);
 assert.ok(match,'Missing '+name);
 const end=raw.indexOf('\n}',match.index);
 assert.ok(end>match.index,'Incomplete '+name);
 return raw.slice(match.index,end+2);
};
const funcs=['adminPublicRequestStatusLabel','adminPublicRequestActionButtons',
 'adminSetPublicRequestStatus','adminHelpPager','adminHelpReportsPage',
 'adminProblemReportsSection'].map(pick).join('\n');
new vm.Script(funcs,{filename:'Admin support end-to-end'});
const ticketId='11111111-1111-4111-8111-111111111111';
const row={id:ticketId,request_kind:'support',status:'new',
 contact_value:'private@example.invalid',contact_name:'Synthetic user',
 created_at:'2026-11-02T09:00:00.000Z'};
const summary={publicRequests:[{...row}],pendingHelpReportTotal:1};
const session={user:{id:'operator-A'}};
const rt={status:'ready',session,data:summary,helpReportPager:null};
let networkFault=false,rendered=0;
let parked=null;
const notifications=[],actions=[],queries=[];
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:result=>resolve(result)}};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;');
const marked=new Map();
const document={getElementById:id=>marked.get(id)||null};
const ctx=vm.createContext({
 adminRuntime:rt,adminReady:()=>rt.status==='ready',
 adminRoleCanSection:()=>true,adminCurrentRole:()=> 'support',
 document,esc,render:()=>rendered++,toast:s=>notifications.push(String(s)),
 confirm:()=>true,
 adminPublicRequestCard:x=>'<article data-status="'+esc(x.status)+'">'+esc(x.contact_name)+'</article>',
 retryAmbiguousOnce:fn=>fn(),
 adminInvoke:async input=>{
  assert.equal(input.action,'support-reports-page');
  assert.equal(input.page,0);
  queries.push(input);
  if(networkFault)throw Error('Network unavailable');
  if(parked){
   const pending=parked;parked=null;
   return pending.promise;
  }
  return snapshot();
 },
 adminPerform:async(action,payload)=>{
  assert.equal(action,'public-request-status');
  assert.equal(payload.requestId,ticketId);
  actions.push(payload);
  row.status=payload.status;
  return {ok:true};
 }
});
function snapshot(){
 const items=['new','in_review'].includes(row.status)?[{...row}]:[];
 return {source:'admin_support_reports_page_v1',readOnly:true,page:0,pageSize:30,
  total:items.length,items};
}
vm.runInContext(funcs+'\nthis.api={page:adminHelpReportsPage,view:adminProblemReportsSection,act:adminSetPublicRequestStatus,pager:adminHelpPager};',ctx);
const api=ctx.api;
let view=api.view(summary);
assert.match(view,/1 pendente\(s\)/,'Initial mixed summary shows the submitted report');
await api.page(0);
view=api.view(summary);
assert.match(view,/1 pendente\(s\)/);
assert.match(view,/data-status="new"/);
// Full front-end lifecycle: submit -> Admin queue -> review -> resolve.
// The old summary is deliberately NOT updated by the mock, as in a stale tab.
await api.act(ticketId,'in_review');
assert.equal(row.status,'in_review');
assert.match(api.view(summary),/data-status="in_review"/);
await api.act(ticketId,'resolved');
assert.equal(row.status,'in_review','No marked resolution means no mutation');
marked.set('admin-public-reason-resolved-'+ticketId,{value:'answered'});
await api.act(ticketId,'resolved');
assert.equal(row.status,'in_review','Real-action confirmation is mandatory');
marked.set('admin-public-confirm-'+ticketId,{checked:true});
await api.act(ticketId,'resolved');
assert.equal(row.status,'resolved');
view=api.view(summary);
assert.match(view,/0 pendente\(s\)/);
assert.doesNotMatch(view,/data-status="new"|data-status="in_review"/,
 'Resolved report must leave the authoritative pending queue immediately');
assert.equal(actions.length,2);
assert.ok(queries.length>=3);
assert.ok(rendered>0);

// A previous page query may resolve AFTER an Admin action. It must not
// overwrite the refreshed queue or re-display private old ticket records.
row.status='new';
rt.helpReportPager=null;
parked=gate();
const oldRequest=parked;
const earlier=api.page(0);
assert.equal(api.pager().loading,true);
await api.act(ticketId,'resolved');
assert.match(api.view(summary),/0 pendente\(s\)/);
oldRequest.resolve({source:'admin_support_reports_page_v1',readOnly:true,
 page:0,pageSize:30,total:1,items:[{...row,status:'new'}]});
await earlier;
assert.match(api.view(summary),/0 pendente\(s\)/);
assert.doesNotMatch(api.view(summary),/data-status="new"/);

// The server may accept a status update but the subsequent read may fail.
// Never show the previous mixed-kind sample as if it were current; explicitly
// state that the pending count is NOT confirmed.
row.status='new';
rt.helpReportPager=null;
networkFault=true;
await api.act(ticketId,'resolved');
view=api.view(summary);
assert.match(view,/Pendências não confirmadas/);
assert.doesNotMatch(view,/data-status="new"/);
assert.match(view,/Network unavailable/);
assert.ok(notifications.some(s=>s.includes('Não foi possível atualizar a fila')));
networkFault=false;
await api.page(0);
assert.match(api.view(summary),/0 pendente\(s\)/);

// Switching administrators while a status mutation is in flight cannot show
// a success toast or fill the new operator's private support queue.
rt.session=session;
row.status='new';
const other={user:{id:'operator-B'}};
ctx.adminPerform=async()=>{
 rt.session=other;rt.helpReportPager=null;
 return {ok:true};
};
const beforeNotices=notifications.length;
await api.act(ticketId,'resolved');
assert.equal(notifications.length,beforeNotices,'old operator cannot claim success on new session');
assert.equal(api.pager().actor,'operator-B');
assert.ok(audit.includes('node tests/admin-public-support-end-to-end-v1-493.mjs'));
console.log('PASS public support Admin flow: reviewed, resolved, stale page denied, readback error surfaced, account switch isolated.');
