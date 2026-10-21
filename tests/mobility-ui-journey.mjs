import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const source=read('js/mobility.js');new vm.Script(source);
let watch=0,stop=0,called=[];
const driver={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const listing='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ctx={console,FormData,URL,URLSearchParams,Date,isSecureContext:true,
 location:{search:'?corrida='+listing+'&modalidade=moto',origin:'https://tamao.com.br',pathname:'/',hash:'#mobility'},
 document:{visibilityState:'visible',addEventListener:(name,fn)=>{ctx.listener=fn},getElementById:()=>null},
 navigator:{geolocation:{watchPosition(){watch++;return 17},clearWatch(){stop++}}},
 route:()=> 'mobility',shell:x=>x,render(){},setInterval(){return 1},clearInterval(){},
 esc:x=>String(x??'').replace(/</g,'&lt;'),CHAMA_BACKEND:{url:'https://example.test',publishableKey:'anon'},
 chamaFetch(){},loadSupabaseBrowser:async()=>({createClient:()=>client})};
ctx.globalThis=ctx;
const client={rpc:async(name,args)=>{called.push([name,args]);return {data:true,error:null}},auth:{}};
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
s.detail.position=null;assert.doesNotMatch(ctx.mobilityPage(),/<iframe/);
s.detail={id:listing,role:'driver',status:'accepted',origin:'Centro',destination:'Vila'};
assert.equal(ctx.mobilityStartTracking(),false);assert.equal(watch,0);
s.detail.status='en_route';
assert.equal(ctx.mobilityStartTracking(),true);assert.equal(watch,1);
ctx.document.visibilityState='hidden';ctx.listener();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(stop,1);assert.equal(s.watch,null);
assert.ok(called.some(x=>x[0]==='mobility_stop_position'));
s.detail.status='completed';ctx.document.visibilityState='visible';
assert.equal(ctx.mobilityStartTracking(),false);
assert.equal(ctx.mobilityMapUrl({lat:91,lon:0}),'');
ctx.location.search='?corrida=bad&modalidade=moto';assert.equal(ctx.mobilityIntent(),null);
assert.ok(read('js/bootstrap.js').includes('mobilityRequestModule()'));
assert.ok(read('index.html').includes('frame-src https://challenges.cloudflare.com https://www.openstreetmap.org'));
assert.ok(read('js/discovery.js').includes('Solicitar e acompanhar no mapa'));
console.log('PASS: GPS only driver en_route, user consent map, tab hidden stop, unknown ID blocked');