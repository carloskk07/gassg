import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const source=read('js/mobility.js');new vm.Script(source);
let watch=0,stop=0,called=[],signedOutListener=null,signOutCalls=0;
let noticePermissionCalls=0;const browserNotices=[];
function FakeNotification(title,options){browserNotices.push({title,options})}
FakeNotification.permission='default';
FakeNotification.requestPermission=async()=>{noticePermissionCalls++;FakeNotification.permission='granted';return 'granted'};
const driver={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const listing='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ctx={console,FormData,URL,URLSearchParams,Date,isSecureContext:true,Notification:FakeNotification,
 location:{search:'?corrida='+listing+'&modalidade=moto',origin:'https://tamao.com.br',pathname:'/',hash:'#mobility'},
 document:{visibilityState:'visible',addEventListener:(name,fn)=>{ctx.listener=fn},
  getElementById:()=>null,querySelector:()=>null,createElement:()=>({}),
  head:{appendChild(){}}},
 navigator:{geolocation:{watchPosition(){watch++;return 17},clearWatch(){stop++}}},
 route:()=> 'mobility',shell:x=>x,render(){},setInterval(){return 1},clearInterval(){},
 esc:x=>String(x??'').replace(/</g,'&lt;'),CHAMA_BACKEND:{url:'https://example.test',publishableKey:'anon'},
 chamaFetch(){},loadSupabaseBrowser:async()=>({createClient:()=>client})};
ctx.globalThis=ctx;
let holdStart=false,resolveHeldStart=null,failRefresh=false;
const client={auth:{
 getUser:async()=>({data:{user:driver},error:null}),
 signOut:async()=>{signOutCalls++;signedOutListener?.('SIGNED_OUT',null);return {error:null}},
 onAuthStateChange:(callback)=>{signedOutListener=callback;return {data:{subscription:{unsubscribe(){}}}};}
},rpc:async(name,args)=>{
 called.push([name,args]);
 if(failRefresh&&name==='mobility_my_requests')throw Error('simulated connectivity loss');
 if(name==='mobility_my_requests')return {data:[],error:null};
 if(name==='mobility_snapshot')return {data:null,error:null};
 if(name==='mobility_start_position'&&holdStart)
  return new Promise(resolve=>{resolveHeldStart=resolve});
 return {data:true,error:null};
}};
vm.runInNewContext(source+';this.state=mobilityRuntime;',ctx);
const s=ctx.state;
assert.equal(ctx.mobilityIntent().id,listing);
assert.match(ctx.mobilityPage(),/Preparando sua área segura/);
await ctx.mobilityInit();
assert.equal(s.phase,'ready');
assert.equal(s.user.id,driver.id);
assert.equal(typeof signedOutListener,'function',
 'The test must register real onAuthStateChange through mobilityInit');
assert.match(ctx.mobilityPage(),/Solicitar uma moto/);
assert.match(ctx.mobilityPage(),/Pedidos para motoristas: 0 aguardando resposta/);
assert.match(ctx.mobilityPage(),/Chamadas com aplicativo fechado dependem de inscrição/);
assert.match(ctx.mobilityPage(),/Ativar avisos com o aplicativo fechado/);
assert.equal(noticePermissionCalls,0,'Never ask OS permission without click');
assert.equal(await ctx.mobilityEnableAlerts(),true);
assert.equal(noticePermissionCalls,1);
assert.match(ctx.mobilityPage(),/Avisos opcionais ativados/);
const request={id:listing,role:'driver',status:'requested',
 expires_at:new Date(Date.now()+120000).toISOString(),
 origin:'Centro',destination:'Bairro Teste',position:{lat:-30.33,lon:-54.32}};
ctx.mobilityNotifyNewPending([request]);
assert.equal(browserNotices.length,1);
assert.equal(browserNotices[0].title,'Novo pedido de moto ou carro no TAMÃO');
assert.doesNotMatch(JSON.stringify(browserNotices),/Centro|Bairro|lat|lon|30\.33|54\.32/,
 'Notification content must not disclose places or GPS coordinates');
ctx.mobilityNotifyNewPending([request]);
assert.equal(browserNotices.length,1,'Same request cannot trigger duplicate alerts');
ctx.mobilityNotifyNewPending([]);
ctx.document.visibilityState='hidden';
ctx.mobilityNotifyNewPending([request]);
assert.equal(browserNotices.length,1,'No browser notification for backgrounded UI');
ctx.document.visibilityState='visible';ctx.mobilityNotifyNewPending([request]);
assert.equal(browserNotices.length,1,'A now-known request cannot trigger deferred alert');
ctx.mobilityNotifyNewPending([]);
s.items=[request];assert.match(ctx.mobilityPage(),/Pedidos para motoristas: 1 aguardando resposta/);
s.items=[];
assert.ok(read('js/legal.js').includes('function contactPage()'));
assert.ok(read('js/mobility.js').includes("Relatar problema com este atendimento"));
s.id=listing;
s.detail={id:listing,role:'rider',status:'en_route',origin:'Centro',destination:'Vila',
 position:{lat:-30.33,lon:-54.32,accuracy_m:30,updated_at:new Date().toISOString()}};
assert.match(ctx.mobilityPage(),/Mostrar o mapa do motorista/);
assert.match(ctx.mobilityPage(),/Relatar problema com este atendimento/);
assert.match(ctx.mobilityPage(),/Informe ao suporte o protocolo/);
assert.doesNotMatch(ctx.mobilityPage(),/<iframe/);
assert.equal(ctx.mobilityOpenMap(),true);
assert.match(ctx.mobilityPage(),/<iframe/);
const validPosition=s.detail.position;
assert.equal(ctx.mobilityFreshPosition(s.detail)!==null,true);
s.detail.position={...validPosition,updated_at:new Date(Date.now()-47000).toISOString()};
assert.equal(ctx.mobilityFreshPosition(s.detail),null,
 'Expired GPS is rejected locally even when offline');
assert.doesNotMatch(ctx.mobilityPage(),/<iframe/,
 'A stale location must never persist as an OSM iframe');
assert.equal(ctx.mobilityOpenMap(),false);
s.detail.position={...validPosition,updated_at:new Date(Date.now()+20000).toISOString()};
assert.equal(ctx.mobilityFreshPosition(s.detail),null,
 'Future timestamp outside clock-skew tolerance is not trustworthy');
s.detail.position=validPosition;
s.detail.position=null;assert.doesNotMatch(ctx.mobilityPage(),/<iframe/);
let deletedSrc=0,removedFrame=0;
const previousLookup=ctx.document.getElementById;
ctx.document.getElementById=id=>id==='mobility-map'?{
 removeAttribute(key){assert.equal(key,'src');deletedSrc++},remove(){removedFrame++}
}:null;
ctx.mobilityUpdateMap({position:null});
assert.equal(deletedSrc,1);
assert.equal(removedFrame,1,'revoked GPS must remove old third-party map iframe');
ctx.document.getElementById=previousLookup;
assert.equal(ctx.mobilityMapUrl({lat:null,lon:0}),'',
 'Null latitude cannot silently become 0°');
assert.equal(ctx.mobilityMapUrl({lat:'-30.3',lon:-54.3}),'',
 'Untrusted string coordinates cannot enter the map URL');
s.detail={id:listing,role:'rider',status:'en_route',origin:'Centro',destination:'Vila',
 position:{...validPosition,updated_at:new Date(Date.now()-50000).toISOString()}};
failRefresh=true;
await ctx.mobilityRefresh(true);
assert.equal(s.detail.position,null,'A silent failed refresh expires the stale local marker');
failRefresh=false;
s.detail={id:listing,role:'driver',status:'accepted',origin:'Centro',destination:'Vila'};
assert.equal(await ctx.mobilityStartTracking(),false);assert.equal(watch,0);
s.detail.status='en_route';
assert.equal(await ctx.mobilityStartTracking(),true);assert.equal(watch,1);
assert.ok(called.some(x=>x[0]==='mobility_start_position'));
ctx.document.visibilityState='hidden';ctx.listener();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(stop,1);assert.equal(s.watch,null);
assert.ok(called.some(x=>x[0]==='mobility_stop_position'));
// Simulate network completion AFTER the tab is hidden. It must never restart GPS.
ctx.document.visibilityState='visible';
holdStart=true;
const watchBefore=watch;
const inFlight=ctx.mobilityStartTracking();
await Promise.resolve();
assert.equal(s.gpsPending,true,'driver authorization is still in flight');
ctx.document.visibilityState='hidden';ctx.listener();
await Promise.resolve();
assert.equal(s.gpsPending,false,'hiding the tab revokes a pending GPS start');
assert.equal(typeof resolveHeldStart,'function');
holdStart=false;resolveHeldStart({data:true,error:null});
assert.equal(await inFlight,false,'a late successful opt-in must be invalidated');
assert.equal(watch,watchBefore,'no browser GPS watch is started after hiding the tab');
assert.equal(s.watch,null);
assert.ok(called.filter(x=>x[0]==='mobility_stop_position').length>=2,
 'late start must be compensated with a second server revocation');
s.detail.status='completed';ctx.document.visibilityState='visible';
assert.equal(await ctx.mobilityStartTracking(),false);
assert.equal(ctx.mobilityMapUrl({lat:91,lon:0}),'');
s.user=driver;s.items=[{id:listing,role:'rider'}];
s.detail={id:listing,role:'rider',status:'en_route',
 position:{...validPosition,updated_at:new Date().toISOString()}};
s.id=listing;
assert.match(ctx.mobilityPage(),/Sair e parar localização/);
assert.equal(await ctx.mobilityLogout(),true,'Manual exit succeeds');
assert.equal(signOutCalls,1);
assert.equal(s.user,null);
assert.deepEqual(Array.from(s.items),[]);
assert.equal(s.detail,null);
assert.equal(s.id,'');
assert.equal(s.mapConsent,false);
assert.equal(s.noticeOptIn,false,'A logged-out user never preserves notification opt-in');
assert.equal(s.pendingDriverIds,null,'An account switch clears previous request identifiers');
assert.doesNotMatch(ctx.mobilityPage(),/openstreetmap.org/);
s.user=driver;s.items=[{id:listing}];s.detail={id:listing,role:'rider',
 status:'en_route',position:validPosition};
signedOutListener('SIGNED_OUT',null);
assert.equal(s.user,null,'Cross-tab sign-out must clear owner identity');
assert.equal(s.detail,null,'Cross-tab sign-out must clear cached GPS');
assert.equal(s.items.length,0,'Cross-tab sign-out must clear trip list');
s.user=driver;s.items=[{id:listing}];s.detail={id:listing,role:'rider',
 status:'en_route',position:validPosition};
const another={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',email:'other@example.test'};
signedOutListener('SIGNED_IN',{user:another});
assert.equal(s.user.id,another.id,'User identity switches after auth event');
assert.equal(s.detail,null,'Switching accounts clears the other rider location');
assert.equal(s.items.length,0,'Switching accounts clears previous trip list');
ctx.location.search='?corrida=bad&modalidade=moto';assert.equal(ctx.mobilityIntent(),null);
const mobilityHome=read('js/customer.js'),mobilityNav=read('js/core.js');
assert.ok(mobilityHome.includes("'/?modalidade=moto#mobility'"),'Moto homepage opens mobility without a fake listing');
assert.ok(mobilityHome.includes("'/?modalidade=carro#mobility'"),'Carro homepage opens mobility without a fake listing');
assert.ok(!mobilityHome.includes("'/?servico=moto#professionals'"),
 'Homepage moto must not route to the generic professionals landing');
assert.ok(mobilityNav.includes("['mobility','Moto e carro']"),
 'The public navigation must keep the dedicated vehicle-request entry');
assert.ok(mobilityNav.includes('Minhas corridas</button>'));
s.phase='ready';s.user=null;s.id='';s.detail=null;s.items=[];
ctx.location.search='?modalidade=moto';
assert.equal(ctx.mobilityIntent(),null,'Mode-only link must not fabricate listing permission');
assert.match(ctx.mobilityPage(),/Encontrar mototaxista/);
assert.match(ctx.mobilityPage(),/Encontrar motorista/);
assert.ok(!ctx.mobilityPage().includes('onsubmit="return mobilityCreate(event)"'),
 'Without an authorized provider ID, no trip can be submitted');
ctx.location.search='?corrida='+listing+'&modalidade=moto';
assert.doesNotMatch(ctx.mobilityPage(),/Encontrar mototaxista/,
 'A chosen listing must preserve the direct authenticated journey');
assert.ok(read('js/bootstrap.js').includes('mobilityRequestModule()'));
assert.ok(read('js/bootstrap.js').includes('mobilityModuleError'));
assert.ok(read('js/bootstrap.js').includes('mobilityRetryModule()'));
assert.ok(read('js/bootstrap.js').includes("s.onerror=()=>{mobilityModuleError=true;render()}"),
 'a failed lazy script cannot trigger an infinite render/reload loop');
assert.ok(read('index.html').includes('frame-src https://challenges.cloudflare.com https://www.openstreetmap.org'));
assert.ok(read('js/discovery.js').includes('Solicitar e acompanhar no mapa'));
// A rider returning after closing the browser should automatically resume a
// server-authorized active request, not be asked to submit another trip.
ctx.location.search='?corrida='+listing+'&modalidade=moto';
const activeId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const activeRide={id:activeId,role:'rider',service:'moto',status:'requested',
 expires_at:new Date(Date.now()+600000).toISOString(),
 origin:'Centro',destination:'Bairro São Jorge',listing_title:'Mototáxi publicado'};
const originalRpc=client.rpc;
client.rpc=async (name,args)=>{
 if(name==='mobility_my_requests')return {data:[activeRide],error:null};
 if(name==='mobility_snapshot'){
  assert.equal(args.p_request_id,activeId);
  return {data:{...activeRide,position:null},error:null};
 }
 return originalRpc(name,args);
};
s.phase='ready';s.client=client;s.user=driver;s.id='';s.items=[];s.detail=null;
await ctx.mobilityRefresh();
assert.equal(s.id,activeId,'An active ride must be resumed after a page reload');
assert.equal(s.detail?.status,'requested');
assert.match(ctx.mobilityPage(),/Você já tem uma solicitação em andamento/);
assert.doesNotMatch(ctx.mobilityPage(),/onsubmit="return mobilityCreate\(event\)"/,
 'A current rider must not be offered duplicate trip submission');
assert.match(ctx.mobilityPage(),/Relatar problema com este atendimento/);
s.id='';s.items=[];s.detail=null;
client.rpc=async (name,args)=>{
 if(name==='mobility_my_requests')return {data:[{...activeRide,status:'expired'}],error:null};
 return originalRpc(name,args);
};
await ctx.mobilityRefresh();
assert.equal(s.id,'','Expired trips must not resurrect tracking');
assert.match(ctx.mobilityPage(),/onsubmit="return mobilityCreate\(event\)"/);
client.rpc=originalRpc;
assert.match(read('js/mobility.js'),/Sou mototaxista e quero anunciar/);
assert.match(read('js/mobility.js'),/Sou motorista e quero anunciar/);

const routeBeforeReport=ctx.route;
const domBeforeReport=ctx.document.getElementById;
s.user=driver;s.id=listing;s.detail={id:listing,role:'rider',status:'requested'};
ctx.location.hash='#mobility';
ctx.go=r=>{ctx.location.hash='#'+r};
ctx.route=()=>ctx.location.hash.slice(1);
assert.equal(ctx.mobilityReport('invalid'),false,'Invalid UUID cannot create support context');
assert.equal(s.reportId,'');
assert.equal(ctx.mobilityReport(listing),false,'Valid current ride opens official support');
assert.equal(ctx.location.hash,'#contact');
const supportKind={value:'general'},supportMessage={value:''};
ctx.document.getElementById=id=>({
 'public-request-kind':supportKind,'public-request-message':supportMessage
})[id]||null;
ctx.mobilityAfterRender();
assert.equal(supportKind.value,'support','Mobility problem selects support, not privacy');
assert.match(supportMessage.value,/Protocolo: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/);
assert.doesNotMatch(supportMessage.value,/Centro|Bairro|30[.]33|54[.]32|GPS:/,
 'Only the protocol may reach the general support form');
assert.equal(s.reportId,'','Prefill is consumed once without persisting location');
s.reportId=listing;
ctx.mobilityClearSession();
assert.equal(s.reportId,'','Signing out clears pending support context');
ctx.document.getElementById=domBeforeReport;ctx.route=routeBeforeReport;ctx.location.hash='#mobility';

// The only contact exposed is the existing PUBLIC listing WhatsApp, and
// only after acceptance. Neither rider contact nor GPS enters the URL.
const later=new Date(Date.now()+600000).toISOString();
const accepted={
 id:listing,role:'rider',status:'accepted',service:'moto',expires_at:later,
 driver_whatsapp:'+555599998888',listing_title:'Mototáxi de testes',
 origin:'Centro',destination:'Vila Sul'
};
const acceptedLink=ctx.mobilityAcceptedContactHtml(accepted);
assert.match(acceptedLink,/https:\/\/wa\.me\/555599998888\?text=/);
assert.match(ctx.mobilityDetailPanel(accepted),/Conversar com o motorista no WhatsApp/);
assert.match(acceptedLink,/noopener noreferrer/);
assert.doesNotMatch(acceptedLink,/Centro|Vila Sul|bbbbbbbb-bbbb|latitude|longitude|30\.33/);
for(const bad of [
 {...accepted,status:'requested'}, {...accepted,status:'completed'},
 {...accepted,status:'cancelled'}, {...accepted,status:'rejected'},
 {...accepted,status:'expired'}, {...accepted,role:'driver'},
 {...accepted,expires_at:new Date(Date.now()-5000).toISOString()},
 {...accepted,driver_whatsapp:null},
 {...accepted,driver_whatsapp:'+555 599998888'},
 {...accepted,driver_whatsapp:'javascript:alert(1)'}
])assert.equal(ctx.mobilityAcceptedContactHtml(bad),'',
 'no contact for nonaccepted, unauthorized, expired or malformed listing');
assert.doesNotMatch(ctx.mobilityDetailPanel({...accepted,status:'requested'}),
 /Conversar com o motorista no WhatsApp/);

console.log('PASS: GPS privacy and consent, active rider resume, duplicate request prevention, driver onboarding');