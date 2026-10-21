import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const source=read('js/mobility.js');new vm.Script(source);
let watch=0,stop=0,called=[],signedOutListener=null,signOutCalls=0;
const driver={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const listing='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ctx={console,FormData,URL,URLSearchParams,Date,isSecureContext:true,
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
 signOut:async()=>{signOutCalls++;signedOutListener?.('SIGNED_OUT',null);return {error:null}},
 onAuthStateChange:(callback)=>{signedOutListener=callback;return {data:{subscription:{unsubscribe(){}}}};}
},rpc:async(name,args)=>{
 called.push([name,args]);
 if(failRefresh&&name==='mobility_my_requests')throw Error('simulated connectivity loss');
 if(name==='mobility_start_position'&&holdStart)
  return new Promise(resolve=>{resolveHeldStart=resolve});
 return {data:true,error:null};
}};
vm.runInNewContext(source+';this.state=mobilityRuntime;',ctx);
const s=ctx.state;
assert.equal(ctx.mobilityIntent().id,listing);
assert.match(ctx.mobilityPage(),/Preparando sua área segura/);
s.phase='ready';s.client=client;s.user=driver;
assert.match(ctx.mobilityPage(),/Solicitar uma moto/);
s.id=listing;
s.detail={id:listing,role:'rider',status:'en_route',origin:'Centro',destination:'Vila',
 position:{lat:-30.33,lon:-54.32,accuracy_m:30,updated_at:new Date().toISOString()}};
assert.match(ctx.mobilityPage(),/Mostrar o mapa do motorista/);
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
assert.doesNotMatch(ctx.mobilityPage(),/openstreetmap.org/);
s.user=driver;s.items=[{id:listing}];s.detail={id:listing,role:'rider',
 status:'en_route',position:validPosition};
signedOutListener('SIGNED_OUT',null);
assert.equal(s.user,null,'Cross-tab sign-out must clear owner identity');
assert.equal(s.detail,null,'Cross-tab sign-out must clear cached GPS');
assert.equal(s.items.length,0,'Cross-tab sign-out must clear trip list');
ctx.location.search='?corrida=bad&modalidade=moto';assert.equal(ctx.mobilityIntent(),null);
assert.ok(read('js/bootstrap.js').includes('mobilityRequestModule()'));
assert.ok(read('js/bootstrap.js').includes('mobilityModuleError'));
assert.ok(read('js/bootstrap.js').includes('mobilityRetryModule()'));
assert.ok(read('js/bootstrap.js').includes("s.onerror=()=>{mobilityModuleError=true;render()}"),
 'a failed lazy script cannot trigger an infinite render/reload loop');
assert.ok(read('index.html').includes('frame-src https://challenges.cloudflare.com https://www.openstreetmap.org'));
assert.ok(read('js/discovery.js').includes('Solicitar e acompanhar no mapa'));
console.log('PASS: GPS only driver en_route, user consent map, tab hidden stop, unknown ID blocked');