import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
const take=name=>{
  const match=source.match(new RegExp('async function '+name+'\\('));
  assert.ok(match,'missing '+name);
  const end=source.indexOf('\n}',match.index);
  assert.ok(end>match.index,'unterminated '+name);
  return source.slice(match.index,end+2);
};
const isolated=['adminAccessToken','adminSignOut','adminRefresh'].map(take).join('\n');
new vm.Script(isolated,{filename:'admin-account-isolation'});

function deferred(){
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b});
  return {promise,resolve,reject};
}
function fixture({read,deferredSignOut=false,getSession}={}){
  const events=[];
  const logout=deferred(),signOut=()=>deferredSignOut?logout.promise:Promise.resolve();
  const session={access_token:'old-secret',user:{id:'old-user'}};
  const rt={
    client:{auth:{getSession:getSession||(()=>Promise.resolve({data:{session},error:null})),signOut}},
    session,status:'ready',refreshSeq:0,data:{supportCases:[{message:'PRIVATE OLD CUSTOMER'}]},
    section:'orders',helpReportPager:{items:['PRIVATE']},
    financeHistory:{data:{private:true}},merchantFinance:{data:{private:true}},
    providerHealth:{secret:true},searchResults:[{private:true}],
    financeLab:{live:{private:true}},auditResults:[{private:true}],
    bootstrapStatus:'claimed',notice:'old'
  };
  const ctx=vm.createContext({
    adminRuntime:rt,render:()=>events.push(['render',rt.status]),
    adminOrderDemoForget:()=>{},
    adminFinanceLabLiveScheduleExpiry:()=>{},
    sessionStorage:{removeItem:()=>{},setItem:()=>{}},
    globalThis:{retryAmbiguousOnce:fn=>fn()},
    adminInvoke:()=>read?read.promise:Promise.resolve({supportCases:[]}),
    queueMicrotask:()=>{},
    adminRoleCanSection:()=>true,
    adminCurrentRole:()=> 'superadmin',
    adminFirstSectionForRole:()=> 'overview'
  });
  vm.runInContext(isolated+
    '\nthis.actions={refresh:adminRefresh,signOut:adminSignOut,token:adminAccessToken}',ctx);
  return {rt,ctx,events,logout};
}

// A stale successful summary must not restore a private Admin snapshot.
{
  const read=deferred(),s=fixture({read,deferredSignOut:true});
  const refresh=s.ctx.actions.refresh({silent:true});
  const signOut=s.ctx.actions.signOut();
  assert.equal(s.rt.status,'unauthenticated','lock before signOut returns');
  assert.equal(s.rt.data,null,'clear protected summary before network');
  assert.equal(s.rt.session,null,'clear session before network');
  assert.ok(s.rt.refreshSeq>=2,'invalidate in-flight read generation');
  read.resolve({supportCases:[{message:'PRIVATE OLD CUSTOMER'}]});
  await refresh;
  assert.equal(s.rt.data,null,'late success cannot restore old support queue');
  assert.equal(s.rt.financeHistory.data,null,'financial history erased on logout');
  assert.equal(s.rt.merchantFinance.data,null,'merchant finance erased on logout');
  assert.equal(s.rt.providerHealth,null,'provider status erased on logout');
  s.logout.resolve();await signOut;
  assert.equal(s.rt.status,'unauthenticated');
}
// Even a late 401 must not poison a newer state after sign-out.
{
  const read=deferred(),s=fixture({read,deferredSignOut:true});
  const refresh=s.ctx.actions.refresh({silent:true});
  const out=s.ctx.actions.signOut();
  const err=Object.assign(Error('expired'),{status:401});
  read.reject(err);
  await refresh;
  assert.equal(s.rt.data,null);
  s.logout.resolve();await out;
}
// Auth SDK getSession may complete after sign-out. Its token is now invalid
// and must not be copied back into shared adminRuntime.session.
{
  const auth=deferred(),s=fixture({getSession:()=>auth.promise,deferredSignOut:true});
  const token=s.ctx.actions.token();
  const out=s.ctx.actions.signOut();
  auth.resolve({data:{session:{access_token:'old-secret',user:{id:'old-user'}}},error:null});
  await assert.rejects(()=>token,/sessão administrativa mudou/i);
  assert.equal(s.rt.session,null);
  s.logout.resolve();await out;
}
// User switch while an Auth query is pending must never authorize the
// previous user's token in a new account.
{
  const auth=deferred(),s=fixture({getSession:()=>auth.promise});
  const token=s.ctx.actions.token();
  auth.resolve({data:{session:{access_token:'different-user-token',user:{id:'other-user'}}},error:null});
  await assert.rejects(()=>token,/sessão administrativa mudou/i);
  assert.equal(s.rt.session.user.id,'old-user');
}
// Healthy token renewal and summary must continue to work.
{
  const s=fixture();
  assert.equal(await s.ctx.actions.token(),'old-secret');
  await s.ctx.actions.refresh({silent:true});
  assert.equal(s.rt.status,'ready');
  assert.ok(s.rt.data);
}
assert.match(source,/const initSeq=adminRuntime\.refreshSeq;/);
assert.match(source,/if\(initSeq!==adminRuntime\.refreshSeq\)return false;/);
assert.ok(audit.includes('node tests/admin-session-race-v1-493.mjs'));
console.log('TAMÃO #493 PASS — Admin logout, 401 and Auth races cannot restore prior user data.');
