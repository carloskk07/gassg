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
   transitions.push(args);const item=records.find(r=>r.id===args.p_listing_id);
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
assert.match(ctx.discoveryOwnerPhotoUrl(filePath),/tamao-discovery-photos/);
assert.equal(ctx.discoveryOwnerPhotoUrl('https://evil.test/track.jpg'),'');
assert.equal(ctx.discoveryOwnerPhotoUrl('../../secret'),'');
assert.match(ctx.discoveryOwnerCitySlug('São Gabriel'),/sao-gabriel/);
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
await ctx.discoveryOwnerSubmit(id);
assert.equal(transitions[0].p_next_status,'review');
assert.equal(records[0].status,'review');
records[0].status='paused';
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
