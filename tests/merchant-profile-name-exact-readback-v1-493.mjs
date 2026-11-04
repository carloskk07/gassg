import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant-mutations.js'),backend=read('js/backend.js'),
  merchant=read('js/merchant.js'),edge=read('supabase/functions/merchant-ops/index.ts'),
  audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant-mutations.js'});
const MID='11111111-1111-4111-8111-111111111111';
const ACTOR='22222222-2222-4222-8222-222222222222';
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture({role='driver',postGate=null,readGate=null,postError=null,
  ackOverride=null,staleRead=false,wrongRead=false,commitOnError=true,
  initialName='Membro anterior'}={}){
 const state={name:initialName,role};
 const rt={status:'ready',session:{user:{id:ACTOR}},
  merchant:{merchantId:MID,memberRole:role},
  selectedMerchantId:MID,accessEpoch:4,actionPending:false,error:null,
  lastSyncAt:'2026-01-01T00:00:00.000Z',
  deliveryTeam:[{userId:ACTOR,memberRole:role,displayName:initialName}]};
 let reads=0;const calls=[],renders=[];
 const ctx=vm.createContext({
  merchantRuntime:rt,globalThis:null,Date,Number,String,JSON,Array,Object,Set,
  render:()=>renders.push({pending:rt.actionPending,actor:rt.session?.user?.id}),
  merchantInvoke:async (endpoint,payload)=>{
   calls.push({endpoint,payload});
   if(postGate)await postGate.promise;
   assert.equal(endpoint,'merchant-ops');
   assert.equal(payload.merchantId,MID);
   assert.equal(payload.action,'update-member-profile');
   if(!postError||commitOnError)state.name=payload.displayName;
   if(postError)throw postError;
   return ackOverride||{ok:true,memberRole:state.role,displayName:state.name};
  },
  merchantRefresh:async ({silent})=>{
   assert.equal(silent,true);reads++;
   if(readGate)await readGate.promise;
   const data={merchant:{merchantId:MID,memberRole:state.role},
     deliveryTeam:[{userId:ACTOR,memberRole:state.role,
      displayName:wrongRead?'Another name':state.name}]};
   if(!staleRead&&rt.session?.user?.id===ACTOR){
    rt.merchant=data.merchant;rt.deliveryTeam=data.deliveryTeam;
    rt.lastSyncAt=new Date().toISOString();
   }
   return data;
  }
 });
 ctx.globalThis=ctx;vm.runInContext(src,ctx);
 return {ctx,rt,state,calls,renders,
  get reads(){return reads},
  update:name=>ctx.merchantMemberProfileMutateImpl(name),
  changeActor({merchant=false}={}){
   rt.accessEpoch++;rt.session={user:{id:'another-account'}};
   if(merchant){rt.merchant={merchantId:'another-merchant',memberRole:'owner'};
    rt.selectedMerchantId='another-merchant';}
   rt.actionPending=true;
  }
 };
}
for(const role of ['owner','manager','operator','driver']){
 const f=fixture({role});
 const ack=await f.update('  Ana  Maria  ');
 assert.equal(ack.displayName,'Ana Maria',role);
 assert.equal(f.calls.length,1,role);
 assert.equal(f.calls[0].payload.displayName,'Ana Maria',role);
 assert.equal(f.rt.deliveryTeam[0].displayName,'Ana Maria',role);
 assert.equal(f.rt.actionPending,false,role);
 assert.equal(f.reads,1,role);
}
{
 const f=fixture({role:'driver'});
 await assert.rejects(()=>f.update(''),/2 e 60/);
 await assert.rejects(()=>f.update('a'),/2 e 60/);
 await assert.rejects(()=>f.update('a'.repeat(61)),/2 e 60/);
 await assert.rejects(()=>f.update('Ana\u0000Maria'),/2 e 60/);
 assert.equal(f.calls.length,0);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture({role:'guest'});
 await assert.rejects(()=>f.update('Ana Maria'),/Atualize seu acesso/);
 assert.equal(f.calls.length,0);
}
{
 const f=fixture({ackOverride:{ok:true,memberRole:'driver',displayName:'Wrong person'}});
 await assert.rejects(()=>f.update('Ana Maria'),/servidor não confirmou/);
 assert.equal(f.reads,0);
}
{
 const f=fixture({wrongRead:true});
 await assert.rejects(()=>f.update('Ana Maria'),/não foi confirmado/);
 assert.equal(f.reads,1);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture({staleRead:true});
 await assert.rejects(()=>f.update('Ana Maria'),/não foi confirmado/);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture({postError:Object.assign(Error('MERCHANT_ACCESS_DENIED'),{status:403}),
  commitOnError:false});
 await assert.rejects(()=>f.update('Ana Maria'),/MERCHANT_ACCESS_DENIED/);
 assert.equal(f.reads,0,'definitive 403 may never be inferred successful from old name');
}
{
 const f=fixture({postError:Object.assign(Error('Rate limited'),{status:429}),
  commitOnError:false});
 await assert.rejects(()=>f.update('Ana Maria'),/Rate limited/);
 assert.equal(f.reads,0,'explicit rate limit is not ambiguous');
}
{
 const f=fixture({postError:new TypeError('Lost HTTP ACK after commit')});
 const result=await f.update('Ana Maria');
 assert.equal(result.reconciledAfterNetworkError,true);
 assert.equal(f.reads,1);
 assert.equal(f.calls.length,1,'no automatic POST replay after lost ACK');
}
{
 const f=fixture({postError:new TypeError('Lost HTTP ACK'),commitOnError:false});
 await assert.rejects(()=>f.update('Ana Maria'),/não foi confirmado/);
 assert.equal(f.calls.length,1);
 assert.equal(f.rt.actionPending,false);
}
{
 const g=gate(),f=fixture({postGate:g});
 const pending=f.update('Ana Maria');
 assert.equal(f.calls.length,1);
 await assert.rejects(()=>f.update('Outra pessoa'),/Aguarde/);
 f.changeActor({merchant:true});g.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.reads,0);
 assert.equal(f.rt.actionPending,true,'old action must never unlock another account');
}
{
 const g=gate(),f=fixture({readGate:g});
 const pending=f.update('Ana Maria');
 for(let i=0;i<25&&f.reads<1;i++)await Promise.resolve();
 assert.equal(f.reads,1);
 f.changeActor();g.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.rt.actionPending,true);
}
{
 const f=fixture({initialName:'Ana Maria',postError:new Error('UNKNOWN_PROVIDER'),
  commitOnError:false});
 await assert.rejects(()=>f.update('Ana Maria'),/UNKNOWN_PROVIDER/);
 assert.equal(f.reads,0,'unclassified error never turns an old identical name into a success');
}
assert.match(backend,/async function merchantUpdateMemberProfileLive\(displayName\)/);
assert.match(backend,/merchantLoadMutations\(\)/);
assert.match(backend,/merchantMemberProfileMutateImpl\(displayName\)/);
assert.match(edge,/if\(action==="update-member-profile"\)/);
assert.match(merchant,/await merchantUpdateMemberProfileLive\(name\)/);
assert.match(audit,/merchant-profile-name-exact-readback-v1-493\.mjs/);
console.log('PASS: all staff roles, exact saved name, early permissions, ambiguous ACK, account-switch and no false profile success');
