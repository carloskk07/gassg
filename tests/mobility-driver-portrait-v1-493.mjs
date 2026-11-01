import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const mobSrc=read('js/mobility.js');
const ownSrc=read('js/discovery-owner.js');
const pubSrc=read('js/discovery.js');
const userId='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
const listingId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rideId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const imageId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const validKey=userId+'/'+imageId+'.jpg';
const future=()=>new Date(Date.now()+120000).toISOString();
const published={id:listingId,vertical:'professionals',occupation:'Mototáxi',
 photo_urls:[validKey],title:'Mototáxi da região'};
const client={
 rpc:async(name,args)=>{
  if(name==='discovery_public_search'){
   assert.equal(args.p_listing_id,listingId);
   return {data:[published],error:null};
  }
  if(name==='mobility_my_requests')return {data:[{
   id:rideId,role:'rider',status:'accepted',service:'moto',
   expires_at:future(),origin:'Centro',destination:'Bairro'
  }],error:null};
  if(name==='mobility_snapshot')return {data:{
   id:rideId,role:'rider',status:'accepted',service:'moto',
   listing_title:'Mototáxi da região',expires_at:future(),
   origin:'Centro',destination:'Bairro',position:null
  },error:null};
  throw Error('Unexpected RPC '+name);
 },
 from(name){
  assert.equal(name,'mobility_requests','lookup must be participant-RLS scoped');
  return {select(columns){assert.equal(columns,'listing_id');
   return {eq(column,value){assert.equal(column,'id');assert.equal(value,rideId);
    return {maybeSingle:async()=>({data:{listing_id:listingId},error:null})};
   }};
  }};
 }
};
const ctx={console,URL,URLSearchParams,Date,FormData,CHAMA_BACKEND:{
 url:'https://example.supabase.co',publishableKey:'test'},
 location:{origin:'https://tamao.com.br',pathname:'/',hash:'#mobility',
  search:'?corrida='+listingId+'&modalidade=moto'},
 document:{visibilityState:'visible',querySelector:()=>null,createElement:()=>({}),
  getElementById:()=>null,head:{appendChild(){}},addEventListener:()=>{}},
 route:()=> 'mobility',shell:x=>x,esc:x=>String(x??'').replace(/</g,'&lt;'),
 render:()=>{},navigator:{},setInterval:()=>1,clearInterval:()=>{},
 isSecureContext:true,addEventListener:()=>{}};
ctx.globalThis=ctx;
vm.runInNewContext(mobSrc+';this.state=mobilityRuntime;',ctx);
const s=ctx.state;s.phase='ready';s.client=client;s.user={id:userId};s.id='';
assert.equal(ctx.mobilityPortraitUrl('https://evil.example/pic.jpg'),'');
assert.equal(ctx.mobilityPortraitUrl('../'+validKey),'');
assert.match(ctx.mobilityPortraitUrl(validKey),/^https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/tamao-discovery-photos\//);
assert.equal(ctx.mobilityTransportPhotoRow({...published,photo_urls:['https://evil.example/tracker']},listingId,'moto'),'');
assert.equal(ctx.mobilityTransportPhotoRow({...published,occupation:'Eletricista'},listingId,'moto'),'');
assert.equal(ctx.mobilityTransportPhotoRow({...published,id:otherId},listingId,'moto'),'');
assert.equal(ctx.mobilityTransportPhotoRow(published,listingId,'carro'),'');
assert.equal(ctx.mobilityTransportPhotoRow(published,listingId,'moto'),validKey);
assert.equal(await ctx.mobilityPublicPortrait(listingId,'moto'),validKey);
await ctx.mobilityLoadIntentPortrait({id:listingId,mode:'moto'});
assert.equal(s.intentPortraitKey,validKey);
assert.equal(s.intentPortraitMode,'moto');
assert.match(ctx.mobilityPage(),/Foto de rosto enviada pelo motorista/);
assert.match(ctx.mobilityPage(),/A foto não comprova identidade/);
// A pasted car link using the SAME motorbike listing may never reuse its
// motorcycle portrait under the car label, even without a page reload.
ctx.location.search='?corrida='+listingId+'&modalidade=carro';
ctx.mobilityAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(s.intentPortraitMode,'carro');
assert.equal(s.intentPortraitKey,'');
assert.doesNotMatch(ctx.mobilityPage(),/Foto de rosto enviada pelo motorista/);
ctx.location.search='?corrida='+listingId+'&modalidade=moto';
await ctx.mobilityLoadIntentPortrait({id:listingId,mode:'moto'});
assert.equal(s.intentPortraitKey,validKey);
s.id=rideId;
await ctx.mobilityRefresh();
assert.equal(s.selectedPortraitId,rideId);
assert.equal(s.selectedPortraitKey,validKey);
assert.match(ctx.mobilityDetailPanel(s.detail),/Foto de rosto enviada pelo motorista/);
assert.doesNotMatch(ctx.mobilityDetailPanel({...s.detail,role:'driver'}),/Foto de rosto enviada pelo motorista/);
// Replacing the account purges portrait and trip information.
ctx.mobilityClearSession();
assert.equal(s.selectedPortraitKey,'');
assert.equal(s.intentPortraitKey,'');
assert.equal(s.detail,null);
// A delayed public lookup must never update a new account with the old photo.
let release;
client.rpc=async(name,args)=>{
 if(name==='discovery_public_search')
  return new Promise(resolve=>{release=resolve});
 return {data:[],error:null};
};
s.user={id:userId};s.id=rideId;s.client=client;
const late=ctx.mobilityLoadSelectedPortrait(rideId,'moto',()=>true);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(typeof release,'function');
ctx.mobilityClearSession();s.user={id:otherId};s.id='';
release({data:[published],error:null});
assert.equal(await late,false);
assert.equal(s.selectedPortraitKey,'');
// Actual registration: a selected driver portrait must precede gallery photos
// even when an older approved draft has other photos.
const begin=ownSrc.indexOf('async function discoveryOwnerSave(');
const end=ownSrc.indexOf('// First unlink an editable photo',begin);
assert.ok(begin>=0&&end>begin);
const formFields={occupation:'Mototáxi',title:'Motorista da cidade',description:'Atendo minha região',
 state_code:'RS',city_name:'São Gabriel',public_area:'Centro',
 whatsapp_e164:'+5555999999999',service_area:'São Gabriel'};
const oldPhoto=userId+'/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg';
const uploaded=[],writes=[];
const ownerClient={
 from(table){
  if(table==='discovery_professional_details')
   return {upsert:async()=>({error:null})};
  assert.equal(table,'discovery_listings');
  return {update(data){
   return {eq:async()=>{
    writes.push(data);
    return {error:null};
   }};
  }};
 },
 storage:{from(bucket){assert.equal(bucket,'tamao-discovery-photos');
  return {upload:async(key,file)=>{
   uploaded.push({key,file});
   return {error:null};
  }};
 }}
};
const portraitFile={type:'image/jpeg',size:2048};
const galleryFile={type:'image/png',size:1024};
let portraitFiles=[portraitFile],galleryFiles=[galleryFile];
let renderCount=0;
const state={user:{id:userId},client:ownerClient,editor:{id:listingId,vertical:'professionals',
 photo_urls:[oldPhoto]},busy:false,items:[],error:'',notice:''};
const ownerCtx={
 console,Date,FormData:class{constructor(){ } get(key){return formFields[key]??null}},
 document:{getElementById:id=>id==='discovery-owner-photos'?{files:galleryFiles}:
  id==='discovery-owner-driver-portrait'?{files:portraitFiles}:
  id==='discovery-owner-documents'?{files:[]}:null},
 discoveryOwner:state,discoveryOwnerTables:{professionals:'discovery_professional_details'},render:()=>renderCount++,
 discoveryOwnerRoute:()=>true,discoveryOwnerCitySlug:()=> 'sao-gabriel',
 discoveryOwnerDetails:()=>({occupation:'Mototáxi'}),
 discoveryOwnerRefresh:async()=>{},discoveryOwnerError:e=>String(e),
 crypto:{randomUUID:()=>imageId}
};
const isolated=ownSrc.slice(begin,end);
vm.runInNewContext(isolated+';this.save=discoveryOwnerSave;',ownerCtx);
const form={checkValidity:()=>true};
await ownerCtx.save({preventDefault(){},target:form,
 submitter:{name:'finish',value:'draft'}});
assert.equal(uploaded.length,2);
assert.equal(uploaded[0].file,portraitFile,'driver headshot uploaded first');
assert.equal(uploaded[1].file,galleryFile);
const persisted=writes.find(x=>Array.isArray(x.photo_urls))?.photo_urls;
assert.ok(persisted,'photo paths must be persisted');
assert.equal(persisted[0],uploaded[0].key,'driver headshot is the main public photo');
assert.equal(persisted[1],oldPhoto,'previous gallery images remain');
assert.equal(persisted[2],uploaded[1].key);
state.editor={id:listingId,vertical:'professionals',photo_urls:[]};
portraitFiles=[];galleryFiles=[galleryFile];uploaded.length=0;writes.length=0;
await ownerCtx.save({preventDefault(){},target:form,
 submitter:{name:'finish',value:'review'}});
assert.match(state.error,/foto de rosto/);
assert.equal(writes.length,0,'new driver cannot request review with generic-only photos');
// Before request, the public gallery labels the portrait without pretending
// that a user-supplied photo constitutes verified identity.
assert.match(pubSrc,/Foto do motorista fornecida pelo anunciante/);
assert.match(pubSrc,/foto, sozinha, não comprova a identidade/);
assert.match(ownSrc,/id="discovery-owner-driver-portrait"/);
assert.match(read('.github/workflows/audit.yml'),
 /node tests\/mobility-driver-portrait-v1-493\.mjs/);
console.log('PASS: driver photo-first upload and review gate, moderated public display, RLS lookup and session isolation');
