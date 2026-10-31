import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
function take(name){
 const m=backend.match(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(m,'missing '+name);
 const end=backend.indexOf('\n}',m.index);
 assert.ok(end>m.index,'unterminated '+name);
 return backend.slice(m.index,end+2);
}
const source=['liveForgetAccount','liveAccessToken','liveGetOrder','liveSyncFinancialProfile'].map(take).join('\n');
new vm.Script(source,{filename:'customer-account-race'});
const OLD='10000000-0000-4000-8000-000000000493';
const d=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function fixture(){
 const pending=new Map(),local=new Map([['order-key',OLD]]);
 const calls=[],reloads=[],saves=[];
 const user={id:'old-user'};
 const rt={status:'ready',requested:true,session:{user,access_token:'old-token'},
  client:{auth:{getSession:async()=>({data:{session:{user,access_token:'old-token'}},error:null})}},
  order:{orderId:OLD,deliveryPin:'PRIVATE PIN',status:'OUT_FOR_DELIVERY',version:3},
  orderId:OLD,orderCheckedAt:'2026-10-31T00:00:00Z',orderCheckedId:OLD,
  orderRequestSeq:0,financialSyncSeq:0,offerRequestSeq:0,marketStatusSeq:0,
  offers:[{private:true}],lastCityCheck:{private:true},
  lastOrderTemplate:{address:'PRIVATE'},reorderPrediction:{private:true},
  referredCount:2,qualifiedReferralCount:1,comparisonSavingsCents:100,
  cashbackEarnedCents:250,lastFinancialSyncAttemptAt:0,lastFinancialSyncAt:0};
 const state={user:{name:'Previous customer',cashback:120,referralCode:'PRIVATE',
  cashbackDebt:0,commissionAvailable:10,commissionPending:20,
  purchases:5,reversedPurchases:0,cashEarningEligible:true,identityType:'verified'},
  address:'PRIVATE STREET',postalCode:'12345678',addressNumber:'9',
  checkout:{customerPhoneDigits:'51999999999'}};
 let tokenResult=async()=>({data:{session:{user,access_token:'old-token'}},error:null});
 rt.client.auth.getSession=()=>tokenResult();
 const ctx=vm.createContext({
  liveRuntime:rt,state,
  localStorage:{setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
  CHAMA_BACKEND:{orderStorageKey:'order-key'},
  liveReady:()=>rt.status==='ready',
  liveInvoke:(route)=>{calls.push(route);
    const req=d();pending.set(route,req);return req.promise;},
  freshSeed:()=>({user:{name:'',cashback:0,referralCode:'',commissionAvailable:0}}),
  location:{reload:()=>reloads.push('reload')},
  save:()=>saves.push('save'),
  render:()=>{},Date,Math,JSON,Number,String,console:{warn:()=>{}},
  CUSTOMER_FINANCIAL_REFRESH_MS:0
 });
 vm.runInContext(source+
 '\nthis.ops={reset:liveForgetAccount,token:liveAccessToken,order:liveGetOrder,summary:liveSyncFinancialProfile}',ctx);
 return {ctx,rt,state,pending,local,calls,reloads,saves,
  nextToken:fn=>tokenResult=fn};
}
// A stale get-order from the former customer cannot reopen that customer's PIN.
{
 const s=fixture();
 const request=s.ctx.ops.order(OLD,{silent:true});
 s.rt.session={access_token:'other',user:{id:'new-user'}};
 s.pending.get('get-order').resolve({orderId:OLD,deliveryPin:'OLD SECRET',status:'OUT_FOR_DELIVERY',version:9});
 assert.equal(await request,null);
 assert.equal(s.rt.order.version,3);
 assert.equal(s.rt.orderCheckedId,OLD);
}
// A late financial summary must never move balances or referral data across accounts.
{
 const s=fixture();
 const request=s.ctx.ops.summary({force:true});
 s.rt.session={access_token:'other',user:{id:'new-user'}};
 s.pending.get('customer-summary').resolve({cashbackCents:555555,commissionAvailableCents:55555,activeOrderId:'old-private'});
 assert.equal(await request,false);
 assert.equal(s.state.user.cashback,120);
 assert.equal(s.rt.orderId,OLD);
}
// A changed SDK identity wipes prior customer data before any further operation.
{
 const s=fixture();
 s.nextToken(async()=>({data:{session:{access_token:'new-token',user:{id:'new-user'}}},error:null}));
 await assert.rejects(()=>s.ctx.ops.token(),/Conta alterada/);
 assert.equal(s.rt.status,'loading');
 assert.equal(s.rt.session,null);
 assert.equal(s.rt.order,null);
 assert.equal(s.rt.orderId,null);
 assert.equal(s.rt.lastOrderTemplate,null);
 assert.equal(s.rt.offers.length,0);
 assert.equal(s.state.user.referralCode,'');
 assert.equal(s.state.user.name,'');
 assert.equal(s.state.address,'');
 assert.equal(s.state.checkout.customerPhoneDigits,'');
 assert.equal(s.local.has('order-key'),false);
 assert.equal(s.reloads.length,1);
 assert.equal(s.saves.length,1);
}
// An older getSession callback cannot revive its token after the account was invalidated.
{
 const s=fixture(),auth=d();
 s.nextToken(()=>auth.promise);
 const request=s.ctx.ops.token();
 s.ctx.ops.reset();
 auth.resolve({data:{session:{access_token:'old-token',user:{id:'old-user'}}},error:null});
 await assert.rejects(()=>request,/Conta alterada/);
 assert.equal(s.rt.session,null);
 assert.equal(s.reloads.length,1);
}
// Healthy refresh must still return the existing user's token.
{
 const s=fixture();
 assert.equal(await s.ctx.ops.token(),'old-token');
 assert.equal(s.rt.status,'ready');
 assert.equal(s.reloads.length,0);
}
assert.match(backend,/client\.auth\.onAuthStateChange\(/,
 'Auth user changes must be detected even without a pending API request');
assert.ok(audit.includes('node tests/customer-account-race-v1-493.mjs'));
console.log('TAMÃO #493 PASS — customer balances, PIN and account sessions isolated on Auth switch.');
