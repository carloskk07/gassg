import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/merchant-orders/index.ts');
const merchant=read('js/merchant.js');
const start=edge.indexOf('async function merchantBusinessDraftFromApprovedApplication(');
const end=edge.indexOf('const ACTIVE_STATUSES=[',start);
assert.ok(start>=0&&end>start,'extract owner-only draft helper');
const code=edge.slice(start,end)
  .replaceAll(':any','').replaceAll(':string','')
  .replaceAll(':boolean','').replaceAll(':number','');
const ctx=vm.createContext({String,Number});
vm.runInContext(code+';this.suggest=merchantBusinessDraftFromApprovedApplication;',ctx);
const id='11111111-1111-4111-8111-111111111111';
const merchantRec={id,name:'Revenda modelo',cnpj:'12345678000190',status:'pending',address_text:'Rua de exemplo, 123'};
let requests=[],err=null,application={
 company_name:'Comercio Exemplo Ltda',
 responsible_name:'Proprietario Modelo',
 phone:'(55) 99999-8888',
 address_text:'Rua de exemplo, 123'
};
const db={from(table){
  assert.equal(table,'merchant_applications');
  const steps=[['from',table]];
  const builder={
    select(fields){steps.push(['select',fields]);return builder;},
    eq(key,value){steps.push(['eq',key,value]);return builder;},
    order(key,opts){steps.push(['order',key,opts]);return builder;},
    limit(n){steps.push(['limit',n]);return builder;},
    async maybeSingle(){requests.push(steps);return {data:application,error:err};}
  };
  return builder;
}};
const result=await ctx.suggest(db,id,merchantRec,'owner',false);
assert.equal(result.source,'previous_owner_application');
assert.equal(result.suggested,true);
assert.equal(result.verified,false);
assert.equal(result.legalName,'Comercio Exemplo Ltda');
assert.equal(result.tradeName,'Revenda modelo');
assert.equal(result.responsibleName,'Proprietario Modelo');
assert.equal(result.phone,'55999998888');
assert.equal(result.whatsapp,'55999998888');
assert.equal(result.addressText,'Rua de exemplo, 123');
assert.equal(result.postalCode,'');
assert.equal(result.city,'');
assert.equal(result.state,'');
assert.equal(requests.length,1);
assert.deepEqual(requests[0].filter(x=>x[0]==='eq').map(x=>[x[1],x[2]]),[
 ['applicant_user_id',id],['cnpj',merchantRec.cnpj],['status','approved']
]);
assert.deepEqual(requests[0].filter(x=>x[0]==='limit'),[['limit',1]]);
assert.doesNotMatch(code,/\.insert\(|\.update\(|\.delete\(|\.rpc\(/,
 'helper MUST NOT auto-create or verify a merchant');
assert.match(edge,/businessDraft=await merchantBusinessDraftFromApprovedApplication/);
assert.match(edge,/businessDraft,\s*status:merchant.status/);
assert.match(edge,/selected.member_role==="owner"/);
assert.match(edge,/assertPermanentMerchantUser/);
assert.match(edge,/selectMerchantMembership\(memberships,requestedMerchantId\)/);
const initialCalls=requests.length;
for(const [role,stored,status,cnpj] of [
 ['manager',false,'pending',merchantRec.cnpj],
 ['driver',false,'pending',merchantRec.cnpj],
 ['owner',true,'pending',merchantRec.cnpj],
 ['owner',false,'active',merchantRec.cnpj],
 ['owner',false,'pending','invalid-cnpj'],
]){
  const out=await ctx.suggest(db,id,{...merchantRec,status,cnpj},role,stored);
  assert.equal(out,null);assert.equal(requests.length,initialCalls,
    'no application read for non-owner, existing profile or active merchant');
}
application=null;
assert.equal(await ctx.suggest(db,id,merchantRec,'owner',false),null);
application={company_name:'<script>alert(1)</script>',responsible_name:'X',
  phone:'000-000',address_text:'<div>Injected</div>'};
const unsafe=await ctx.suggest(db,id,merchantRec,'owner',false);
assert.equal(unsafe.legalName,'');
assert.equal(unsafe.responsibleName,'');
assert.equal(unsafe.phone,'');
assert.equal(unsafe.whatsapp,'');
assert.equal(unsafe.addressText,'Rua de exemplo, 123',
  'unsafe application address falls back to existing merchant address, still unverified');
const noSafeAddress=await ctx.suggest(db,id,{
  ...merchantRec,address_text:'<script>bad address</script>'
},'owner',false);
assert.equal(noSafeAddress.addressText,'',
  'unsafe application and fallback addresses must both be ignored');
err={message:'connection down'};
assert.equal(await ctx.suggest(db,id,merchantRec,'owner',false),null,
  'draft lookup failure must not block merchant orders');
err=null;
const uiStart=merchant.indexOf('function merchantBusinessProfileView(rt){');
const uiEnd=merchant.indexOf('function merchantBusinessProfileFocus(){',uiStart);
assert.ok(uiStart>=0&&uiEnd>uiStart);
const uiPrelude=merchant.indexOf('let merchantBusinessUnsavedDraft=null;');
assert.ok(uiPrelude>=0&&uiPrelude<uiStart,
 'the owner renderer requires its real in-memory draft controller');
const htmlCode=merchant.slice(uiPrelude,uiEnd);
const view=vm.createContext({
  esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
});
vm.runInContext(htmlCode+';this.draw=merchantBusinessProfileView;',view);
const pending={merchant:{memberRole:'owner',status:'pending',businessDetails:null,
 businessDraft:result},actionPending:false};
const html=view.draw(pending);
assert.match(html,/Dados sugeridos do seu cadastro anterior/);
assert.match(html,/value="Comercio Exemplo Ltda"/);
assert.match(html,/value="55999998888"/);
assert.match(html,/Complete CEP, cidade e UF/);
assert.match(html,/Nenhum campo foi aprovado automaticamente/);
assert.match(html,/Salvar meus dados para conferência/);
assert.ok(!html.includes('value="São Gabriel"'),'city must not be invented');
const saved={city:'São Gabriel',state:'RS',postalCode:'97300000',
 addressText:'Centro 123',legalName:'Empresa Confirmada'};
const savedHtml=view.draw({...pending,merchant:{...pending.merchant,businessDetails:saved}});
assert.match(savedHtml,/Empresa Confirmada/);
assert.doesNotMatch(savedHtml,/Dados sugeridos do seu cadastro anterior/);
assert.doesNotMatch(view.draw({...pending,merchant:{...pending.merchant,memberRole:'manager'}}),
 /Razão social/,'manager must not see owner form');
const safeHtml=view.draw({...pending,merchant:{...pending.merchant,businessDraft:{
  ...result,legalName:'<svg onload=alert(1)>'
}}});
assert.doesNotMatch(safeHtml,/<svg onload/);
assert.match(safeHtml,/&lt;svg/);
console.log('PASS owner-only prior application suggestion is read-only, identity-bound, non-authoritative and safely rendered');


// Poll redraw regression: owner must be able to finish the legal/contact form
// without losing manual changes when the entire dashboard HTML is replaced.
const draftStart=merchant.indexOf('let merchantBusinessUnsavedDraft=null;');
const draftEnd=merchant.indexOf('function merchantBusinessProfileFocus(){',draftStart);
assert.ok(draftStart>0&&draftEnd>draftStart);
const source=merchant.slice(draftStart,draftEnd);
const userId='11111111-1111-4111-8111-111111111111';
const merchantId='22222222-2222-4222-8222-222222222222';
const ownerRt={status:'ready',actionPending:false,
 session:{user:{id:userId}},
 merchant:{merchantId,memberRole:'owner',status:'pending',
  businessDetails:null,businessDraft:result}};
const inputValues={
 legalName:'Razao confirmada',
 tradeName:'Revenda confirmada',
 responsibleName:'Responsavel confirmado',
 phone:'55999998888',whatsapp:'55999998888',
 postalCode:'97300000',city:'Sao Gabriel',state:'RS',
 addressText:'Rua confirmada 123'
};
const draftCtx=vm.createContext({
 String,globalThis:{merchantRuntime:ownerRt},
 document:{getElementById(id){const field=id.replace('merchant-business-','');
   return Object.hasOwn(inputValues,field)?{value:inputValues[field]}:null;}},
 esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
});
vm.runInContext(source+
  ';this.changed=merchantBusinessProfileChanged;this.draw=merchantBusinessProfileView;'+
  'this.currentDraft=()=>merchantBusinessUnsavedDraft;'+
  'this.clear=()=>{merchantBusinessUnsavedDraft=null}',draftCtx);
assert.match(draftCtx.draw(ownerRt),/value="Comercio Exemplo Ltda"/);
assert.equal(draftCtx.changed(),true);
const reRendered=draftCtx.draw(ownerRt);
assert.match(reRendered,/value="Razao confirmada"/);
assert.match(reRendered,/value="97300000"/);
assert.match(reRendered,/value="Sao Gabriel"/);
assert.match(reRendered,/ajustes ainda não foram salvos/);
assert.match(reRendered,/oninput="merchantBusinessProfileChanged\(\)"/);
assert.equal(draftCtx.currentDraft().key,userId+'::'+merchantId);
const secondOwner={...ownerRt,session:{user:{id:'33333333-3333-4333-8333-333333333333'}}};
assert.doesNotMatch(draftCtx.draw(secondOwner),/Razao confirmada/,
 'an unrelated owner must not see the previous owner draft');
const secondMerchant={...ownerRt,merchant:{...ownerRt.merchant,
 merchantId:'44444444-4444-4444-8444-444444444444'}};
assert.doesNotMatch(draftCtx.draw(secondMerchant),/Razao confirmada/,
 'unsaved details must not cross merchant identities');
const manager={...ownerRt,merchant:{...ownerRt.merchant,memberRole:'manager'}};
assert.equal(draftCtx.changed.call(null),true,
 'original owner context can still edit their own draft');
draftCtx.globalThis.merchantRuntime=manager;
assert.equal(draftCtx.changed(),false);
assert.equal(draftCtx.draw(manager),'');
draftCtx.globalThis.merchantRuntime=ownerRt;
ownerRt.merchant.businessDetails={legalName:'Razao salva',tradeName:'Revenda salva',
 responsibleName:'Responsavel salvo',phone:'55999998888',whatsapp:'55999998888',
 postalCode:'97300000',city:'Sao Gabriel',state:'RS',addressText:'Rua salva 123'};
assert.match(draftCtx.draw(ownerRt),/value="Razao confirmada"/,
 'an unrelated prior saved profile MUST NOT overwrite an unsaved correction');
assert.equal(draftCtx.currentDraft().key,userId+'::'+merchantId,
 'do not discard corrected contact information just because older details exist');
assert.equal(draftCtx.changed(),true,
 'owner must be able to edit an existing pending business profile');
ownerRt.merchant.businessDetails={...inputValues};
assert.match(draftCtx.draw(ownerRt),/value="Razao confirmada"/);
assert.equal(draftCtx.currentDraft(),null,
 'only the exact server-read values may clear unsaved corrections');
inputValues.legalName='Razao corrigida novamente';
assert.equal(draftCtx.changed(),true);
assert.match(draftCtx.draw(ownerRt),/value="Razao corrigida novamente"/,
 'a second edit of a saved profile also survives a poll redraw');
ownerRt.merchant.businessDetails=null;
assert.equal(draftCtx.currentDraft()?.values?.legalName,'Razao corrigida novamente');
draftCtx.clear();
assert.doesNotMatch(draftCtx.draw(ownerRt),/Razao corrigida novamente/,
 'a discarded draft must not be restored');
assert.match(merchant,/merchantBusinessUnsavedDraft=null;\s+await merchantSignOut\(/,
 'sign-out must clear in-memory owner legal data');
assert.match(merchant,/const submittedKey=merchantBusinessDraftKey\(merchantRuntime\)/,
 'remember the same authenticated owner and merchant when saving');
assert.match(merchant,/!merchantBusinessProfileMatches\(refreshed\?\.merchant\?\.businessDetails,payload\)/,
 'RPC acknowledgement alone must never count as a saved business profile');
assert.match(merchant,/if\(!merchantBusinessProfileChanged\(\)\)/,
 'capture the entire valid form including autofill before a rendering refresh');

// Run the real mutation helper with a simulated RPC response and server readback.
// A successful mutation acknowledgement is insufficient without owner-bound,
// byte-equivalent persisted data; no live owner or production data is altered.
const saveStart=merchant.indexOf('async function merchantUpdateBusinessDetailsLive(payload){');
assert.ok(saveStart>0&&saveStart<draftStart);
const submitRt={status:'ready',actionPending:false,
 session:{user:{id:userId}},
 merchant:{merchantId,memberRole:'owner',status:'pending',
  businessDetails:null,businessDraft:result}};
const submitted={
 legalName:'Empresa aprovada somente como declaração',
 tradeName:'Comercio de teste',responsibleName:'Responsavel de teste',
 phone:'55999998888',whatsapp:'55999998888',postalCode:'97300000',
 city:'Sao Gabriel',state:'RS',addressText:'Rua de teste, 123'
};
let readback='none',writes=0,enablementCalls=0,renderCalls=0;
const saveCtx=vm.createContext({
 String,merchantRuntime:submitRt,globalThis:{merchantRuntime:submitRt},
 merchantConfigMutation:async(action,data)=>{
   assert.equal(action,'update-business-details');
   assert.equal(data.legalName,submitted.legalName);
   writes++;
   return {ok:true,action,pendingAdministrativeVerification:true};
 },
 merchantRefresh:async()=>{
   if(readback==='none')return null; // including unauthenticated/no-access cases
   const stored={...submitted,city:readback==='stale'?'Cidade diferente':submitted.city};
   if(readback==='match')submitRt.merchant.businessDetails=stored;
   return {merchant:{...submitRt.merchant,businessDetails:stored,
     merchantId:readback==='other-merchant'?secondMerchant.merchant.merchantId:merchantId}};
 },
 merchantEnablementAfterChange:()=>{enablementCalls++;},
 render:()=>{renderCalls++;},
 document:{getElementById(id){
   const key=id.replace('merchant-business-','');
   return Object.hasOwn(submitted,key)?{value:submitted[key]}:null;
 }},
 esc:s=>String(s)
});
vm.runInContext(merchant.slice(saveStart,draftEnd)+
 ';this.saveBusiness=merchantUpdateBusinessDetailsLive;'+
 'this.captureBusiness=merchantBusinessProfileChanged;'+
 'this.businessDraft=()=>merchantBusinessUnsavedDraft;',saveCtx);
assert.equal(saveCtx.captureBusiness(),true);
await assert.rejects(()=>saveCtx.saveBusiness(submitted),/não foi possível conferir os dados salvos/i,
 'RPC ack + absent readback must NOT be shown as successful');
assert.equal(submitRt.actionPending,false);
assert.equal(saveCtx.businessDraft()?.values?.legalName,submitted.legalName,
 'retain draft when the backend read cannot verify persistence');
assert.equal(enablementCalls,0);
readback='stale';
await assert.rejects(()=>saveCtx.saveBusiness(submitted),/não foi possível conferir os dados salvos/i,
 'stale server profile cannot be displayed as just saved');
assert.ok(saveCtx.businessDraft(),'retains draft after stale read');
readback='other-merchant';
await assert.rejects(()=>saveCtx.saveBusiness(submitted),/não foi possível conferir os dados salvos/i,
 'server data from another merchant can never certify this save');
readback='match';
const savedResponse=await saveCtx.saveBusiness(submitted);
assert.equal(savedResponse.pendingAdministrativeVerification,true);
assert.equal(submitRt.merchant.businessDetails.city,submitted.city);
assert.equal(saveCtx.businessDraft(),null,'clear only after exact owner-bound readback');
assert.equal(enablementCalls,1);
assert.equal(renderCalls,8,'every mutation must restore the controls');
assert.equal(writes,4);
assert.equal(submitRt.actionPending,false);
console.log('PASS: exact persisted owner business profile gates UI success, preserves corrected drafts on failed/stale readback');

console.log('PASS: unsaved owner form survives background redraw and is isolated by owner and merchant');
