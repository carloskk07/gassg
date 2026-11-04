import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise production functions with intentionally delayed canonical ACKs and
// authenticated refreshes. No real merchant or backend is mutated.
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const backend=read('js/backend.js'),merchant=read('js/merchant.js');
function pick(name){
  const head=(name.startsWith('merchantEditable')?'function ':'async function ')+name+'(';
  const start=backend.indexOf(head),end=backend.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'production function missing: '+name);
  return backend.slice(start,end+2);
}
const script=['merchantEditableMutationScope','merchantEditableMutationSame',
  'merchantUpdateProductLive','merchantTeamMutateLive'].map(pick).join('\n');
new vm.Script(script);
const ID='11111111-1111-4111-8111-111111111111',ACTOR='actor-A';
const initial=()=>({productCode:'P13',priceCents:11500,availableStock:4,
 active:true,updatedAt:'2026-10-01T00:00:00.000Z',pricingMode:'fixed',
 minPriceCents:11500,maxPriceCents:11500,pricingStrategy:'balanced'});
function gate(){
 let resolve,reject;
 return {promise:new Promise((ok,no)=>{resolve=ok;reject=no}),resolve,reject};
}
function setup({postGate=null,refreshGate=null,teamGate=null,ack=null,
  staleRead=false,wrongRead=false,teamUnavailable=false}={}){
  const calls=[],events=[];
  const rt={status:'ready',merchant:{merchantId:ID,memberRole:'owner'},
    selectedMerchantId:ID,session:{user:{id:ACTOR}},accessEpoch:9,
    catalog:[initial()],team:{members:[]},actionPending:false,error:null,
    lastSyncAt:new Date().toISOString()};
  let postedBody=null,refreshes=0,teamReads=0,enabled=0;
  const ctx=vm.createContext({
    merchantRuntime:rt,Date,Number,String,Object,
    render:()=>events.push({pending:rt.actionPending,user:rt.session?.user?.id}),
    liveIdempotency:kind=>'fixed-fixture:'+kind,
    retryAmbiguousOnce:fn=>fn(),
    merchantEnablementAfterChange:()=>{enabled++},
    merchantInvoke:async(name,body,options)=>{
      calls.push({name,body,options});
      postedBody=body;
      if(postGate)await postGate.promise;
      if(ack)return ack;
      return name==='merchant-ops'?{product:{productCode:'P13'}}:{status:'updated'};
    },
    merchantRefresh:async({silent})=>{
      assert.equal(silent,true);
      refreshes++;
      if(refreshGate)await refreshGate.promise;
      const price=wrongRead?11500:Number(postedBody?.priceCents||11500);
      const newCatalog=[{...initial(),priceCents:price,availableStock:
        wrongRead?4:Number(postedBody?.availableStock??4),
        active:postedBody?.active??true,updatedAt:new Date().toISOString()}];
      const data={merchant:{merchantId:ID,memberRole:'owner'},catalog:newCatalog};
      if(!staleRead&&rt.session?.user?.id===ACTOR){
        rt.catalog=data.catalog;rt.merchant=data.merchant;
        rt.lastSyncAt=new Date().toISOString();
      }
      return data;
    },
    merchantTeamLoadLive:async({silent})=>{
      assert.equal(silent,true);teamReads++;
      if(teamGate)await teamGate.promise;
      if(teamUnavailable)return null;
      const fresh={members:[{id:'verified-member'}]};
      if(rt.session?.user?.id===ACTOR)rt.team=fresh;
      return fresh;
    }
  });
  vm.runInContext(script+
    '\nthis.ops={catalog:merchantUpdateProductLive,team:merchantTeamMutateLive};',ctx);
  const switchActor=({newLock=true}={})=>{
    rt.accessEpoch++;
    rt.session={user:{id:'actor-B'}};
    rt.actionPending=newLock;
  };
  return {rt,calls,events,ctx,switchActor,
    catalog:(price=12500,stock=3)=>ctx.ops.catalog('P13',price,stock,true),
    team:()=>ctx.ops.team('invite',{email:'new@example.invalid',memberRole:'driver'}),
    get refreshes(){return refreshes},
    get teamReads(){return teamReads},
    get enabled(){return enabled}
  };
}
// Full happy path must read exact SKU/stock/price from the latest applied
// merchant-orders response before telling the seller the save succeeded.
{
 const f=setup();
 const row=await f.catalog();
 assert.equal(row.priceCents,12500);
 assert.equal(row.availableStock,3);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].body.expectedUpdatedAt,initial().updatedAt);
 assert.equal(f.calls[0].body.merchantId,ID);
 assert.equal(f.enabled,1);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=setup({wrongRead:true});
 await assert.rejects(()=>f.catalog(),/valores diferentes dos salvos/);
 assert.equal(f.enabled,0,'unverified price never counts as confirmed');
 assert.equal(f.rt.actionPending,false);
}
{
 const f=setup({staleRead:true});
 await assert.rejects(()=>f.catalog(),/não foi confirmada/);
 assert.equal(f.enabled,0,'discarded readback cannot be reported as success');
}
{
 const f=setup({ack:{ok:true}});
 await assert.rejects(()=>f.catalog(),/não foi comprovada/);
 assert.equal(f.enabled,0,'HTTP 200 with no product proof is not success');
}
{
 const f=setup(),count=f.calls.length;
 f.rt.merchant.memberRole='driver';
 await assert.rejects(()=>f.catalog(),/proprietário ou gerente/);
 assert.equal(f.calls.length,count);
}
{
 const block=gate(),f=setup({postGate:block});
 const pending=f.catalog();
 assert.equal(f.calls.length,1);
 await assert.rejects(()=>f.catalog(),/Aguarde/,'no double write');
 f.switchActor();
 block.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.refreshes,0,'old ACK cannot refresh new operator');
 assert.equal(f.enabled,0);
 assert.equal(f.rt.actionPending,true,'old finally cannot unlock new operator');
}
{
 const block=gate(),f=setup({refreshGate:block});
 const pending=f.catalog();
 for(let n=0;n<20&&f.refreshes<1;n++)await Promise.resolve();
 assert.equal(f.refreshes,1,'readback started before the identity change');
 f.switchActor();
 block.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.enabled,0);
 assert.equal(f.rt.actionPending,true);
}
// Team actions also need the original account lease and an applied,
// owner-authorized readback. An old invitation cannot unlock the new user.
{
 const f=setup();
 const result=await f.team();
 assert.equal(result.status,'updated');
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].body.action,'invite');
 assert.equal(f.refreshes,1);
 assert.equal(f.teamReads,1);
 assert.equal(f.rt.team.members[0].id,'verified-member');
 assert.equal(f.rt.actionPending,false);
}
{
 const f=setup({staleRead:true});
 await assert.rejects(()=>f.team(),/cadastro da equipe não foi confirmado/);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=setup({teamUnavailable:true});
 await assert.rejects(()=>f.team(),/Não foi possível confirmar a equipe/);
 assert.equal(f.rt.actionPending,false);
}
{
 const block=gate(),f=setup({postGate:block});
 const pending=f.team();
 assert.equal(f.calls.length,1);
 f.switchActor();
 block.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.refreshes,0);
 assert.equal(f.teamReads,0);
 assert.equal(f.rt.actionPending,true,'old invite cannot release the new account lock');
 assert.equal(f.rt.error,null,'old operator error cannot overwrite next operator');
}
{
 const block=gate(),f=setup({refreshGate:block});
 const pending=f.team();
 for(let n=0;n<20&&f.refreshes<1;n++)await Promise.resolve();
 assert.equal(f.refreshes,1);
 f.switchActor();
 block.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.teamReads,0);
 assert.equal(f.rt.actionPending,true);
}
// Existing UI remains bound to the canonical code rather than a new RPC.
assert.match(merchant,/await merchantUpdateProductLive\(/);
assert.match(backend,/merchantEditableMutationScope\(/);
assert.match(read('.github/workflows/audit.yml'),
 /node tests\/merchant-catalog-team-account-lease-v1-493\.mjs/);
console.log('PASS: merchant catalog/team account lease, exact-price readback, role denial, stale ACK, double submit and no new-actor unlock');
