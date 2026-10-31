import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
const take=(name)=>{
  const match=backend.match(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(match,'Missing '+name);
  const start=match.index, end=backend.indexOf('\n}',start);
  assert.ok(end>start,'Unterminated '+name);
  return backend.slice(start,end+2);
};
const source=['merchantClearProtectedSnapshot','merchantRefresh','merchantSelectLive',
 'merchantLoadOwnApplications','merchantTeamLoadLive'].map(take).join('\n');
new vm.Script(source,{filename:'merchant-access-snapshot'});

function fixture(respond){
  const writes=[], calls=[], renderStates=[], store=new Map([['chama-merchant-selected-v1','old-merchant']]);
  const rt={
    requested:true,status:'ready',client:{},refreshSeq:0,accessEpoch:0,
    session:{user:{id:'user-1'},access_token:'old-session'},
    selectedMerchantId:'old-merchant',
    merchant:{merchantId:'old-merchant',memberRole:'owner',name:'OLD PRIVATE'},
    memberships:[{merchantId:'old-merchant'}],
    ownApplications:[{id:'old-private-application'}],ownApplicationsLoaded:true,
    selectedApplicationId:'old-private-application',newApplicationMode:true,
    deliveryTeam:[{name:'old-private-driver'}],team:{members:['OLD PRIVATE']},teamLoading:false,
    enablement:{private:true},enablementSeq:0,enablementFetchedAt:Date.now(),
    catalog:[{productCode:'OLD'}],availableProducts:[{code:'OLD'}],
    billing:{balance:'OLD PRIVATE'},receivingAccount:{pix:'OLD PRIVATE'},
    receivingAccounts:[{pix:'OLD PRIVATE'}],paymentProviders:[{secret:'OLD PRIVATE'}],
    paymentRoutes:[{account:'OLD PRIVATE'}],paymentRouteVersion:12,
    orders:[{orderId:'old-private-order'}],recentClosedDeliveries:[{private:true}],
    supportSummary:{private:true},lastSyncAt:'2026-10-29T00:00:00Z',
    heartbeatError:'OLD PRIVATE',error:null,accessReason:null,
    recoveryFailures:0,nextRecoveryAt:0
  };
  const push={subscribed:false,checked:true,available:true,publicKey:'OLD',
    merchantId:'old-merchant',diagnostic:{private:true},deviceHealth:{private:true},
    healthError:'old',testResult:{private:true}};
  const alerts={knownOrderIds:new Set(['old-private-order'])};
  const ctx=vm.createContext({
    merchantRuntime:rt,merchantPushRuntime:push,merchantAlerts:alerts,
    merchantReady:()=>rt.status==='ready',
    merchantInvoke:async(...args)=>{calls.push(args);return respond(...args)},
    merchantOfflineGuard:denied=>writes.push(['offline-guard',denied]),
    merchantClearEnablement:()=>{
      rt.enablementSeq++;rt.enablement=null;
      rt.enablementLoading=false;rt.enablementError=null;rt.enablementFetchedAt=0;
    },
    merchantProcessOrderAlerts:()=>{},
    merchantPushDisableLive:async()=>{},
    merchantPushCheckLive:async()=>{},
    merchantLoadEnablement:async()=>{},
    queueMicrotask:()=>{},
    render:()=>renderStates.push({status:rt.status,orders:rt.orders.length}),
    localStorage:{
      getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),
      removeItem:key=>store.delete(key)
    }
  });
  vm.runInContext(source+'\nthis.ops={refresh:merchantRefresh,select:merchantSelectLive,clear:merchantClearProtectedSnapshot,loadTeam:merchantTeamLoadLive,loadApplications:merchantLoadOwnApplications};',ctx);
  return {rt,push,alerts,ctx,calls,writes,store,renderStates};
}
const http=(status,code)=>Object.assign(Error('Server denied'),{status,code});
const assertPurged=s=>{
  const {rt,push,alerts,ctx}=s;
  assert.equal(rt.merchant,null);
  for(const key of ['memberships','ownApplications','deliveryTeam','catalog',
    'availableProducts','receivingAccounts','paymentProviders','paymentRoutes',
    'orders','recentClosedDeliveries'])assert.equal(rt[key].length,0,key);
  for(const key of ['team','billing','receivingAccount','supportSummary',
    'enablement','lastSyncAt','selectedApplicationId'])assert.equal(rt[key],null,key);
  assert.equal(rt.paymentRouteVersion,1);
  assert.equal(rt.ownApplicationsLoaded,false);
  assert.equal(rt.newApplicationMode,false);
  assert.equal(rt.heartbeatError,null);
  assert.equal(alerts.knownOrderIds.size,0);
  for(const key of ['publicKey','merchantId','diagnostic','deviceHealth','healthError','testResult'])
    assert.equal(push[key],null,'push '+key);
  assert.equal(push.available,false);
  assert.equal(push.subscribed,false);
  assert.equal(ctx.merchantHistoryRequestId,1,'invalidate private history requests');
  assert.equal(ctx.merchantCatalogHistoryState,null);
};

// Server revocation must purge private data but retain login for own-applications recovery.
{
  const s=fixture(()=>{throw http(403,'MERCHANT_ACCESS_DENIED')});
  await s.ctx.ops.refresh({silent:true,recoverSelection:false});
  assert.equal(s.rt.status,'no-access');
  assert.ok(s.rt.session?.access_token,'revoking merchant is not signing out');
  assertPurged(s);
  assert.ok(s.writes.some(x=>x[0]==='offline-guard'&&x[1]===true));
}
// Expired/unauthorized user must lose the session and every protected snapshot.
for(const error of [http(401,'UNAUTHORIZED'),Error('Sessão da revenda expirada')]){
  const s=fixture(()=>{throw error});
  await s.ctx.ops.refresh({silent:true});
  assert.equal(s.rt.status,'unauthenticated');
  assert.equal(s.rt.session,null);
  assertPurged(s);
}
// Revoke selected merchant, retry once without stale selector, and never reuse old details.
{
  let attempts=0;
  const s=fixture(async()=>{
    if(++attempts===1)throw http(403,'MERCHANT_ROLE_NOT_ENABLED');
    assert.equal(s.rt.status,'loading');
    assert.equal(s.rt.orders.length,0,'no stale orders during fallback');
    assert.equal(s.rt.receivingAccounts.length,0,'no stale payment account during fallback');
    return {merchant:{merchantId:'new-merchant',memberRole:'operator'},
      memberships:[{merchantId:'new-merchant'}],orders:[{orderId:'new-only'}]};
  });
  await s.ctx.ops.refresh({silent:true});
  assert.equal(attempts,2);
  assert.equal(s.rt.status,'ready');
  assert.equal(s.rt.selectedMerchantId,'new-merchant');
  assert.equal(s.rt.orders[0].orderId,'new-only');
  assert.equal(s.rt.receivingAccounts.length,0);
  assert.equal(s.store.get('chama-merchant-selected-v1'),'new-merchant');
}
// Merchant switching must hide prior account details even before the server reply.
{
  let resolve;
  const pending=new Promise(r=>resolve=r);
  const s=fixture(()=>pending);
  const operation=s.ctx.ops.select('other-merchant');
  assert.equal(s.rt.status,'loading');
  assert.equal(s.rt.selectedMerchantId,'other-merchant');
  assert.equal(s.rt.orders.length,0);
  assert.equal(s.rt.receivingAccount,null);
  assert.ok(s.renderStates.every(x=>!(x.status==='ready'&&x.orders>0)),
    'never render old orders after selection');
  resolve({merchant:{merchantId:'other-merchant',memberRole:'operator'},orders:[]});
  await operation;
  assert.equal(s.rt.status,'ready');
  assert.equal(s.rt.merchant.merchantId,'other-merchant');
}
// Temporary outages are not authorization revocations. Keep recovery possible,
// but do not allow actions while the response is unverified.
{
  const s=fixture(()=>{throw http(503,'TEMPORARY_UNAVAILABLE')});
  await assert.rejects(()=>s.ctx.ops.refresh({silent:true}),/Server denied/);
  assert.equal(s.rt.status,'unavailable');
  assert.equal(s.rt.orders.length,1);
  assert.equal(s.ctx.merchantHistoryRequestId,undefined);
}

// A completed read from the old user must not restore private applications
// after a signout or a revoked membership.
{
  let release;
  const pending=new Promise(resolve=>release=resolve);
  const s=fixture(()=>pending);
  const read=s.ctx.ops.loadApplications();
  s.ctx.ops.clear();
  s.rt.session=null;
  s.rt.status='unauthenticated';
  release({applications:[{id:'old-account-private-application'}]});
  assert.equal((await read).length,0);
  assert.equal(s.rt.ownApplications.length,0);
  assert.equal(s.rt.ownApplicationsLoaded,false);
}
// A real 403 must invalidate auxiliary reads already in flight.
{
  let release;
  const pending=new Promise(resolve=>release=resolve);
  const s=fixture((name)=>{
    if(name==='submit-merchant-application')return pending;
    throw http(403,'MERCHANT_ACCESS_DENIED');
  });
  const read=s.ctx.ops.loadApplications();
  await s.ctx.ops.refresh({silent:true,recoverSelection:false});
  release({applications:[{id:'revoked-private-record'}]});
  assert.equal((await read).length,0);
  assert.equal(s.rt.ownApplications.length,0);
  assert.equal(s.rt.status,'no-access');
}
// A team response from the previous merchant must not refill the new account.
{
  let release;
  const pending=new Promise(resolve=>release=resolve);
  const s=fixture((name)=>name==='merchant-team'?pending:
    {merchant:{merchantId:'other-merchant',memberRole:'owner'},orders:[]});
  const team=s.ctx.ops.loadTeam({silent:true});
  const switched=s.ctx.ops.select('other-merchant');
  await switched;
  release({members:[{name:'OLD PRIVATE TEAM MEMBER'}]});
  await assert.rejects(()=>team,/acesso à revenda mudou/i);
  assert.equal(s.rt.team,null);
  assert.equal(s.rt.teamLoading,false);
  assert.equal(s.rt.merchant.merchantId,'other-merchant');
}
// Even without an explicit account switch, a role downgrade invalidates
// owner-only team data already requested.
{
  let release;
  const pending=new Promise(resolve=>release=resolve);
  const s=fixture(()=>pending);
  const team=s.ctx.ops.loadTeam({silent:true});
  s.rt.merchant={merchantId:'old-merchant',memberRole:'driver'};
  release({members:[{name:'PRIVATE OWNER RECORD'}]});
  await assert.rejects(()=>team,/acesso à revenda mudou/i);
  assert.equal(s.rt.team?.members?.[0],undefined);
}
// Healthy reads still work; a signed-in user without a merchant may view only
// their own onboarding applications.
{
  const s=fixture((name)=>name==='merchant-team'
    ?{members:[{name:'Authorized'}]}
    :{applications:[{id:'mine'}]});
  assert.equal((await s.ctx.ops.loadTeam({silent:true})).members[0].name,'Authorized');
  assert.equal((await s.ctx.ops.loadApplications()).length,1);
  s.ctx.ops.clear();
  s.rt.status='no-access';
  assert.equal((await s.ctx.ops.loadApplications()).length,1);
}

assert.ok(audit.includes('node tests/merchant-access-snapshot-v1-493.mjs'));
console.log('TAMÃO #493 PASS — 401/403 session purge, account switching, stale-selector rescue and 503 fail closed.');
