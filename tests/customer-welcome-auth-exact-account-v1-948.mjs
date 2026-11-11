import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../js/welcome-bonus.js',import.meta.url),'utf8');
new vm.Script(src);
let clock=100000, profileReadbacks=0,resolveA=null;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const user=id=>({id,email:'confirmed@example.invalid',email_confirmed_at:'2026-11-11T12:00:00Z'});
let claimResult={granted:false,reason:'ineligible'};
const client={rpc:async name=>{
 assert.equal(name,'claim_welcome_bonus_v1_815');
 if(ctx.liveRuntime.session.user.id===A)
  return new Promise(resolve=>resolveA=resolve);
 return {data:claimResult,error:null};
}};
const session=id=>({access_token:'token-'+id,user:user(id)});
const ctx=vm.createContext({
 document:{
  readyState:'loading',addEventListener:()=>{},
  querySelectorAll:()=>[],getElementById:()=>null
 },
 liveRuntime:{client,status:'ready',session:session(A)},
 liveSyncFinancialProfile:async()=>{profileReadbacks++},
 CHAMA_BACKEND:{url:'https://api.example.invalid',publishableKey:'anon-public'},
 fetch:async(_url,init)=>{
  assert.equal(init.method,'POST');
  return {ok:true,json:async()=>({active:true,remaining:100,awardCents:100})};
 },
 Date:class FakeDate extends Date{static now(){return clock}},
 String,Number,Intl,URL,Map,Set,Promise,console
});
vm.runInContext(src+'\nthis.api={claim:tamaoWelcomeClaimVerifiedUser,state:()=>tamaoWelcomeBonus};',ctx);
const {claim,state}=ctx.api;
vm.runInContext('tamaoWelcomeBonus.status={active:true,remaining:100,awardCents:100}',ctx);
const pending=claim();
assert.ok(resolveA,'first user request pending');
ctx.liveRuntime.session=session(B);
resolveA({data:{granted:true,alreadyGranted:false},error:null});
await pending;
assert.equal(state().lastUser,null,'old session must not contaminate new account');
assert.equal(profileReadbacks,0,'late old response cannot trigger new wallet readback');
clock+=61000;
await claim();
assert.equal(state().lastUser,null,'ineligible reply cannot mark account as awarded');
claimResult={granted:true,alreadyGranted:false};
clock+=61000;
await claim();
assert.equal(state().lastUser,B);
assert.equal(profileReadbacks,1);
await claim();
assert.equal(profileReadbacks,1,'granted account is not credited again');
console.log('V1.948 PASS: stale session ignored, ineligible claim retryable, successful award exact account only.');
