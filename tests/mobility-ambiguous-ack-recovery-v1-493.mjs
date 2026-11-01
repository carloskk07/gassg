import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Execute the actual mobility.js functions; no external account, production
// database, real GPS or customer data enters this test.
const source=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const rider='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const listing='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now=()=>new Date().toISOString();
const form={fields:{origin:'Centro sintético',destination:'Bairro sintético'}};
let renders=0,queries=[],rpc=[],records=[],phase='ack_lost',
 snapshotStatus='requested',deferred=null;
const mkRow=()=>({id:request,rider_id:rider,listing_id:listing,service:'moto',
 origin_area:form.fields.origin,destination_area:form.fields.destination,
 created_at:now()});
const query=(selected)=>({
  eq(k,v){queries.push(['eq',k,v]);return this},
  gte(k,v){queries.push(['gte',k,v]);return this},
  order(k,v){queries.push(['order',k,v]);return this},
  limit(n){queries.push(['limit',n]);return deferred?deferred.promise:
   Promise.resolve({data:records,error:null})},
  maybeSingle(){return Promise.resolve({data:{listing_id:listing},error:null})}
});
const client={
 from(table){assert.equal(table,'mobility_requests');return {
  select(fields){queries.push(['select',fields]);return query(fields)}};
 },
 async rpc(name,args){
  rpc.push([name,args]);
  if(name==='mobility_create_request'){
   if(phase==='ack_lost')throw Error('response lost after transaction commit');
   return {data:null,error:{code:'42501'}};
  }
  if(name==='mobility_my_requests')return {data:[{id:request,
   role:'rider',service:'moto',status:snapshotStatus,
   expires_at:new Date(Date.now()+600000).toISOString(),
   origin:form.fields.origin,destination:form.fields.destination}],error:null};
  if(name==='mobility_snapshot')return {data:{
   id:request,role:snapshotStatus==='requested'?'rider':'driver',service:'moto',status:snapshotStatus,
   origin:form.fields.origin,destination:form.fields.destination,
   expires_at:new Date(Date.now()+600000).toISOString(),position:null
  },error:null};
  if(name==='discovery_public_search')return {data:[],error:null};
  if(name==='mobility_transition')throw Error('ACK lost after accept');
  throw Error('Unexpected RPC: '+name);
 }
};
const doc={visibilityState:'visible',querySelector:()=>null,
 getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}},
 addEventListener:()=>{}};
const location={origin:'https://tamao.com.br',pathname:'/',search:
 '?corrida='+listing+'&modalidade=moto',hash:'#mobility'};
const ctx={console,URL,URLSearchParams,Date,FormData:class{
 constructor(element){this.data=element.fields}
 get(key){return this.data[key]??null}
},document:doc,location,route:()=> 'mobility',shell:x=>x,
 esc:x=>String(x??'').replaceAll('<','&lt;'),render:()=>renders++,
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'public-test'},
 navigator:{},setInterval:()=>17,clearInterval:()=>{},addEventListener:()=>{}};
ctx.globalThis=ctx;
vm.runInNewContext(source+';this.runtime=mobilityRuntime;',ctx,{filename:'js/mobility.js'});
const s=ctx.runtime;s.phase='ready';s.user={id:rider};s.client=client;
const event={preventDefault(){},target:form};
// ACK lost but a matching new row really exists, authorized by the caller's
// RLS SELECT. The UI must never ask the rider to create it a second time.
records=[mkRow()];
await ctx.mobilityCreate(event);
assert.equal(s.id,request);
assert.match(s.notice,/confirmada no servidor/);
assert.equal(s.error,'');
assert.equal(rpc.filter(x=>x[0]==='mobility_create_request').length,1);
assert.deepEqual(queries.filter(x=>x[0]==='eq').map(x=>x[1]),
 ['rider_id','listing_id','service','origin_area','destination_area','id']);
assert.ok(queries.some(x=>x[0]==='gte'&&x[1]==='created_at'));
assert.ok(queries.some(x=>x[0]==='limit'&&x[1]===2));
assert.ok(rpc.some(x=>x[0]==='mobility_snapshot'),'recovery must reread server state');
// If no row is visible, or two indistinguishable rows exist, fail closed.
s.id='';s.detail=null;s.items=[];s.notice='';
records=[];
await ctx.mobilityCreate(event);
assert.equal(s.id,'');
assert.match(s.error,/Não foi possível confirmar/);
records=[mkRow(),mkRow()];s.error='';
await ctx.mobilityCreate(event);
assert.equal(s.id,'');
assert.match(s.error,/Não foi possível confirmar/);
// Stale, forged owner, URL mismatch and future timestamps are not evidence.
const started=Date.now();
for(const bad of [
 {...mkRow(),rider_id:other},
 {...mkRow(),listing_id:other},
 {...mkRow(),service:'carro'},
 {...mkRow(),origin_area:'Outro bairro'},
 {...mkRow(),destination_area:'Outro lugar'},
 {...mkRow(),created_at:new Date(started-60000).toISOString()},
 {...mkRow(),created_at:new Date(Date.now()+120000).toISOString()},
 {...mkRow(),id:'not-a-uuid'}
]){
 records=[bad];
 assert.equal(await ctx.mobilityRecoverCreatedRequest({id:listing,mode:'moto'},
  form.fields.origin,form.fields.destination,started,s.sessionEpoch,rider),'');
}
// A delayed result from the previous account must not restore the ride.
let release;deferred={promise:new Promise(resolve=>{release=resolve})};
const epoch=s.sessionEpoch;
const inFlight=ctx.mobilityRecoverCreatedRequest({id:listing,mode:'moto'},
 form.fields.origin,form.fields.destination,started,epoch,rider);
s.sessionEpoch++;s.user={id:other};
release({data:[mkRow()],error:null});
assert.equal(await inFlight,'');
assert.equal(s.id,'');
deferred=null;s.user={id:rider};s.items=[];s.detail=null;
s.id=request;s.error='';s.notice='';
snapshotStatus='accepted';
await ctx.mobilityTransition('accept');
assert.equal(s.error,'');
assert.match(s.notice,/confirmada no servidor/);
assert.equal(s.detail?.status,'accepted');
assert.equal(rpc.filter(x=>x[0]==='mobility_transition').length,1,
 'ambiguous ACK cannot automatically replay a non-idempotent action');
// Server readback must match the exact expected transition, not simply
// show any change or a stale pre-mutation snapshot.
snapshotStatus='requested';
assert.equal(await ctx.mobilityRecoverTransition('accept',request,s.sessionEpoch,rider),null);
snapshotStatus='cancelled';
assert.equal(await ctx.mobilityRecoverTransition('accept',request,s.sessionEpoch,rider),null);
// A different account and unknown ride are never a confirmation.
snapshotStatus='accepted';
// A passenger cannot get a false acknowledgement of a driver's acceptance.
const originalRpc=client.rpc;
client.rpc=async(name,args)=>name==='mobility_snapshot'
 ?{data:{id:request,role:'rider',status:'accepted'},error:null}
 :originalRpc(name,args);
assert.equal(await ctx.mobilityRecoverTransition('accept',request,s.sessionEpoch,rider),null);
client.rpc=originalRpc;
s.user={id:other};
assert.equal(await ctx.mobilityRecoverTransition('accept',request,s.sessionEpoch,rider),null);
s.user={id:rider};s.id=listing;
assert.equal(await ctx.mobilityRecoverTransition('accept',request,s.sessionEpoch,rider),null);
assert.ok(renders>0);
assert.match(fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8'),
 /node tests\/mobility-ambiguous-ack-recovery-v1-493\.mjs/);
console.log('PASS: lost create/transition ACK recovers exact authorized server state; no duplicate writes, no cross-account or stale confirmation');
