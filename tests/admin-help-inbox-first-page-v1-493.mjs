import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual Admin pager functions, not a reimplementation.
// A first page based on the mixed-kind latest-200 summary can miss old
// pending help reports when 200 newer general/privacy requests exist.
const source=fs.readFileSync(new URL('../js/admin-acquisition.js',import.meta.url),'utf8');
const first=source.indexOf('function adminHelpPager(){');
const last=source.indexOf('function adminPublicRequestsSection(data){',first);
assert.ok(first>0&&last>first);
const code=source.slice(first,last);
const supportId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const report=n=>({
  id:supportId(n),request_kind:'support',status:'new',
  contact_name:'Pessoa fictícia',created_at:'2026-11-01T11:00:00Z'
});
const currentPage=Array.from({length:30},(_,i)=>report(i+1));
const older=report(31);
const adminRuntime={
  status:'ready',section:'orders',session:{user:{id:supportId(999)}},
  // The latest 200 requests are unrelated; the old support request is absent
  // from this summary, even though server-side pending count is nonzero.
  data:{publicRequests:Array.from({length:200},(_,i)=>({
    id:supportId(i+100),request_kind:'general',status:'new'
  })),pendingHelpReportTotal:31}
};
const invocations=[];
const server=async ({action,page})=>{
  assert.equal(action,'support-reports-page');
  invocations.push(page);
  return {source:'admin_support_reports_page_v1',readOnly:true,page,
    pageSize:30,total:31,items:page===0?currentPage:page===1?[older]:[]};
};
let renders=0;
const ctx=vm.createContext({
  adminRuntime,
  adminReady:()=>true,
  adminRoleCanSection:()=>true,
  adminInvoke:server,
  retryAmbiguousOnce:fn=>fn(),
  adminPublicRequestCard:x=>'<article>'+x.id+'</article>',
  esc:x=>String(x),
  render:()=>{renders++},
  Number,Array,String,Math,Date,Set
});
vm.runInContext(code+';this.api={adminHelpPager,adminHelpReportsPage,adminProblemReportsSection};',ctx);
const adminShell=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
assert.match(adminShell,/if\\(next==='orders'&&\\['superadmin','operations','support'\\]\\.includes\\(adminCurrentRole\\(\\)\\)\\)/);
assert.match(adminShell,/if\\(adminRuntime\\.section==='orders'&&\\['superadmin','operations','support'\\]\\.includes\\(adminCurrentRole\\(\\)\\)\\)/);
assert.ok(renders===0);
await ctx.api.adminHelpReportsPage(0);
assert.deepEqual(invocations,[0],'first page must query authoritative server');
assert.equal(ctx.api.adminHelpPager().page,0);
assert.equal(ctx.api.adminHelpPager().items.length,30);
assert.equal(ctx.api.adminHelpPager().total,31);
let html=ctx.api.adminProblemReportsSection(adminRuntime.data);
assert.ok(html.includes('31 pendente(s)'));
assert.ok(html.includes(supportId(1)),'first pending support case must be visible');
assert.ok(!html.includes('Nenhum relato de ajuda'),'do not render empty summary over real reports');
assert.ok(html.includes('adminHelpReportsPage(1)'));
await ctx.api.adminHelpReportsPage(1);
assert.deepEqual(invocations,[0,1]);
html=ctx.api.adminProblemReportsSection(adminRuntime.data);
assert.ok(html.includes(older.id),'older pending help report must be reachable');
assert.match(html,/Página 2 de 2/);
await ctx.api.adminHelpReportsPage(0);
assert.deepEqual(invocations,[0,1,0]);
assert.ok(ctx.api.adminProblemReportsSection(adminRuntime.data).includes(supportId(1)),
  'previous page must also use server data');
assert.equal(adminRuntime.data.publicRequests.length,200,'do not mutate summary data');
console.log('PASS #493: first/next/previous help inbox pages use protected pending queue; older reports stay visible.');
