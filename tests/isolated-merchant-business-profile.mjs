import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// ALL DB fixtures are disposable local-only. Uses actual Auth JWT and live
// merchant-ops + merchant-orders Edge, never production or mock handler.
export async function verifyIsolatedMerchantBusinessProfile({base,anon,owner,outsider,sql,q}){
 assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
 assert.equal(process.env.CI,'true');
 assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
 const merchantId=randomUUID();
 sql("INSERT INTO public.merchants(id,name,cnpj,status,online) VALUES("+
  q(merchantId)+"::uuid,'Revenda Pendente Somente CI','00000000000000','pending',false);");
 sql("INSERT INTO public.merchant_members(merchant_id,user_id,member_role,active) VALUES("+
  q(merchantId)+"::uuid,"+q(owner.id)+"::uuid,'owner',true);");
 async function invoke(action,actor,body,key){
  const res=await fetch(base+'/functions/v1/'+(action==='load'?'merchant-orders':'merchant-ops'),{
   method:'POST',headers:{
    apikey:anon,Authorization:'Bearer '+actor.token,Origin:'http://localhost:5173',
    'Content-Type':'application/json',
    ...(key?{'Idempotency-Key':key}:{})
   },body:JSON.stringify(body),signal:AbortSignal.timeout(45000)
  });
  return {status:res.status,body:await res.json()};
 }
 try{
  assert.equal(sql("SELECT count(*) FROM public.merchant_business_details WHERE merchant_id="+q(merchantId)+"::uuid"),'0');
  const before=await invoke('load',owner,{merchantId});
  assert.equal(before.status,200,'owner may load selected pending merchant');
  assert.equal(before.body.merchant?.businessProfile,null,'never synthesize registration defaults');
  const unauthorized=await invoke('load',outsider,{merchantId});
  assert.equal(unauthorized.status,403,'outsider must not read private registration');
  const profile={
   legalName:'Empresa de Teste Somente CI',tradeName:'Revenda CI',
   responsibleName:'Titular de Teste',phone:'11999999999',
   whatsapp:'11988888888',postalCode:'97300000',
   city:'São Gabriel',state:'RS',addressText:'Rua Simulada CI, número 10'
  };
  const initialVersion=before.body.merchant.configUpdatedAt;
  assert.ok(initialVersion,'canonical optimistic-concurrency version');
  const key='ci-onboard-'+randomUUID();
  const payload={action:'update-business-profile',merchantId,expectedUpdatedAt:initialVersion,...profile};
  const stranger=await invoke('save',outsider,payload,'ci-stranger-'+randomUUID());
  assert.equal(stranger.status,403,'non-member cannot complete registration');
  const invalid=await invoke('save',owner,{...payload,phone:'abc'},'ci-invalid-'+randomUUID());
  assert.equal(invalid.status,400,'invalid phone rejected by server');
  assert.equal(sql("SELECT count(*) FROM public.merchant_business_details WHERE merchant_id="+q(merchantId)+"::uuid"),'0',
   'no partial profile after denied/invalid attempts');
  const saved=await invoke('save',owner,payload,key);
  assert.equal(saved.status,200,'owner save: '+JSON.stringify(saved.body).slice(0,260));
  assert.equal(saved.body.businessProfileSaved,true);
  assert.equal(saved.body.requiresAdminReview,true);
  assert.equal(saved.body.merchantStatus,'pending');
  assert.equal(saved.body.online,false);
  const row=sql("SELECT city||'|'||state||'|'||postal_code FROM public.merchant_business_details WHERE merchant_id="+q(merchantId)+"::uuid");
  assert.equal(row,'São Gabriel|RS|97300000');
  const reloaded=await invoke('load',owner,{merchantId});
  assert.equal(reloaded.status,200);
  assert.equal(reloaded.body.merchant?.businessProfile?.city,'São Gabriel');
  assert.equal(reloaded.body.merchant?.businessProfile?.legalName,profile.legalName);
  assert.equal(reloaded.body.merchant?.businessProfile?.phone,profile.phone);
  const replay=await invoke('save',owner,payload,key);
  assert.equal(replay.status,200);
  assert.deepEqual(replay.body,saved.body,'lost-ACK replay idempotent');
  const changed=await invoke('save',owner,
   {...payload,city:'Outra Cidade'},'ci-conflict-'+randomUUID());
  assert.equal(changed.status,409,'stale config version cannot overwrite profile');
  assert.equal(sql("SELECT city FROM public.merchant_business_details WHERE merchant_id="+q(merchantId)+"::uuid"),'São Gabriel');
  sql("UPDATE public.merchants SET status='active' WHERE id="+q(merchantId)+"::uuid;");
  const afterActive=await invoke('save',owner,
   {...payload,expectedUpdatedAt:reloaded.body.merchant.configUpdatedAt},
   'ci-active-'+randomUUID());
  assert.equal(afterActive.status,409,'active merchant cannot self-relocate past Admin checks');
  assert.equal(afterActive.body.error,'MERCHANT_PROFILE_LOCKED');
  assert.equal(sql("SELECT status||'|'||online FROM public.merchants WHERE id="+q(merchantId)+"::uuid"),'active|false');
  assert.equal(sql("SELECT city FROM public.merchant_business_details WHERE merchant_id="+q(merchantId)+"::uuid"),'São Gabriel');
  console.log('PASS: real local Auth owner creates pending business registration; outsider denied, missing/invalid input rejected, CAS and replay hold, active edit locked; no approval or sale.');
 }finally{
  sql("DELETE FROM public.merchants WHERE id="+q(merchantId)+"::uuid;");
 }
 assert.equal(sql("SELECT count(*) FROM public.merchants WHERE id="+q(merchantId)+"::uuid"),'0');
}
