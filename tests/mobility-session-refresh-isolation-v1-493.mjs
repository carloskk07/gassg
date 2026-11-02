import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise actual production functions with controllable delayed replies.
// No Supabase project, phone, private data, GPS or production mutation.
const source=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const rideA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rideB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userA={id:'11111111-1111-4111-8111-111111111111'};
const userB={id:'22222222-2222-4222-8222-222222222222'};
const gate=()=>{let done;const promise=new Promise(resolve=>{done=resolve});return {promise,done}};
const pending={mobility_my_requests:[],mobility_snapshot:[],mobility_create_request:[],mobility_transition:[]};
const calls=[];
const client={rpc(name,args){
 calls.push({name,args});
 if(pending[name]){const p=gate();pending[name].push(p);return p.promise}
 return Promise.resolve({data:true,error:null});
},from(table){
 assert.equal(table,'mobility_requests');
 return {select(){return this},eq(){return this},
  maybeSingle:async()=>({data:null,error:new Error('simulated portrait revalidation failure')})};
}};
const handler={};
let renders=0;
const location={origin:'https://tamao.com.br',pathname:'/',search:'?corrida='+rideA+'&modalidade=moto',hash:'#mobility'};
const doc={
 visibilityState:'visible',querySelector:()=>null,getElementById:()=>null,
 createElement:()=>({}),head:{appendChild(){}},
 addEventListener:(name,fn)=>{handler[name]=fn}
};
const ctx={console,Date,URL,URLSearchParams,location,document:doc,
 FormData:class{constructor(target){this.target=target}get(name){return this.target.fields[name]}},
 route:()=> 'mobility',shell:x=>x,render:()=>{renders++},
 esc:x=>String(x??''),CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'test'},
 setInterval:()=>1,clearInterval:()=>{},navigator:{geolocation:{}},
 globalThis:null,addEventListener:(name,fn)=>{handler[name]=fn}};
ctx.globalThis=ctx;
vm.runInNewContext(source+';this.state=mobilityRuntime;',ctx,{filename:'js/mobility.js'});
const s=ctx.state;
s.phase='ready';s.user=userA;s.client=client;
const mk=(id,role='rider')=>({id,role,status:'en_route',service:'moto',
 expires_at:new Date(Date.now()+600000).toISOString(),
 origin:'Centro sintético',destination:'Bairro sintético',listing_title:'Profissional sintético',
 position:{lat:-30.3,lon:-54.3,accuracy_m:10,updated_at:new Date().toISOString()}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const resolve=(name,data,error=null)=>{assert.ok(pending[name].length,'No pending '+name);
 pending[name].shift().done({data,error})};

// A late list read cannot repopulate a logged-out person's route or GPS.
s.items=[mk(rideA)];s.id=rideA;s.detail=mk(rideA);s.mapConsent=true;
const lateList=ctx.mobilityRefresh(true);
assert.equal(pending.mobility_my_requests.length,1);
ctx.mobilityClearSession();
s.user=userB;
resolve('mobility_my_requests',[mk(rideA)]);
assert.equal(await lateList,false);
assert.equal(s.id,'');
assert.equal(s.detail,null);
assert.equal(s.items.length,0);
assert.equal(s.mapConsent,false);

// Two competing reads: the newer selection must win, including GPS.
s.user=userA;s.items=[mk(rideA),mk(rideB)];
s.id=rideA;s.detail=mk(rideA);
const staleSnapshot=ctx.mobilityRefresh(true);
resolve('mobility_my_requests',[mk(rideA),mk(rideB)]);
await flush();
assert.equal(pending.mobility_snapshot.length,1);
assert.equal(calls.at(-1).args.p_request_id,rideA);
assert.equal(ctx.mobilityFocus(rideB),true);
assert.equal(s.id,rideB);
resolve('mobility_my_requests',[mk(rideA),mk(rideB)]);
await flush();
assert.equal(pending.mobility_snapshot.length,2);
resolve('mobility_snapshot',mk(rideA));
assert.equal(await staleSnapshot,false);
assert.equal(s.id,rideB);
assert.equal(s.detail,null,'Old rider snapshot must not reappear under new selection');
resolve('mobility_snapshot',mk(rideB));
await flush();
assert.equal(s.id,rideB);
assert.equal(s.detail.id,rideB);

// A no-longer-readable snapshot cannot block the request form permanently.
const revoked=ctx.mobilityRefresh();
resolve('mobility_my_requests',[mk(rideB)]);
await flush();
resolve('mobility_snapshot',null);
assert.equal(await revoked,true);
assert.equal(s.id,'');
assert.equal(s.detail,null);
assert.equal(s.mapConsent,false);
assert.match(ctx.mobilityPage(),/Enviar solicitação ao anunciante/);

// Delayed create result after account replacement must not be shown to B.
s.user=userA;s.id='';s.notice='';
const create=ctx.mobilityCreate({preventDefault(){},
 target:{fields:{origin:'Centro sintético',destination:'Bairro sintético'}}});
assert.equal(pending.mobility_create_request.length,1);
ctx.mobilityClearSession();s.user=userB;
resolve('mobility_create_request',rideA);
assert.equal(await create,false);
assert.equal(s.id,'');assert.equal(s.notice,'');
assert.equal(s.busy,false);

// Similarly, an old driver's completed action cannot acknowledge to B.
s.user=userA;s.id=rideA;s.detail=mk(rideA,'driver');s.notice='';
const transition=ctx.mobilityTransition('arrive');
assert.equal(pending.mobility_transition.length,1);
ctx.mobilityClearSession();s.user=userB;
resolve('mobility_transition','arrived');
assert.equal(await transition,false);
assert.equal(s.id,'');assert.equal(s.notice,'');

// A public driver number can disappear from the authorized RPC snapshot
// without any change to the ride state or inbox. Quiet polling MUST remove
// the stale link on the current screen; a reconnect failure must fail closed.
s.user=userA;s.id=rideA;s.items=[{...mk(rideA),status:'accepted'}];
s.detail={...s.items[0],driver_whatsapp:'+555599998888'};
assert.match(ctx.mobilityPage(),/Conversar com o motorista no WhatsApp/);
const beforeRevocation=renders;
const silentRevocation=ctx.mobilityRefresh(true);
resolve('mobility_my_requests',[{...s.items[0]}]);
await flush();
resolve('mobility_snapshot',{...s.detail,driver_whatsapp:null});
assert.equal(await silentRevocation,true);
assert.equal(s.detail.driver_whatsapp,null);
assert.ok(renders>beforeRevocation,'A quiet poll must redraw the revoked contact');
assert.doesNotMatch(ctx.mobilityPage(),/Conversar com o motorista no WhatsApp/);
const restore=ctx.mobilityRefresh(true);
resolve('mobility_my_requests',[{...s.items[0]}]);
await flush();
resolve('mobility_snapshot',{...s.detail,driver_whatsapp:'+555599998888'});
assert.equal(await restore,true);
assert.match(ctx.mobilityPage(),/Conversar com o motorista no WhatsApp/);
const beforeLoss=renders;
const offline=ctx.mobilityRefresh(true);
resolve('mobility_my_requests',null,new Error('simulated offline read'));
assert.equal(await offline,false);
assert.equal(s.detail.driver_whatsapp,null,'Network failures must drop cached contact');
assert.ok(renders>beforeLoss,'Failed silent refresh must hide contact visibly');
assert.doesNotMatch(ctx.mobilityPage(),/Conversar com o motorista no WhatsApp/);

// A cached public portrait must disappear if its periodic revalidation
// fails without changing the ride status or the participant's inbox.
s.user=userA;s.id=rideA;s.items=[{...mk(rideA),status:'accepted',position:null}];
s.detail={...s.items[0],driver_whatsapp:null};
const portrait='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg';
s.selectedPortraitId=rideA;s.selectedPortraitKey=portrait;
s.selectedPortraitCheckedAt=Date.now()-61000;
assert.match(ctx.mobilityPage(),/class="mobility-driver-portrait"/);
const beforePortraitFailure=renders;
const portraitFailure=ctx.mobilityRefresh(true);
resolve('mobility_my_requests',[{...s.items[0]}]);
await flush();
resolve('mobility_snapshot',{...s.detail});
assert.equal(await portraitFailure,true);
assert.equal(s.selectedPortraitKey,'');
assert.ok(renders>beforePortraitFailure,'Quiet poll must redraw after portrait revalidation fails');
assert.doesNotMatch(ctx.mobilityPage(),/class="mobility-driver-portrait"/);

// Connectivity loss with only a cached portrait (no GPS/contact) must also
// remove it from the current DOM, instead of displaying stale authorization.
s.selectedPortraitId=rideA;s.selectedPortraitKey=portrait;
s.selectedPortraitCheckedAt=Date.now();
assert.match(ctx.mobilityPage(),/class="mobility-driver-portrait"/);
const beforePortraitOffline=renders;
const portraitOffline=ctx.mobilityRefresh(true);
resolve('mobility_my_requests',null,new Error('simulated offline read'));
assert.equal(await portraitOffline,false);
assert.equal(s.selectedPortraitKey,'');
assert.ok(renders>beforePortraitOffline,'Offline refresh must redraw and remove cached portrait');
assert.doesNotMatch(ctx.mobilityPage(),/class="mobility-driver-portrait"/);

// Returning to the app or reconnecting refreshes the authorized inbox.
s.user=userB;
doc.visibilityState='visible';handler.visibilitychange();
assert.equal(pending.mobility_my_requests.length,1);
resolve('mobility_my_requests',[]);
await flush();
handler.online();
assert.equal(pending.mobility_my_requests.length,1);
resolve('mobility_my_requests',[]);
await flush();
assert.ok(renders>0);
assert.ok(calls.some(x=>x.name==='mobility_transition'));
assert.ok(calls.some(x=>x.name==='mobility_create_request'));
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
assert.ok(audit.includes('node tests/mobility-session-refresh-isolation-v1-493.mjs'));
console.log('PASS: mobility session and selected-ride isolation, null snapshot recovery, reconnect refresh');
