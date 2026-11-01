import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Exercises canonical Supabase Data API/SECURITY DEFINER functions with REAL
// local Auth JWTs. The caller must pass only disposable localhost endpoints.
export async function verifyIsolatedPrivilegedRpc({base,anon,sql,q,owner,buyer,outsider,adminActor}){
 assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
 assert.equal(process.env.CI,'true');
 assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
 const listingId=randomUUID(),requestId=randomUUID();
 const headers=token=>({apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'});
 async function rest(resource,token,body){
  const res=await fetch(base+'/rest/v1/'+resource,{
   method:body===undefined?'GET':'POST',headers:headers(token),
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(20000)
  });
  const raw=await res.text();
  let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}
  return {status:res.status,data};
 }
 const rpc=(name,token,args={})=>rest('rpc/'+name,token,args);
 // Fixture: a PRIVATE professional listing plus a participant-only request.
 // The new database guard requires a valid published and city-enabled
 // provider AT INSERT time. Publish ONLY in this throwaway DB, insert the
 // request, immediately withdraw the listing before any HTTP calls. Thus the
 // existing test still proves that a private listing is never discoverable.
 sql("INSERT INTO public.discovery_vertical_cities(vertical,state_code,city_key,city_name,enabled) "+
  "VALUES('professionals','RS','sao-gabriel','São Gabriel',true) "+
  "ON CONFLICT(vertical,state_code,city_key) DO UPDATE SET enabled=true;");
 sql("INSERT INTO public.discovery_listings(id,owner_id,vertical,status,title,description,state_code,city_key,city_name,whatsapp_e164) "+
  "VALUES("+q(listingId)+"::uuid,"+q(owner.id)+"::uuid,'professionals','published','Mototaxi sintético CI',"+
  "'Ficha particular do condutor sintético para teste de autenticação',"+
  "'RS','sao-gabriel','São Gabriel','+5555999999999');");
 try {
  sql("INSERT INTO public.discovery_professional_details(listing_id,occupation,service_area) "+
   "VALUES("+q(listingId)+"::uuid,'Mototáxi','Bairro sintético CI');");
  sql("INSERT INTO public.mobility_requests(id,rider_id,driver_id,listing_id,service,origin_area,destination_area,expires_at) "+
   "VALUES("+q(requestId)+"::uuid,"+q(buyer.id)+"::uuid,"+q(owner.id)+"::uuid,"+q(listingId)+
   "::uuid,'moto','Origem sintética','Destino sintético',clock_timestamp()+interval '10 minutes');");
  // Simulate withdrawal by the moderator: the request stays participant-only,
  // while no other citizen may browse or book an unpublished provider.
  sql("UPDATE public.discovery_listings SET status='draft' WHERE id="+q(listingId)+"::uuid;");
  const ownerListings=await rpc('discovery_my_listings',owner.token);
  const foreignListings=await rpc('discovery_my_listings',buyer.token);
  assert.equal(ownerListings.status,200,'owner listing RPC: '+JSON.stringify(ownerListings).slice(0,250));
  assert.equal(foreignListings.status,200,'buyer listing RPC');
  assert.ok(Array.isArray(ownerListings.data)&&ownerListings.data.some(x=>x.id===listingId),
   'owner must retrieve a private listing using SECURITY DEFINER');
  assert.ok(Array.isArray(foreignListings.data)&&!foreignListings.data.some(x=>x.id===listingId),
   'unrelated verified buyer must not retrieve private owner listings');

  for(const [actor,expected] of [[owner,true],[buyer,false],[adminActor,false]]){
   const owned=await rpc('discovery_document_owned',actor.token,{p_listing:listingId});
   assert.equal(owned.status,200,'document owner helper HTTP '+actor.id);
   assert.equal(owned.data,expected,'document ownership helper must follow JWT, not claimed argument');
  }
  const adminStatus=await rpc('discovery_is_superadmin',adminActor.token);
  const buyerStatus=await rpc('discovery_is_superadmin',buyer.token);
  assert.equal(adminStatus.status,200);
  assert.equal(adminStatus.data,true,'real Admin must be recognized from platform_admins');
  assert.equal(buyerStatus.status,200);
  assert.equal(buyerStatus.data,false,'buyer cannot become superadmin using browser RPC');
  const deniedAdmin=await rpc('discovery_admin_readiness',buyer.token);
  assert.equal(deniedAdmin.status,403,'non-admin must fail before reading discovery diagnostics');
  assert.equal(deniedAdmin.data?.code,'42501');
  const ready=await rpc('discovery_admin_readiness',adminActor.token);
  assert.equal(ready.status,200,'real superadmin must use the same privileged readiness RPC');
  assert.equal(ready.data?.source,'discovery_admin_readiness_v1');
  const deniedQueue=await rpc('discovery_admin_review_queue',outsider.token,{p_limit:10});
  assert.equal(deniedQueue.status,403,'outsider cannot query unpublished review queue');
  assert.equal(deniedQueue.data?.code,'42501');
  const actualQueue=await rpc('discovery_admin_review_queue',adminActor.token,{p_limit:10});
  assert.equal(actualQueue.status,200);
  assert.ok(Array.isArray(actualQueue.data),'Admin review queue must return a collection');

  const rider=await rpc('mobility_snapshot',buyer.token,{p_request_id:requestId});
  const driver=await rpc('mobility_snapshot',owner.token,{p_request_id:requestId});
  const stranger=await rpc('mobility_snapshot',outsider.token,{p_request_id:requestId});
  const evenAdmin=await rpc('mobility_snapshot',adminActor.token,{p_request_id:requestId});
  for(const [who,result] of [['rider',rider],['driver',driver]]){
   assert.equal(result.status,200,who+' snapshot HTTP');
   assert.equal(result.data?.id,requestId,who+' must see own request');
   assert.equal(result.data.position,null,'driver never consented to publish coordinates');
  }
  for(const [who,result] of [['third-party',stranger],['Admin',evenAdmin]]){
   assert.equal(result.status,200,who+' scoped snapshot RPC');
   assert.equal(result.data,null,who+' cannot retrieve a ride just by knowing its UUID');
  }
  for(const [actor,allowed] of [[buyer,true],[owner,true],[outsider,false],[adminActor,false]]){
   const ownRequests=await rpc('mobility_my_requests',actor.token);
   assert.equal(ownRequests.status,200,'mobility_my_requests HTTP '+actor.id);
   assert.equal(ownRequests.data?.some(x=>x.id===requestId),allowed,
    'mobility list must include only rider and driver');
  }
  const strangerAccept=await rpc('mobility_transition',outsider.token,
   {p_request_id:requestId,p_action:'accept'});
  assert.equal(strangerAccept.status,403,'unrelated user may not accept someone else\'s ride');
  assert.equal(strangerAccept.data?.code,'42501');
  const strangerGps=await rpc('mobility_publish_position',outsider.token,
   {p_request_id:requestId,p_latitude:-30.333,p_longitude:-54.321,p_accuracy_m:15});
  assert.equal(strangerGps.status,403,'unrelated user may not publish someone else\'s GPS');
  assert.equal(strangerGps.data?.code,'42501');
  const unpublished=await rpc('mobility_create_request',outsider.token,
   {p_listing_id:listingId,p_service:'moto',p_origin_area:'Centro sintético',p_destination_area:'Zona sintética'});
  assert.equal(unpublished.status,403,'even verified user cannot book an unpublished professional');
  assert.equal(unpublished.data?.code,'42501');
  assert.equal(sql("SELECT status FROM public.mobility_requests WHERE id="+q(requestId)+"::uuid"),
   'requested','forged mobility actions cannot mutate the request');
  assert.equal(sql("SELECT count(*) FROM public.mobility_live_positions WHERE request_id="+q(requestId)+"::uuid"),
   '0','forged GPS calls cannot create an unauthorized position');
  console.log('PASS: verified Auth JWTs isolate discovery SECDEF helpers, admin queues and mobility snapshots/actions between owner, rider, outsider and superadmin.');
 } finally {
  // Local synthetic fixture ONLY. Child tables are cleared before parent.
  sql("DELETE FROM public.mobility_requests WHERE id="+q(requestId)+"::uuid;");
  sql("DELETE FROM public.discovery_listings WHERE id="+q(listingId)+"::uuid;");
 }
 assert.equal(sql("SELECT count(*) FROM public.mobility_requests WHERE id="+q(requestId)+"::uuid"),'0');
}
