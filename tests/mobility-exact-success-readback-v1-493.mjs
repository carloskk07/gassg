import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/mobility.js'),audit=read('.github/workflows/audit.yml');
const listing='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
new vm.Script(src,{filename:'js/mobility.js'});
const wait=()=>{let release;return {promise:new Promise(r=>release=r),release};};
const form={fields:{origin:'Centro sintético',destination:'Bairro sintético'}};
const event={preventDefault(){},target:form};
const snapshot=(status='requested',role='rider')=>({
 id:request,role,service:'moto',status,origin:form.fields.origin,
 destination:form.fields.destination,position:null
});
function fixture({createdId=request,createError=null,createGate=null,
 readGate=null,readSuccess=true,wrongCreate=null,snapshotStatus='accepted',
 snapshotRole='driver',snapshotError=null,transitionGate=null,transitionError=null,
 recoverId=null}={}){
 const calls=[],messages=[];
 let reads=0,errors=0,recoveries=0;
 const ctx={
  console,Date,URL,URLSearchParams,
  FormData:class{constructor(target){this.values=target.fields}get(k){return this.values[k]||null}},
  location:{origin:'https://tamao.com.br',pathname:'/',search:'?corrida='+listing+
   '&modalidade=moto',hash:'#mobility'},
  document:{querySelector:()=>null,getElementById:()=>null,createElement:()=>({}),
   head:{appendChild(){}},addEventListener(){}},
  route:()=> 'mobility',shell:x=>x,render:()=>{},
  esc:x=>String(x??''),setInterval:()=>1,clearInterval(){},
  navigator:{},addEventListener(){},CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'anon'}
 };
 ctx.globalThis=ctx;
 vm.runInNewContext(src+';this.runtime=mobilityRuntime;',ctx,{filename:'js/mobility.js'});
 const s=ctx.runtime;
 s.phase='ready';s.user={id:actor};
 s.client={async rpc(name,args){
  calls.push({name,args});
  if(name==='mobility_create_request'){
   if(createGate)await createGate.promise;
   if(createError)throw createError;
   return {data:createdId,error:null};
  }
  if(name==='mobility_transition'){
   if(transitionGate)await transitionGate.promise;
   if(transitionError)throw transitionError;
   return {data:snapshotStatus,error:null};
  }
  if(name==='mobility_snapshot'){
   if(snapshotError)return {data:null,error:snapshotError};
   return {data:snapshot(snapshotStatus,snapshotRole),error:null};
  }
  throw Error('Unexpected RPC: '+name);
 }};
 ctx.mobilityRefresh=async()=>{
  reads++;
  if(readGate)await readGate.promise;
  if(!readSuccess)return false;
  if(s.user?.id!==actor)return false;
  if(s.id===request){
   s.detail=wrongCreate?{...snapshot('requested','rider'),...wrongCreate}:
    snapshot('requested','rider');
   s.syncUnavailable=false;
   return true;
  }
  return false;
 };
 // RLS retrieval itself has a separate, production-backed regression suite;
 // here isolate the exact confirmation that the user sees after its result.
 ctx.mobilityRecoverCreatedRequest=async()=>{recoveries++;return recoverId||'';};
 return {ctx,s,calls,messages,
  get reads(){return reads},get recoveries(){return recoveries},
  create:()=>ctx.mobilityCreate(event),
  transition:(action='accept')=>{s.id=request;s.detail=snapshot('requested','driver');
   return ctx.mobilityTransition(action)},
  switchAccount(){s.sessionEpoch++;s.user={id:second};s.id='';s.detail=null;s.busy=false;}
 };
}
{
 const f=fixture();
 await f.create();
 assert.equal(f.s.id,request);
 assert.equal(f.reads,1,'ACK alone is not creation proof');
 assert.equal(f.s.detail.role,'rider');
 assert.match(f.s.notice,/confirmada no servidor/);
 assert.equal(f.s.error,'');
 assert.equal(f.s.busy,false);
 assert.equal(f.calls.filter(x=>x.name==='mobility_create_request').length,1);
}
for(const wrongCreate of [
 {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},
 {role:'driver'},{service:'carro'},
 {origin:'Outro bairro'},{destination:'Outro destino'},
 {status:'unknown'}
]){
 const f=fixture({wrongCreate});
 await f.create();
 assert.equal(f.s.notice,'','never report successful create with mismatched participant data');
 assert.match(f.s.error,/não foi possível conferir o atendimento/);
 assert.equal(f.calls.filter(x=>x.name==='mobility_create_request').length,1,
  'wrong readback must not replay order creation');
 assert.equal(f.s.busy,false);
}
{
 const f=fixture({readSuccess:false});
 await f.create();
 assert.equal(f.s.notice,'');
 assert.match(f.s.error,/não foi possível conferir o atendimento/);
 assert.equal(f.reads,2,'can check read-only again but must never post twice');
 assert.equal(f.calls.filter(x=>x.name==='mobility_create_request').length,1);
}
{
 const f=fixture({createError:Error('lost network ACK'),recoverId:request});
 await f.create();
 assert.equal(f.recoveries,1);
 assert.equal(f.reads,1);
 assert.match(f.s.notice,/localizada e confirmada no servidor/);
 assert.equal(f.calls.filter(x=>x.name==='mobility_create_request').length,1);
}
{
 const f=fixture({createError:Error('lost network ACK')});
 await f.create();
 assert.equal(f.s.notice,'');
 assert.match(f.s.error,/Não foi possível confirmar o envio/);
 assert.equal(f.calls.filter(x=>x.name==='mobility_create_request').length,1);
}
{
 const g=wait(),f=fixture({createGate:g});
 const pending=f.create();
 assert.equal(f.calls.filter(x=>x.name==='mobility_create_request').length,1);
 f.switchAccount();g.release();
 await pending;
 assert.equal(f.s.id,'');
 assert.equal(f.s.notice,'');
 assert.equal(f.reads,0);
 assert.equal(f.s.busy,false,'new operator session remains unaffected by old creation');
}
{
 const f=fixture({snapshotStatus:'accepted',snapshotRole:'driver'});
 await f.transition('accept');
 assert.match(f.s.notice,/confirmada no servidor/);
 assert.equal(f.s.error,'');
 assert.equal(f.s.busy,false);
 assert.equal(f.calls.filter(x=>x.name==='mobility_transition').length,1);
 assert.equal(f.calls.filter(x=>x.name==='mobility_snapshot').length,1,
  'positive ACK must be independently confirmed via authorized participant read');
}
for(const bad of [
 {snapshotStatus:'requested',snapshotRole:'driver'},
 {snapshotStatus:'cancelled',snapshotRole:'driver'},
 {snapshotStatus:'accepted',snapshotRole:'rider'},
 {snapshotStatus:'arrived',snapshotRole:'driver'}
]){
 const f=fixture(bad);
 await f.transition('accept');
 assert.equal(f.s.notice,'','ACK must not produce success with wrong/forbidden status');
 assert.match(f.s.error,/Não foi possível confirmar a alteração/);
 assert.equal(f.calls.filter(x=>x.name==='mobility_transition').length,1);
 assert.equal(f.calls.filter(x=>x.name==='mobility_snapshot').length,2,
  'only read-only reconciliation may be retried');
}
{
 const f=fixture({snapshotError:Error('permission revoked')});
 await f.transition('accept');
 assert.equal(f.s.notice,'');
 assert.match(f.s.error,/Não foi possível confirmar a alteração/);
 assert.equal(f.calls.filter(x=>x.name==='mobility_transition').length,1);
}
{
 const f=fixture({transitionError:Error('ACK lost'),snapshotStatus:'accepted'});
 await f.transition('accept');
 assert.match(f.s.notice,/confirmada no servidor/);
 assert.equal(f.calls.filter(x=>x.name==='mobility_transition').length,1);
 assert.equal(f.calls.filter(x=>x.name==='mobility_snapshot').length,1);
}
{
 const f=fixture({snapshotStatus:'cancelled',snapshotRole:'rider'});
 await f.transition('cancel');
 assert.match(f.s.notice,/confirmada no servidor/);
 assert.equal(f.s.error,'');
}
for(const [action,status] of [
 ['depart','en_route'],['arrive','arrived'],['finish','completed'],['reject','rejected']
]){
 const f=fixture({snapshotStatus:status,snapshotRole:'driver'});
 await f.transition(action);
 assert.match(f.s.notice,/confirmada no servidor/,action);
 assert.equal(f.s.error,'',action);
 assert.equal(f.calls.filter(x=>x.name==='mobility_transition').length,1,action);
 assert.equal(f.calls.filter(x=>x.name==='mobility_snapshot').length,1,action);
}

{
 const g=wait(),f=fixture({transitionGate:g});
 const pending=f.transition('accept');
 assert.equal(f.calls.filter(x=>x.name==='mobility_transition').length,1);
 f.switchAccount();g.release();
 await pending;
 assert.equal(f.s.id,'');
 assert.equal(f.s.notice,'');
 assert.equal(f.calls.filter(x=>x.name==='mobility_snapshot').length,0);
}
{
 // An authenticated direct snapshot is sufficient proof even when the
 // subsequent non-authoritative list poll loses connectivity.
 const f=fixture({readSuccess:false,snapshotStatus:'accepted'});
 await f.transition('accept');
 assert.match(f.s.notice,/confirmada no servidor/);
 assert.equal(f.s.error,'');
 assert.equal(f.s.busy,false);
}
assert.match(src,/function mobilityCreatedRequestVerified\(/);
assert.match(src,/const confirmed=await mobilityRecoverTransition\(action,selected,epoch,userId\)/);
assert.match(src,/mobilityCreatedRequestVerified\(intent,origin,destination/);
assert.match(audit,/mobility-exact-success-readback-v1-493\.mjs/);
console.log('PASS: moto/car rider creation and driver transitions demand exact authenticated result, preserve session and forbid duplicate mutations');
