import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js');
const edge=read('supabase/functions/submit-merchant-application/index.ts');
const audit=read('.github/workflows/audit.yml');
const grab=signature=>{
 const start=backend.indexOf(signature),end=backend.indexOf('\n}\n',start);
 assert.ok(start>=0&&end>start,'missing actual implementation '+signature);
 return backend.slice(start,end+2);
};
const implementations=[
 'async function merchantLoadOwnApplications(){',
 'function merchantPilotInviteErrorMessage(error){',
 'async function merchantClaimPilotInviteLive(applicationId,pilotInviteToken){',
 'async function merchantSubmitApplicationLive(payload){'
].map(grab).join('\n');
new vm.Script(implementations,{filename:'merchant-onboarding-readback.js'});
const USER='applicant-owner-A',ID='11111111-1111-4111-8111-111111111111';
const data={
 cnpj:'12.345.678/0001-99',companyName:'Empresa de Teste',
 responsibleName:'Proprietário de Teste',phone:'(55) 99999-9999',
 address:'Rua Central, 125',pilotInviteToken:''
};
const row={
 id:ID,cnpj:'12345678000199',company_name:'Empresa de Teste',
 responsible_name:'Proprietário de Teste',phone:'55999999999',
 address_text:'Rua Central, 125',status:'pending',
 created_at:'2026-11-03T20:00:00.000Z',
 updated_at:'2026-11-04T03:00:00.000Z'
};
const receipt={
 applicationId:ID,cnpj:row.cnpj,companyName:row.company_name,status:'pending',
 createdAt:row.created_at,reused:false,pilotPartner:null
};
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture({submitGate=null,readGate=null,submitError=null,receiptOverride=null,
 readRows=[row],status='no-access',inviteResult=null}={}){
 const rt={
  session:{user:{id:USER},access_token:'permanent-session'},status,
  accessEpoch:15,actionPending:false,ownApplications:[],
  ownApplicationsLoaded:false,applicationFetchError:null,client:{rpc:async()=>({data:inviteResult,error:null})}
 };
 let postCount=0,readCount=0,cleared=0,claimCount=0;
 const ctx=vm.createContext({
  merchantRuntime:rt,Date,String,Error,Number,Array,Object,JSON,
  clearMerchantPilotInviteToken:()=>cleared++,
  merchantInvoke:async(name,body)=>{
   assert.equal(name,'submit-merchant-application');
   if(body.action==='my-applications'){
    readCount++;
    if(readGate)await readGate.promise;
    return {applications:readRows};
   }
   postCount++;
   if(submitGate)await submitGate.promise;
   if(submitError)throw submitError;
   return receiptOverride===null?receipt:receiptOverride;
  }
 });
 vm.runInContext(implementations+
   '\nthis.submit=merchantSubmitApplicationLive;this.claim=merchantClaimPilotInviteLive;'+
   'this.load=merchantLoadOwnApplications;',ctx);
 return{
  rt,ctx,
  submit:(payload=data)=>ctx.submit(payload),
  claim:(app=ID,token='A'.repeat(40))=>{claimCount++;return ctx.claim(app,token)},
  swap({merchantStatus='no-access'}={}){
   rt.accessEpoch++;rt.session={user:{id:'applicant-owner-B'},access_token:'account-B'};
   rt.status=merchantStatus;
   rt.ownApplications=[];rt.actionPending=true;
  },
  get posts(){return postCount},
  get reads(){return readCount},
  get clears(){return cleared},
  get claims(){return claimCount}
 };
}
{
 const f=fixture();
 const result=await f.submit();
 assert.equal(result.applicationId,ID);
 assert.equal(result.status,'pending');
 assert.equal(f.posts,1);assert.equal(f.reads,1);
 assert.equal(f.rt.ownApplicationsLoaded,true);
 assert.equal(f.rt.ownApplications[0].responsible_name,row.responsible_name);
 assert.equal(f.rt.actionPending,false);
 assert.equal(f.clears,0);
}
{
 const f=fixture({receiptOverride:{...receipt,applicationId:'another-company-application'}});
 await assert.rejects(()=>f.submit(),/não foram confirmados/i);
 assert.equal(f.reads,1,'wrong application ID cannot be reconciled from a different row');
}
for(const patch of [
 {cnpj:'not-company'},{companyName:'Empresa diferente'},{status:'approved'}
]){
 const f=fixture({receiptOverride:{...receipt,...patch}});
 await assert.rejects(()=>f.submit(),/não corresponde/i);
 assert.equal(f.reads,0,'inconsistent ACK cannot bypass authenticated proof');
}
for(const patch of [
 {id:'another-application'}, {cnpj:'00000000000000'},
 {company_name:'Empresa Fantasma'}, {responsible_name:'Pessoa Diferente'},
 {phone:'99999999999'}, {address_text:'Outro endereço'},
 {status:'approved'}
]){
 const f=fixture({readRows:[{...row,...patch}]});
 await assert.rejects(()=>f.submit(),/não foram confirmados|não foi confirmad/i);
 assert.equal(f.rt.ownApplicationsLoaded,true,'actual server list remains visible for diagnosis');
 assert.equal(f.posts,1);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture({readRows:[]});
 await assert.rejects(()=>f.submit(),/não foram confirmados/i);
 assert.equal(f.posts,1);
 assert.equal(f.rt.ownApplications.length,0,'no synthetic application inserted');
}
{
 const f=fixture({submitError:new Error('Network lost')});
 const result=await f.submit();
 assert.equal(result.applicationId,ID);
 assert.equal(result.reconciledAfterNetworkError,true);
 assert.equal(f.posts,1,'ambiguous post must NEVER be repeated blindly');
 assert.equal(f.reads,1);
}
{
 const f=fixture({submitError:new Error('Network lost'),readRows:[]});
 await assert.rejects(()=>f.submit(),/interrompida.*não foi possível comprovar/i);
 assert.equal(f.posts,1);
 assert.equal(f.reads,1);
}
{
 const f=fixture({submitError:Object.assign(new Error('invalid CNPJ'),{status:400,code:'INVALID_CNPJ'})});
 await assert.rejects(()=>f.submit(),/invalid CNPJ/);
 assert.equal(f.reads,0,'explicit server 4xx is never reconciled into fake success');
 assert.equal(f.posts,1);
}
{
 const block=gate(),f=fixture({submitGate:block});
 const pending=f.submit();
 assert.equal(f.posts,1);
 await assert.rejects(()=>f.submit(),/Aguarde/);
 f.swap();
 block.resolve();
 await assert.rejects(pending,/Sua conta mudou/);
 assert.equal(f.rt.actionPending,true,'account A cannot release lock of account B');
 assert.equal(f.reads,0);
 assert.equal(f.rt.ownApplications.length,0);
}
{
 const block=gate(),f=fixture({readGate:block});
 const pending=f.submit();
 for(let i=0;i<35&&f.reads===0;i++)await Promise.resolve();
 assert.equal(f.reads,1);
 f.swap();
 block.resolve();
 await assert.rejects(pending,/Sua conta mudou/);
 assert.equal(f.rt.ownApplications.length,0,'stale read must not be installed');
 assert.equal(f.rt.actionPending,true);
}
{
 const f=fixture({status:'unauthenticated'});
 await assert.rejects(()=>f.submit(),/Atualize a sessão/);
 assert.equal(f.posts,0);
}
{
 const f=fixture();
 f.rt.session={user:{id:USER}};
 await assert.rejects(()=>f.submit(),/Entre com seu e-mail/);
 assert.equal(f.posts,0);
}
{
 // The server may have committed a valid application while a pilot invite
 // still needs manual reconnection. Never clear a different user's invite.
 const f=fixture();
 const r=await f.claim(ID,'A'.repeat(40));
 assert.equal(r,null);
 assert.equal(f.clears,1);
}
{
 const block=gate(),f=fixture();
 f.rt.client={rpc:async()=>{await block.promise;return {data:{ok:true},error:null}}};
 const pending=f.claim(ID,'A'.repeat(40));
 f.swap();
 block.resolve();
 await assert.rejects(pending,/A conta mudou/);
 assert.equal(f.clears,0,'old applicant cannot clear a newer account invitation');
}
assert.match(edge,/\\.eq\("applicant_user_id",user\.id\)/);
assert.match(edge,/body\.action==="my-applications"/);
assert.match(backend,/merchantSubmitApplicationLive\(payload\)/);
assert.doesNotMatch(grab('async function merchantSubmitApplicationLive(payload){'),
 /ownApplications=\[\{/,'never synthesize a pending company from client input');
assert.match(audit,/node tests\/merchant-application-submission-readback-v1-493\.mjs/);
console.log('PASS: real owner application submit/readback, prior status, ambiguous ACK, duplicate click, account switch, invite isolation');
