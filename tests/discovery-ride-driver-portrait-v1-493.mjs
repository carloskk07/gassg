import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ownerSource=read('js/discovery-owner.js');
const publicSource=read('js/discovery.js');
const adminSource=read('js/admin.js');
const migration=read('supabase/migrations/20261101214800_discovery_ride_driver_public_portrait_v1_493.sql');
const uuid='11111111-1111-4111-8111-111111111111';
const listing='22222222-2222-4222-8222-222222222222';
const portraitId='33333333-3333-4333-8333-333333333333';
const galleryId='44444444-4444-4444-8444-444444444444';
const esc=x=>String(x??'').replaceAll('<','&lt;');
let files={portrait:[],gallery:[]},uploads=[],writes=[],transitions=[],rpcList=[],uuidCount=0;
const values={
 vertical:'rides',title:'Carona São Gabriel a Bagé',
 description:'Trajeto eventual a combinar diretamente com os passageiros.',
 state_code:'RS',city_name:'São Gabriel',whatsapp_e164:'+5555999999999',
 departure_state:'RS',departure_city:'São Gabriel',destination_state:'RS',
 destination_city:'Bagé',departure_at:'2030-11-02T16:00',
 seats_total:'3',seats_available:'3',proposed_cost_share:'20'
};
const stateClient={
 from(table){
  if(table==='discovery_listings')return {
   insert(data){writes.push(['insert',data]);return {select(col){
    assert.equal(col,'id');return {single:async()=>({data:{id:listing},error:null})};
   }};},
   update(data){writes.push(['update',data]);return {
    eq:async()=>({error:null})
   }}
  };
  assert.equal(table,'discovery_ride_details');
  return {upsert:async(data)=>{writes.push(['details',data]);return {error:null}}};
 },
 storage:{from(bucket){
  assert.equal(bucket,'tamao-discovery-photos');
  return {upload:async(key,file,opts)=>{uploads.push({key,file,opts});return {error:null}}};
 }},
 rpc:async(name,args)=>{
  rpcList.push(name);
  if(name==='discovery_my_listings')return {data:[],error:null};
  if(name==='discovery_transition_listing'){transitions.push(args);return {data:'review',error:null}}
  throw Error('Unexpected RPC '+name);
 }
};
const doc={getElementById(id){
 if(id==='discovery-owner-driver-portrait')return {files:files.portrait};
 if(id==='discovery-owner-photos')return {files:files.gallery};
 if(id==='discovery-owner-documents')return {files:[]};
 return null;
}};
const ownerCtx={
 console,Date,URL,URLSearchParams,document:doc,
 CHAMA_BACKEND:{url:'https://example.supabase.co'},
 location:{origin:'https://tamao.com.br',search:''},
 route:()=> 'advertise',shell:x=>x,esc,render:()=>{},
 crypto:{randomUUID:()=>++uuidCount===1?portraitId:galleryId},
 FormData:class{get(k){return values[k]??null;}},
};
ownerCtx.globalThis=ownerCtx;
vm.runInNewContext(ownerSource+';this.state=discoveryOwner;',ownerCtx);
const s=ownerCtx.state;s.user={id:uuid,email:'carona@example.invalid'};
s.client=stateClient;s.phase='ready';s.kind='rides';s.items=[];
assert.match(ownerCtx.discoveryOwnerPage(),/Foto do rosto do motorista da carona/);
assert.match(ownerCtx.discoveryOwnerPage(),/Fotos complementares da carona/);
const form={checkValidity:()=>true};
const submit=()=>ownerCtx.discoveryOwnerSave({preventDefault(){},
 target:form,submitter:{name:'finish',value:'review'}});
assert.equal(await submit(),false);
assert.match(s.error,/foto de rosto do motorista/);
assert.equal(writes.length,0,'photoless driver review cannot make ANY database writes');
const face={type:'image/jpeg',size:1200},car={type:'image/png',size:1800};
files={portrait:[face],gallery:[car]};
await submit();
assert.equal(uploads.length,2,'both approved-size images uploaded');
assert.equal(uploads[0].file,face);
assert.equal(uploads[1].file,car);
const first=uploads[0].key,second=uploads[1].key;
const saved=writes.find(x=>x[0]==='update'&&Array.isArray(x[1].photo_urls));
assert.ok(saved,'must associate uploads to listing');
assert.equal(saved[1].photo_urls[0],first,'face is public primary');
assert.equal(saved[1].photo_urls[1],second,'vehicle image follows face');
assert.equal(transitions.length,1);
assert.equal(transitions[0].p_next_status,'review');

const publicCtx={console,Date,URL,URLSearchParams,
 CHAMA_BACKEND:{url:'https://example.supabase.co'},
 route:()=> 'rides',shell:x=>x,esc,document:{getElementById:()=>null}};
publicCtx.globalThis=publicCtx;
vm.runInNewContext(publicSource,publicCtx);
const html=publicCtx.discoveryPublicGallery({
 vertical:'rides',title:'Carona de teste',photo_urls:[first,second]
});
assert.match(html,/Foto do motorista informada no anúncio/);
assert.match(html,/Foto do motorista fornecida pelo anunciante/);
assert.match(html,/não comprova a identidade/);
assert.match(html,/Ver mais 1 foto/);
assert.equal(publicCtx.discoveryPublicGallery({
 vertical:'rides',photo_urls:['https://evil.example/tracker.jpg']}),'');
assert.match(adminSource,/const driverPortraitReview=x\.vertical==='rides'/);
assert.match(adminSource,/Conferência obrigatória do motorista/);
assert.match(migration,/before update of status on public\.discovery_listings/);
assert.match(migration,/new\.status in \('review','published'\)/);
assert.match(migration,/public\.discovery_verified_photo_paths\(new\.id\)/);
assert.match(migration,/revoke all on function public\.discovery_ride_driver_photo_guard/);
assert.match(read('.github/workflows/audit.yml'),/node tests\/discovery-ride-driver-portrait-v1-493\.mjs/);
console.log('PASS: carona driver portrait first, approved-only public gallery, human Admin review and server publication guard');
