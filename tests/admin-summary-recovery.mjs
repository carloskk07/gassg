import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const take=name=>{const start=source.search(new RegExp('(?:async )?function '+name+'\\('));
 assert(start>=0);const end=source.indexOf('\n}',start);assert(end>start);return source.slice(start,end+2)};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function fixture(read){
 let clock=100000,safe=true,purges=0,reads=0;
 const runtime={requested:true,status:'ready',refreshSeq:0,refreshPending:0,section:'finance',
  client:{},session:{access_token:'isolated-session',user:{id:'owner'}},
  data:{currentAdmin:{admin_role:'superadmin'},privateSnapshot:'previous'}};
 const doc={visibilityState:'visible',activeElement:null,getElementById:()=>null};
 const ctx=vm.createContext({adminRuntime:runtime,document:doc,
  adminOriginSafe:()=>safe,adminReady:()=>runtime.status==='ready'&&safe,
  adminRoleCanSection:section=>runtime.data?.currentAdmin?.admin_role==='superadmin'||section==='overview',
  adminFirstSectionForRole:()=> 'overview',adminCurrentRole:()=>runtime.data?.currentAdmin?.admin_role,
  adminInvoke:async body=>{assert.deepEqual(JSON.parse(JSON.stringify(body)),{action:'summary'});reads++;return read(reads)},
  retryAmbiguousOnce:fn=>fn(),adminPurgeSensitiveReads:()=>purges++,
  adminLoadFinanceHistory:async()=>{},adminLoadMerchantFinance:async()=>{},
  render:()=>{},queueMicrotask:()=>{},sessionStorage:{setItem(){}},
  Date:class extends Date{static now(){return clock}},Set,Boolean,String,Error});
 vm.runInContext(['adminRefresh','adminFocusedDraftActive','adminPoll'].map(take).join('\n')+
  ';this.api={refresh:adminRefresh,poll:adminPoll};',ctx);
 return {runtime,doc,api:ctx.api,reads:()=>reads,purges:()=>purges,
  clock:x=>clock=x,unsafe:()=>safe=false};
}
const snapshot=role=>({currentAdmin:{admin_role:role},snapshot:'fresh'});
{
 const pending=deferred(),f=fixture(()=>pending.promise);
 const first=f.api.refresh();assert(f.runtime.refreshPending>0);
 assert.equal(await f.api.refresh(),null,'repeated manual refresh must not overlap the pending summary');
 await f.api.poll();assert.equal(f.reads(),1,'background timer must not overlap a manual read');
 pending.resolve(snapshot('superadmin'));await first;
 assert.equal(f.runtime.refreshPending,0);assert.equal(f.runtime.status,'ready');
}
{
 const old=deferred(),fresh=deferred(),f=fixture(n=>n===1?old.promise:fresh.promise);
 const beforeWrite=f.api.refresh();
 const afterWrite=f.api.refresh({silent:true});
 assert.equal(f.reads(),2,'post-action authoritative read must never join an older pre-action snapshot');
 fresh.resolve({...snapshot('superadmin'),snapshot:'after'});await afterWrite;
 old.resolve({...snapshot('superadmin'),snapshot:'before'});await beforeWrite;
 assert.equal(f.runtime.data.snapshot,'after');assert.equal(f.runtime.refreshPending,0);
}
{
 const f=fixture(n=>{if(n===1)throw Object.assign(Error('Temporary timeout'),{code:'NETWORK_TIMEOUT',status:503});return snapshot('readonly')});
 await assert.rejects(f.api.refresh(),/Temporary timeout/);
 assert.equal(f.runtime.status,'unavailable');assert.equal(f.runtime.refreshPending,0);
 f.clock(159999);await f.api.poll();assert.equal(f.reads(),1,'recovery waits the full minute');
 f.clock(160000);f.doc.visibilityState='hidden';await f.api.poll();assert.equal(f.reads(),1);
 f.doc.visibilityState='visible';await f.api.poll();
 assert.equal(f.reads(),2);assert.equal(f.runtime.status,'ready');
 assert.equal(f.runtime.data.currentAdmin.admin_role,'readonly');
 assert.equal(f.runtime.section,'overview','recovery applies current permissions, not the old finance workspace');
 assert.equal(f.purges(),1);
}
for(const failure of [
 {code:'HTTP_401',status:401,expected:'unauthenticated'},
 {code:'ADMIN_ACCESS_DENIED',status:403,expected:'no-access'}
]){
 const f=fixture(()=>{throw Object.assign(Error('denied'),failure)});
 await f.api.refresh();assert.equal(f.runtime.status,failure.expected);
 f.clock(900000);await f.api.poll();assert.equal(f.reads(),1,'access denials are never auto-retried');
 assert.equal(f.runtime.data,null);
}
for(const change of [f=>f.unsafe(),f=>f.runtime.session.user.is_anonymous=true,
 f=>f.runtime.session=null,f=>f.runtime.requested=false,f=>f.runtime.actionPending=true]){
 const f=fixture(()=>snapshot('superadmin'));f.runtime.status='unavailable';change(f);
 f.clock(900000);await f.api.poll();assert.equal(f.reads(),0,'unverified identity/origin/action must prevent recovery');
}
const bootstrap=fs.readFileSync(new URL('../js/bootstrap.js',import.meta.url),'utf8');
assert.match(bootstrap,/if\(globalThis\.adminPortalRequested\?\.\(\)\)adminPoll\(\)\.catch/,
 'timer must reach the recovery guard even while Admin is temporarily unavailable');
console.log('PASS: one pending manual summary, no poll overlap, fresh post-action read, bounded recovery, current role and denial/origin/session guards.');
