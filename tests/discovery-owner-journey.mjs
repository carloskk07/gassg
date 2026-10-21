import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/discovery-owner.js');
assert.doesNotThrow(()=>new vm.Script(source,{filename:'discovery-owner.js'}));
const esc=x=>String(x??'').replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[k]));
const userId='00000000-0000-0000-0000-000000000011';
const filePath=userId+'/11111111-1111-1111-1111-111111111111.jpg';
let generatedUUIDs=0;
const testUUID=()=>{
 generatedUUIDs++;
 return generatedUUIDs<=2?'11111111-1111-1111-1111-111111111111':
   '99999999-9999-9999-9999-'+String(generatedUUIDs).padStart(12,'0');
};
const writes=[],uploads=[],removed=[],transitions=[],records=[],privateDocs=[];
let currentRoute='advertise', user={id:userId,email:'anunciante@example.test'},renderCount=0;
let simulateRemovalOutage=false,simulateRegistrationFailure=false,simulatePhotoWriteFailure=false;
let simulatePhotoUnlinkDenied=false,simulateConcurrentPhotoChange=false,simulateAfterRpcChange=false;
let simulateReviewFailure=false;
const concurrentPhotoKey=userId+'/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg';
const afterRpcPhotoKey=userId+'/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg';
let formValues={vertical:'professionals',title:'Serviços elétricos e manutenção',
  description:'Atendo residências e estabelecimentos com orçamento transparente.',
  state_code:'RS',city_name:'São Gabriel',public_area:'Centro',
  whatsapp_e164:'+5555999999999',occupation:'Eletricista',
  service_area:'São Gabriel e arredores',years_experience:'10'};
let selectedFiles=[{type:'image/jpeg',size:1500}];
let selectedDocuments=[{type:'application/pdf',size:2000}];
let loginUrl='';
const localValues=new Map();
const localStorage={
 getItem:key=>localValues.get(key)||null,
 setItem:(key,value)=>localValues.set(key,value),
 removeItem:key=>localValues.delete(key)
};
class FakeFormData{get(k){return formValues[k]??null;}}
const client={
 auth:{
  getUser:async()=>({data:{user}}),
  signInWithOtp:async args=>{loginUrl=args.options.emailRedirectTo;return {error:null};},
  signOut:async()=>{user=null;return {error:null}}
 },
 rpc:async(name,args)=>{
  if(name==='discovery_my_listings'){
   if(simulateAfterRpcChange&&records[0]){
    records[0].photo_urls.push(afterRpcPhotoKey);
    simulateAfterRpcChange=false;
   }
   return {data:records,error:null};
  }
  if(name==='discovery_unlink_listing_photo'){
   const entry=records.find(r=>r.id===args.p_listing_id);
   if(simulatePhotoUnlinkDenied)return {data:null,error:{code:'42501',message:'OWNER_DRAFT_REQUIRED'}};
   if(!entry||!['draft','rejected'].includes(entry.status)||
      !entry.photo_urls.includes(args.p_photo_path))
     return {data:null,error:{code:'22023',message:'PHOTO_NOT_IN_DRAFT'}};
   if(simulateConcurrentPhotoChange){
    entry.photo_urls.push(concurrentPhotoKey);
    simulateConcurrentPhotoChange=false;
   }
   entry.photo_urls=entry.photo_urls.filter(path=>path!==args.p_photo_path);
   return {data:entry.photo_urls.slice(),error:null};
  }
  if(name==='discovery_transition_listing'){
   transitions.push(args);
   if(simulateReviewFailure&&args.p_next_status==='review')
     return {data:null,error:{code:'22023',message:'REAL_PHOTO_REQUIRED'}};
   const item=records.find(r=>r.id===args.p_listing_id);
   if(item)item.status=args.p_next_status;
   return {data:args.p_next_status,error:null};
  }
  throw Error('unexpected rpc '+name);
 },
 from(name){return {
  insert(data){
   if(name==='discovery_documents'){
    if(simulateRegistrationFailure)return Promise.resolve({error:new Error('DB unavailable')});
    writes.push([name,'insert',data]);
    privateDocs.push({...data,id:'33333333-3333-3333-3333-333333333333'});
    return Promise.resolve({error:null});
   }
   return {
   select(column){assert.equal(column,'id');return {single:async()=>{
    writes.push([name,'insert',data]);
    const id='22222222-2222-2222-2222-222222222222';
    records.push({id,status:'draft',...data,photo_urls:[]});
    return {data:{id},error:null};
   }};}
  };},
  delete(){assert.equal(name,'discovery_documents');const filter={};
   const q={eq(k,v){filter[k]=v;return q;},async select(){
    const i=privateDocs.findIndex(d=>d.id===filter.id&&d.listing_id===filter.listing_id);
    return {data:i>=0?[privateDocs.splice(i,1)[0]]:[],error:null};
   }};return q;
  },
  upsert:async (data,config)=>{writes.push([name,'upsert',data,config]);return {error:null};},
  update(data){return {eq:async (key,id)=>{
    if(name==='discovery_listings'&&data.photo_urls&&simulatePhotoWriteFailure)
      return {error:new Error('Writing photos failed')};
    if(name==='discovery_listings'&&data.photo_urls&&simulatePhotoUnlinkDenied)
      return {error:null};
    writes.push([name,'update',data,key,id]);
    const item=records.find(r=>r.id===id);if(item)Object.assign(item,data);
    return {error:null};
  }};},
  select(_columns){return {eq(_key,_id){return {
   data:name==='discovery_documents'?privateDocs.filter(d=>d.listing_id===_id):[],
   error:null,maybeSingle:async()=>({data:{occupation:'Eletricista',service_area:'São Gabriel'},error:null})
  };}};}
 };},
 storage:{from(bucket){assert.ok(['tamao-discovery-photos','tamao-discovery-documents'].includes(bucket));return{
  upload:async(key,file,opts)=>{uploads.push({bucket,key,file,opts});return {data:{path:key},error:null};},
  remove:async(paths)=>{
   if(simulateRemovalOutage)return {data:null,error:new Error('Network unavailable')};
   removed.push(...paths);return {data:paths,error:null};}
 };}}
};
const ctx={
 route:()=>currentRoute,
 shell:s=>s,esc,CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'},
 chamaFetch:async()=>({}), render:()=>{renderCount++;},
 location:{origin:'https://tamao.com.br',pathname:'/'},
 // vm contexts do not inherit Node's URL globals: supply real browser APIs.
 URL,URLSearchParams,
 crypto:{randomUUID:testUUID},
 document:{getElementById:id=>id==='discovery-owner-photos'?{files:selectedFiles}:
   id==='discovery-owner-documents'?{files:selectedDocuments}:null},
 FormData:FakeFormData,loadSupabaseBrowser:async()=>({createClient:()=>client}),
 console,localStorage
};
ctx.globalThis=ctx;
vm.runInNewContext(source+'\n;globalThis.__discoveryOwnerTestState=discoveryOwner;',ctx,{filename:'js/discovery-owner.js'});
assert.equal(ctx.discoveryOwnerRoute(),true);
ctx.discoveryOwnerAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.ok(renderCount>0,'auth bootstrap must re-render');
let html=ctx.discoveryOwnerPage();
assert.match(html,/Meus anúncios/);
assert.match(html,/id="discovery-owner-form"/);
assert.match(html,/Profissionais/);
assert.match(html,/Caronas/);
assert.match(html,/Hospedagens/);
assert.match(html,/Salvar e enviar para análise/);
assert.match(html,/Somente salvar rascunho/);
assert.match(html,/Mototáxi/);
assert.match(html,/Motorista de carro/);
assert.match(html,/Frete e mudança/);
const oldQuerySelector=ctx.document.querySelector;
const suggestedOccupation={value:'',focus(){}};
ctx.document.querySelector=selector=>selector==='#discovery-owner-form [name="occupation"]'?suggestedOccupation:null;
assert.equal(ctx.discoveryOwnerSuggestOccupation('Mototáxi'),true);
assert.equal(suggestedOccupation.value,'Mototáxi');
assert.equal(ctx.discoveryOwnerSuggestOccupation('Mototáxi<script>'),false);
assert.equal(suggestedOccupation.value,'Mototáxi');
ctx.document.querySelector=oldQuerySelector;
assert.match(ctx.discoveryOwnerPhotoUrl(filePath),/tamao-discovery-photos/);
assert.equal(ctx.discoveryOwnerPhotoUrl('https://evil.test/track.jpg'),'');
assert.equal(ctx.discoveryOwnerPhotoUrl('../../secret'),'');
assert.match(ctx.discoveryOwnerCitySlug('São Gabriel'),/sao-gabriel/);
const rideFields=ctx.discoveryOwnerTypeFields('rides',{});
assert.match(rideFields,/name="route_notes"/);
assert.match(rideFields,/paradas/i);
const stayFields=ctx.discoveryOwnerTypeFields('stays',{});
assert.match(stayFields,/name="amenities"/);
assert.match(stayFields,/name="price_unit"/);
assert.match(stayFields,/name="units"/);
// Owner-authorized source import: the URL identifies a platform, it does NOT
// authorize network scraping, photo copying or an unreviewed publication.
assert.equal(ctx.discoveryOwnerImportSource('http://www.booking.com/hotel/br/casa-do-sol.html'),null);
assert.equal(ctx.discoveryOwnerImportSource('https://www.booking.com.evil.test/hotel/br/casa-do-sol.html'),null);
assert.equal(ctx.discoveryOwnerImportSource('https://user:pass@www.booking.com/hotel/br/casa-do-sol.html'),null);
assert.equal(ctx.discoveryOwnerImportSource('https://www.booking.com:444/hotel/br/casa-do-sol.html'),null);
assert.equal(ctx.discoveryOwnerImportSource('https://example.com/hotel/br/casa-do-sol.html'),null);
assert.equal(ctx.discoveryOwnerImportSource('https://airbnb.com/rooms/nope'),null);
const sourceBooking=ctx.discoveryOwnerImportSource('https://www.booking.com/hotel/br/pousada-do-centro.pt-br.html?aid=123');
assert.equal(sourceBooking?.provider,'Booking.com');
assert.equal(sourceBooking?.proposedTitle,'pousada do centro');
const sourceAirbnb=ctx.discoveryOwnerImportSource('https://www.airbnb.com/rooms/12345678?check_in=2026-12-01');
assert.equal(sourceAirbnb?.provider,'Airbnb');
assert.equal(sourceAirbnb?.proposedTitle,'');
const copiedFields=[
 'Título: Pousada do Centro','Descrição: Quartos confortáveis no centro com wi-fi e estacionamento.',
 'Cidade: São Gabriel','Hóspedes: 4','Quartos: 2','Camas: 3',
 'Comodidades: Wi-Fi, Estacionamento','Preço: R$ 289,50'
].join('\n');
const parsedImport=ctx.discoveryOwnerImportPayload(copiedFields);
assert.equal(parsedImport.title,'Pousada do Centro');
assert.equal(parsedImport.description,'Quartos confortáveis no centro com wi-fi e estacionamento.');
assert.equal(parsedImport.city_name,'São Gabriel');
assert.equal(parsedImport.guests,4);
assert.equal(parsedImport.bedrooms,2);
assert.equal(parsedImport.beds,3);
assert.equal(parsedImport.price_from,'289.50');
assert.equal(JSON.stringify(parsedImport.amenities),'["Wi-Fi","Estacionamento"]');
const fromJson=ctx.discoveryOwnerImportPayload(JSON.stringify({
 title:'Chalé para descansar',description:'Hospedagem com cozinha e vista para a região.',
 city:'Bagé',guests:2,beds:1,price_from:'1.250,40',
 amenities:['Wi-Fi','Cozinha'],property_type:'cabin',
 owner_id:'not-owner',status:'published',whatsapp_e164:'+123',photo_urls:['https://evil']
}));
assert.equal(fromJson.city_name,'Bagé');
assert.equal(fromJson.price_from,'1250.40');
assert.equal(fromJson.property_type,'cabin');
for(const bad of ['owner_id','status','whatsapp_e164','photo_urls']){
 assert.equal(Object.hasOwn(fromJson,bad),false,'never import privileged field '+bad);
}
assert.equal(ctx.discoveryOwnerImportPayload('{invalid json').title,undefined);
assert.equal(ctx.discoveryOwnerImportPayload('Título: Hotel sem capacidade\nHóspedes: 999').guests,undefined);
// The public form should be prefilled in the existing draft editor, never
// stored or submitted merely because a third-party URL was recognized.
ctx.discoveryOwnerTypeChanged('stays');
assert.match(ctx.discoveryOwnerPage(),/Aproveitar informações no cadastro/);
const originalLookup=ctx.document.getElementById;
ctx.document.getElementById=id=>({
 'discovery-owner-import-link':{value:'https://www.airbnb.com/rooms/12345678'},
 'discovery-owner-import-details':{value:copiedFields},
 'discovery-owner-form':{checkValidity:()=>true}
})[id]||originalLookup(id);
assert.equal(ctx.discoveryOwnerImportStay(),true);
assert.equal(ctx.__discoveryOwnerTestState.editor.title,'Pousada do Centro');
assert.equal(ctx.__discoveryOwnerTestState.editor.vertical,'stays');
assert.equal(ctx.__discoveryOwnerTestState.editor.whatsapp_e164,formValues.whatsapp_e164);
assert.equal(ctx.__discoveryOwnerTestState.editor.id,undefined);
assert.match(ctx.discoveryOwnerPage(),/Pousada do Centro/);
assert.match(ctx.discoveryOwnerPage(),/Nenhuma reserva ou disponibilidade foi sincronizada/);
assert.equal(writes.length,0,'assistive import must not write or publish');
ctx.document.getElementById=originalLookup;
ctx.discoveryOwnerNew();
ctx.discoveryOwnerTypeChanged('professionals');

// Offline owner file import: one CSV record, structured HTML JSON-LD and
// JSON. Nothing can fetch a third-party URL or create a listing automatically.
const csv='title;description;city_name;guests;bedrooms;beds;amenities;price_from\n'+
 '"Hotel do Lago";"Hospedagem com vista e quartos completos para famílias.";"São Gabriel";4;2;3;"Wi-Fi, Café";"320,50"';
const csvData=ctx.discoveryOwnerImportFileText('hotel.csv',csv);
assert.equal(ctx.discoveryOwnerImportPayload(csvData).title,'Hotel do Lago');
assert.equal(ctx.discoveryOwnerImportPayload(csvData).price_from,'320.50');
assert.equal(ctx.discoveryOwnerImportFileText('hotel.csv',csv+'\nfoo;bar'),null,
 'multi-row source requires explicit per-property confirmation');
assert.equal(ctx.discoveryOwnerImportFileText('hotel.exe',csv),null);
// A legitimate partial export may omit both title and provider link; importing
// this must keep the editor usable instead of dereferencing a null provider.
ctx.discoveryOwnerNew();
ctx.discoveryOwnerTypeChanged('stays');
const partialOffline=JSON.stringify({city_name:'São Gabriel',guests:2});
const partialLookup=ctx.document.getElementById;
ctx.document.getElementById=id=>({
 'discovery-owner-import-link':{value:''},
 'discovery-owner-import-details':{value:partialOffline},
 'discovery-owner-import-feedback':{textContent:''},
 'discovery-owner-form':{checkValidity:()=>true}
})[id]||partialLookup(id);
assert.equal(ctx.discoveryOwnerImportStay(),true,
 'title-less file data and no provider link must not crash');
assert.equal(ctx.__discoveryOwnerTestState.editor.guests,2);
assert.equal(ctx.__discoveryOwnerTestState.editor.city_name,'São Gabriel');
assert.equal(writes.length,0,'partial import must never create or publish records');
ctx.document.getElementById=partialLookup;
ctx.discoveryOwnerNew();
ctx.discoveryOwnerTypeChanged('stays');

assert.equal(ctx.discoveryOwnerImportFileText('hotel.html','<h1>Hotel</h1>'),null);
const htmlFile='<html><head><script type="application/ld+json">'+
 JSON.stringify({'@context':'https://schema.org','@type':'Hotel',
   name:'Hotel Estrela do Sul',description:'Hospedagem completa no centro da cidade com estacionamento.',
   address:{'@type':'PostalAddress',addressLocality:'São Gabriel',addressRegion:'RS'},
   occupancy:{'@type':'QuantitativeValue',value:6},numberOfBedrooms:3,numberOfBeds:4,
   amenityFeature:[{name:'Wi-Fi',value:true},{name:'Piscina',value:false}],
   offers:{price:'389.90',priceCurrency:'BRL'},image:'https://notimported.test/image.jpg',
   telephone:'+5555999999999'})+'</script></head></html>';
const htmlData=ctx.discoveryOwnerImportFileText('hotel.html',htmlFile);
const parsedHtml=ctx.discoveryOwnerImportPayload(htmlData);
assert.equal(parsedHtml.title,'Hotel Estrela do Sul');
assert.equal(parsedHtml.city_name,'São Gabriel');
assert.equal(parsedHtml.state_code,'RS');
assert.equal(parsedHtml.public_area,undefined,'state must not be confused with neighborhood');
assert.equal(parsedHtml.guests,6);
assert.equal(parsedHtml.bedrooms,3);
assert.equal(parsedHtml.beds,4);
assert.equal(parsedHtml.price_from,'389.90');
assert.equal(JSON.stringify(parsedHtml.amenities),'["Wi-Fi"]');
assert.equal(parsedHtml.property_type,'hotel');
assert.equal(Object.hasOwn(parsedHtml,'image'),false);
assert.equal(Object.hasOwn(parsedHtml,'telephone'),false);
const usdHtml=htmlFile.replace('"priceCurrency":"BRL"','"priceCurrency":"USD"');
assert.equal(ctx.discoveryOwnerImportPayload(ctx.discoveryOwnerImportFileText('hotel.html',usdHtml)).price_from,undefined);
assert.equal(ctx.discoveryOwnerImportFileText('hotel.html','<script type="application/ld+json">{"@type":"Article","name":"Fake listing"}</script>'),null);
const csvInput={value:'chosen',files:[{name:'hotel.csv',size:csv.length,text:async()=>csv}]};
const importStatus={textContent:''},importText={value:''};
const baseLookup=ctx.document.getElementById;
ctx.discoveryOwnerNew();
ctx.discoveryOwnerTypeChanged('stays');
assert.match(ctx.discoveryOwnerPage(),/arquivo exportado ou salvo/);
ctx.document.getElementById=id=>({
 'discovery-owner-import-link':{value:''},
 'discovery-owner-import-details':importText,
 'discovery-owner-import-feedback':importStatus,
 'discovery-owner-form':{checkValidity:()=>true},
})[id]||baseLookup(id);
assert.equal(await ctx.discoveryOwnerImportFile({target:csvInput}),true);
assert.equal(ctx.__discoveryOwnerTestState.editor.title,'Hotel do Lago');
assert.equal(ctx.__discoveryOwnerTestState.editor.guests,4);
assert.equal(csvInput.value,'');
assert.equal(ctx.__discoveryOwnerTestState.editor.state_code,'RS');
assert.equal(writes.length,0,'file import must not write records');
ctx.discoveryOwnerNew();
const unsafeInput={value:'chosen',files:[{name:'metadata.js',size:20,text:async()=>csv}]};
assert.equal(await ctx.discoveryOwnerImportFile({target:unsafeInput}),false);
assert.match(importStatus.textContent,/JSON, CSV, TXT ou HTML/);
assert.equal(writes.length,0,'rejected file must not write records');
ctx.document.getElementById=baseLookup;
ctx.discoveryOwnerNew();
ctx.discoveryOwnerTypeChanged('professionals');

const stayValues={property_type:'inn',guests:'4',bedrooms:'2',beds:'3',units:'2',
 price_from:'289.50',price_unit:'week',amenities:'Wi-Fi, Estacionamento, Wi-Fi'};
const stayDetails=ctx.discoveryOwnerDetails('stays',{get:key=>stayValues[key]||''});
assert.equal(stayDetails.price_unit,'week');
assert.equal(stayDetails.price_from_brl_cents,28950);
assert.equal(stayDetails.units,2);
assert.equal(JSON.stringify(stayDetails.amenities),'["Wi-Fi","Estacionamento"]');
const rideValues={departure_at:'2030-07-05T12:00',seats_total:'3',
 seats_available:'2',proposed_cost_share:'35.50',route_notes:'Parada acordada no centro'};
const rideDetails=ctx.discoveryOwnerDetails('rides',{get:key=>rideValues[key]||''});
assert.equal(rideDetails.proposed_cost_share_cents,3550);
assert.equal(rideDetails.route_notes,'Parada acordada no centro');

const form={checkValidity:()=>true};
await ctx.discoveryOwnerSave({preventDefault(){},target:form});
assert.ok(writes.some(w=>w[0]==='discovery_listings'&&w[1]==='insert'));
assert.ok(writes.some(w=>w[0]==='discovery_professional_details'&&w[1]==='upsert'));
assert.equal(uploads.length,2);
assert.equal(uploads[0].bucket,'tamao-discovery-documents');
assert.equal(uploads[0].key,userId+'/22222222-2222-2222-2222-222222222222/11111111-1111-1111-1111-111111111111.pdf');
assert.equal(uploads[1].bucket,'tamao-discovery-photos');
assert.equal(uploads[1].key,filePath);
assert.ok(writes.some(w=>w[0]==='discovery_documents'&&w[1]==='insert'&&w[2].object_path===uploads[0].key));
assert.equal(uploads[0].opts.upsert,false);
assert.equal(uploads[1].opts.upsert,false);
assert.ok(writes.some(w=>w[0]==='discovery_listings'&&w[1]==='update'&&w[2].photo_urls[0]===filePath));
const id=records[0].id;
assert.equal(ctx.discoveryOwnerPublishedLink(records[0]),'','a draft is never shared');
assert.equal(ctx.discoveryOwnerPublishedLink({id,vertical:'invalid',status:'published'}),'');
assert.equal(ctx.discoveryOwnerPublishedLink({id:'invalid',vertical:'rides',status:'published'}),'');
// One-click publishing journey: photos, private records and details are saved,
// but only the server RPC can move the draft into moderation, never published.
selectedFiles=[];selectedDocuments=[];
await ctx.discoveryOwnerOpen(id);
simulateReviewFailure=true;
await ctx.discoveryOwnerSave({
 preventDefault(){},target:form,submitter:{name:'finish',value:'review'}
});
assert.equal(records[0].status,'draft','server denial preserves draft');
assert.match(ctx.discoveryOwnerPage(),/Rascunho salvo, mas ainda não enviado/);
assert.doesNotMatch(ctx.discoveryOwnerPage(),/Anúncio salvo e enviado para análise/);
simulateReviewFailure=false;
await ctx.discoveryOwnerOpen(id);
await ctx.discoveryOwnerSave({
 preventDefault(){},target:form,submitter:{name:'finish',value:'review'}
});
assert.equal(records[0].status,'review','single click requests review, never publication');
assert.match(ctx.discoveryOwnerPage(),/Anúncio salvo e enviado para análise/);
assert.ok(transitions.some(t=>t.p_next_status==='review'&&t.p_reason==='Envio pelo anunciante após salvar'));
assert.equal(uploads.length,2,'reusing saved draft does not reupload previous files');
// Keep the legacy separated draft/review action usable.
records[0].status='draft';
await ctx.discoveryOwnerSubmit(id);
assert.equal(records[0].status,'review');
assert.doesNotMatch(ctx.discoveryOwnerPage(),/Compartilhar no WhatsApp/);
records[0].status='published';
const verifiedPublicLink='https://tamao.com.br/?listing='+id+'#professionals';
assert.equal(ctx.discoveryOwnerPublishedLink(records[0]),verifiedPublicLink);
assert.match(ctx.discoveryOwnerPage(),/Compartilhar no WhatsApp/);
assert.match(ctx.discoveryOwnerPage(),/Ver anúncio/);
assert.match(ctx.discoveryOwnerPage(),/https:\/\/wa\.me\/\?text=/);
records[0].status='paused';
assert.equal(ctx.discoveryOwnerPublishedLink(records[0]),'');
assert.doesNotMatch(ctx.discoveryOwnerPage(),/Compartilhar no WhatsApp/);
await ctx.discoveryOwnerOpen(id);
assert.equal(records[0].status,'draft','paused item must reopen into new reviewed draft before editing');
assert.ok(transitions.some(x=>x.p_next_status==='draft'));
assert.match(ctx.discoveryOwnerPage(),/Remover comprovante 1/);
assert.equal(privateDocs.length,1);
simulateRemovalOutage=true;
await ctx.discoveryOwnerRemoveDocument(privateDocs[0].id);
assert.equal(privateDocs.length,1,'network error must retain private metadata');
assert.equal(removed.length,0,'failed Storage removal cannot be recorded as successful');
assert.match(ctx.discoveryOwnerPage(),/Remover comprovante 1/);
simulateRemovalOutage=false;
await ctx.discoveryOwnerRemoveDocument(privateDocs[0].id);
assert.equal(privateDocs.length,0,'draft document metadata must be removed');
assert.equal(removed.length,1,'private bytes must be deleted via Storage API');
assert.equal(removed[0],uploads[0].key);
assert.doesNotMatch(ctx.discoveryOwnerPage(),/Remover comprovante 1/);

assert.doesNotMatch(ctx.discoveryOwnerPage(),/EXAMPLE_NONEXISTENT_WORD/);
selectedFiles=[{type:'text/html',size:100}];
ctx.discoveryOwnerNew();
await ctx.discoveryOwnerSave({preventDefault(){},target:form});
assert.match(ctx.discoveryOwnerPage(),/JPG, PNG ou WebP/);
assert.equal(uploads.length,2,'invalid photo must never reach Storage');
selectedFiles=[];
selectedDocuments=[{type:'text/html',size:120}];
await ctx.discoveryOwnerSave({preventDefault(){},target:form});
assert.equal(uploads.length,2,'invalid sensitive document must never reach Storage');
assert.match(ctx.discoveryOwnerPage(),/comprovantes PDF/);
assert.match(ctx.discoveryOwnerPage(),/Comprovantes para análise privada/);

// An upload without successful ledger insertion must be removed using
// Storage.remove(), not by touching storage.objects through SQL.
selectedFiles=[];
selectedDocuments=[{type:'application/pdf',size:2000}];
const beforeRegisterFailure=uploads.length, beforeCompensation=removed.length;
simulateRegistrationFailure=true;
ctx.discoveryOwnerNew();
await ctx.discoveryOwnerSave({preventDefault(){},target:form});
assert.equal(uploads.length,beforeRegisterFailure+1);
assert.equal(removed.length,beforeCompensation+1,'failed ledger insert must compensate Storage');
assert.equal(removed.at(-1),uploads.at(-1).key);
assert.equal(privateDocs.length,0,'failed document registration cannot become visible');
assert.match(ctx.discoveryOwnerPage(),/Não foi possível concluir a operação/);

// A second network failure during compensation must be explicit and must
// never falsely say that the file was deleted or the draft was saved.
const beforeCleanupOutage=removed.length;
simulateRemovalOutage=true;
await ctx.discoveryOwnerSave({preventDefault(){},target:form});
assert.equal(removed.length,beforeCleanupOutage);
assert.equal(privateDocs.length,0);
assert.match(ctx.discoveryOwnerPage(),/pode ter ficado pendente no armazenamento/);
simulateRemovalOutage=false;
simulateRegistrationFailure=false;

// Photos linked in a failed database write must be cleaned up by the
// Storage API. Never delete the already referenced original photo.
const beforeFailedPhoto=uploads.length, beforePhotoRemove=removed.length;
selectedDocuments=[];
selectedFiles=[{type:'image/jpeg',size:1234}];
simulatePhotoWriteFailure=true;
ctx.discoveryOwnerNew();
await ctx.discoveryOwnerSave({preventDefault(){},target:form});
assert.equal(uploads.length,beforeFailedPhoto+1);
assert.equal(removed.length,beforePhotoRemove+1);
assert.equal(removed.at(-1),uploads.at(-1).key);
assert.ok(uploads.at(-1).key.startsWith(userId+'/'));
assert.match(ctx.discoveryOwnerPage(),/Não foi possível concluir a operação/);
const originalPhoto=filePath;
assert.ok(records[0].photo_urls.includes(originalPhoto),'previously linked photo must be preserved');

// Explicit uncertainty on a second failure; never falsely claim photo cleanup.
simulateRemovalOutage=true;
await ctx.discoveryOwnerSave({preventDefault(){},target:form});
assert.equal(removed.length,beforePhotoRemove+1);
assert.match(ctx.discoveryOwnerPage(),/não foi possível confirmar a limpeza/);
simulateRemovalOutage=false;
simulatePhotoWriteFailure=false;

// Removing existing marketing images must first unlink the persisted DB
// reference atomically; a denied RPC may not remove Storage bytes.
await ctx.discoveryOwnerOpen(id);
assert.match(ctx.discoveryOwnerPage(),/Remover foto 1/);
const beforeUnlink=removed.length;
simulatePhotoUnlinkDenied=true;
await ctx.discoveryOwnerRemovePhoto(filePath);
assert.ok(records[0].photo_urls.includes(filePath),'denied RPC must retain photo reference');
assert.equal(removed.length,beforeUnlink,'no Storage deletion before confirmed DB unlink');
simulatePhotoUnlinkDenied=false;

// A Storage failure after DB unlink must be visible and offer a retry.
simulateRemovalOutage=true;
simulateConcurrentPhotoChange=true;
simulateAfterRpcChange=true;
await ctx.discoveryOwnerRemovePhoto(filePath);
assert.ok(!records[0].photo_urls.includes(filePath),'photo must first leave draft listing');
assert.ok(records[0].photo_urls.includes(concurrentPhotoKey),
 'atomic unlink must preserve a concurrent photo addition from another tab');
assert.ok(records[0].photo_urls.includes(afterRpcPhotoKey),
 'a second post-commit edit must not prevent safe cleanup of the unlinked target');
assert.equal(removed.length,beforeUnlink,'failed Storage removal must not claim success');
assert.match(ctx.discoveryOwnerPage(),/Repetir limpeza de 1 foto/);
assert.match(ctx.discoveryOwnerPage(),/ainda precisa ser removido/);
const recoveryKey='tamao-photo-cleanup-v1:'+userId;
assert.equal(JSON.parse(localValues.get(recoveryKey))[0],filePath,
 'failed Storage cleanup must persist only a public photo key per account');
localValues.set(recoveryKey,JSON.stringify([
 filePath,'../../invalid.jpg',
 '00000000-0000-0000-0000-000000000099/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg'
]));
assert.deepEqual(Array.from(ctx.discoveryOwnerReadPendingPhotoRemovals(userId)),[filePath],
 'restored local queue must reject malformed and other-account paths');
ctx.__discoveryOwnerTestState.pendingPhotoRemovals=[];
ctx.__discoveryOwnerTestState.pendingPhotoRemovals=
  ctx.discoveryOwnerReadPendingPhotoRemovals(userId);
assert.equal(ctx.__discoveryOwnerTestState.pendingPhotoRemovals.length,1,
 'refresh/returning owner can resume previously interrupted Storage removal');
simulateRemovalOutage=false;
await ctx.discoveryOwnerRetryPhotoCleanup();
assert.equal(removed.length,beforeUnlink+1);
assert.equal(removed.at(-1),filePath);
assert.equal(localValues.has(recoveryKey),false,
 'successful retry must remove persisted cleanup metadata');
assert.doesNotMatch(ctx.discoveryOwnerPage(),/Repetir limpeza de 1 foto/);
assert.match(ctx.discoveryOwnerPage(),/Remover foto 1/,
 'concurrently added photo must stay editable after unlink');
await ctx.discoveryOwnerLogout();
const loggedOut=ctx.discoveryOwnerPage();
assert.match(loggedOut,/Receber link de acesso/);
const emailForm={elements:{email:{value:'anunciante@example.test'}}};
await ctx.discoveryOwnerLogin({preventDefault(){},target:emailForm});
assert.equal(loginUrl,'https://tamao.com.br/?advertise=1',
 'OTP callback must preserve advertiser intent outside auth token fragment');
assert.equal(new URL(loginUrl).hash,'','OTP hash belongs to Supabase authentication');

// The server may return a token-only hash instead of #advertise.
// The existing real Supabase client consumes the callback before the
// application restores the route; mocks check navigation and no token leaks.
const savedLocation=ctx.location;
const savedRoute=ctx.route;
ctx.location={
  origin:'https://tamao.com.br',pathname:'/',search:'?advertise=1',
  hash:'#access_token=secret-callback-token',
  href:'https://tamao.com.br/?advertise=1#access_token=secret-callback-token'
};
ctx.route=()=>ctx.location.hash.replace(/^#/,'')||'home';
ctx.discoveryOwnerReturnPending=()=>new URLSearchParams(ctx.location.search).get('advertise')==='1';
ctx.history={replaceState(_state,_title,url){
  const resolved=new URL(url,'https://tamao.com.br');
  ctx.location.href=resolved.href;
  ctx.location.search=resolved.search;
  ctx.location.hash=resolved.hash;
}};
user={id:userId,email:'anunciante@example.test'};
ctx.__discoveryOwnerTestState.phase='idle';
const renderBeforeCallback=renderCount;
ctx.discoveryOwnerAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(ctx.location.href,'https://tamao.com.br/#advertise');
assert.ok(renderCount>renderBeforeCallback,'OTP recovery must render owner route');
assert.equal(ctx.__discoveryOwnerTestState.user?.id,userId);
assert.doesNotMatch(ctx.location.href,/access_token|advertise=1/,
 'the callback token and transient intent must leave browser URL');
// Invalid/expired sessions must return to the login form; they cannot be
// treated as authenticated advertisers solely because the query says 1.
user=null;
ctx.location.search='?advertise=1';
ctx.location.hash='#access_token=expired-secret';
ctx.location.href='https://tamao.com.br/?advertise=1#access_token=expired-secret';
ctx.__discoveryOwnerTestState.phase='idle';
ctx.discoveryOwnerAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(ctx.__discoveryOwnerTestState.user,null);
assert.match(ctx.discoveryOwnerPage(),/Receber link de acesso/);
assert.equal(ctx.location.href,'https://tamao.com.br/#advertise');

// If the lazy SDK is offline, keep the OTP fragment unconsumed and offer a
// retry. Do not discard the callback before auth has actually initialised.
const availableSdk=ctx.loadSupabaseBrowser;
ctx.loadSupabaseBrowser=async()=>{throw Error('offline SDK');};
ctx.location.search='?advertise=1';
ctx.location.hash='#access_token=retry-this-token';
ctx.location.href='https://tamao.com.br/?advertise=1#access_token=retry-this-token';
ctx.__discoveryOwnerTestState.phase='idle';
assert.match(ctx.discoveryOwnerPage(),/Preparando sua área de anúncios/,
 'do not render a Not Found screen while the auth fragment is present');
ctx.discoveryOwnerAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(ctx.__discoveryOwnerTestState.phase,'failed');
assert.match(ctx.discoveryOwnerPage(),/Tentar conectar novamente/);
assert.equal(ctx.location.href,
 'https://tamao.com.br/?advertise=1#access_token=retry-this-token',
 'SDK outage must not consume the unhandled authentication callback');
ctx.loadSupabaseBrowser=availableSdk;
ctx.discoveryOwnerRetryInit();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(ctx.__discoveryOwnerTestState.phase,'ready');
assert.equal(ctx.location.href,'https://tamao.com.br/#advertise',
 'retry consumes callback and clears token/temporary query on completion');
ctx.location=savedLocation;ctx.route=savedRoute;

const intentStart=read('js/bootstrap.js').indexOf('function discoveryOwnerReturnPending(){');
const intentEnd=read('js/bootstrap.js').indexOf('\nfunction discoveryOwnerLoadingPage(){',intentStart);
assert.ok(intentStart>=0&&intentEnd>intentStart);
function pendingIntent(search,admin=false,merchant=false,hash='#access_token=opaque'){
 const context=vm.createContext({
  location:{search,hash},URLSearchParams,
  globalThis:{adminPortalRequested:()=>admin,merchantPortalRequested:()=>merchant}
 });
 vm.runInContext(read('js/bootstrap.js').slice(intentStart,intentEnd)+';this.pending=discoveryOwnerReturnPending;',context);
 return context.pending();
}
assert.equal(pendingIntent('?advertise=1'),true);
assert.equal(pendingIntent('?advertise=0'),false);
assert.equal(pendingIntent('?advertise=1',true),false,'Admin portal cannot load owner');
assert.equal(pendingIntent('?advertise=1',false,true),false,'Merchant portal cannot load owner');
assert.match(read('js/bootstrap.js'),/route\(\)!=='advertise'&&!discoveryOwnerReturnPending\(\)/,
 'owner module must load despite OTP fragment replacing the route');
assert.match(read('js/bootstrap.js'),
 /const r=discoveryOwnerReturnPending\(\)\?'advertise':route\(\)/,
 'callback must show advertiser loading state, not an unrelated home/menu');

currentRoute='admin';
assert.equal(ctx.discoveryOwnerRoute(),false);
assert.equal(ctx.discoveryOwnerPage().includes('Não encontrado'),true);
const boot=read('js/bootstrap.js'),build=read('scripts/build-live-portals.mjs'),
  home=read('js/customer.js'),htmlOriginal=read('index.html'),sw=read('sw.js');
assert.match(boot,/advertise:typeof discoveryOwnerPage==='function'/);
assert.match(boot,/discoveryOwnerRequestModule/);
assert.match(boot,/discoveryOwnerAfterRender/);
assert.ok(home.includes("['advertise'"));
assert.ok(build.includes("fs.rmSync(path.join(target,'js','discovery-owner.js')"));
assert.ok(!htmlOriginal.includes('js/discovery-owner.js'));
assert.ok(!sw.includes('js/discovery-owner.js'));
assert.ok(read('css/discovery.css').includes('.discovery-owner-layout'));
console.log('PASS advertiser module: auth OTP, owner draft, image upload, review, validation, lazy route, isolated bundles.');
