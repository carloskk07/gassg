import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/discovery.js');
assert.doesNotThrow(()=>new vm.Script(source,{filename:'js/discovery.js'}));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
let current='professionals',results=[],calls=[],rendered=0;
let requestedDeparture='',profession='Eletricista',minSeats='2',propertyType='inn',maxPrice='300';
const sandbox={
 route:()=>current,shell:s=>s,esc,BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 chamaFetch:async()=>({}),CHAMA_BACKEND:{url:'https://example.test',publishableKey:'test-publishable'},
 render:()=>{rendered++;},
 document:{getElementById:(id)=>({
   'discovery-uf':{value:'SC'},'discovery-city':{value:'Florianópolis'},
   'discovery-departure-after':{value:requestedDeparture},
   'discovery-occupation':{value:profession},
   'discovery-min-seats':{value:minSeats},
   'discovery-property-type':{value:propertyType},
   'discovery-max-price':{value:maxPrice}
 })[id]},
 loadSupabaseBrowser:async()=>({
   createClient:(_url,_key,opts)=>{
     assert.equal(opts.auth.persistSession,false);
     assert.equal(opts.auth.detectSessionInUrl,false);
     return {rpc:async(name,params)=>{calls.push([name,params]);return {data:results,error:null}}};
   }
 }),
 console
};
sandbox.globalThis=sandbox;
vm.runInNewContext(source,sandbox,{filename:'js/discovery.js'});
const title='<svg onload=alert(1)>';
results=[{
 id:'a',vertical:'professionals',title,description:'Trabalho realizado com cuidado',
 city_name:'São Gabriel',state_code:'RS',occupation:'Eletricista',whatsapp_e164:'+555599998888',
 photo_urls:['00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.webp'],
 guests:null,seats_available:null
}];
const ownedPhoto='00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.webp';
assert.match(sandbox.discoveryPublicPhotoUrl(ownedPhoto),
  /\/storage\/v1\/object\/public\/tamao-discovery-photos\//);
assert.equal(sandbox.discoveryPublicPhotoUrl('https://attacker.example/tracker.jpg'),'');
assert.equal(sandbox.discoveryPublicPhotoUrl('../private.pdf'),'');
assert.match(sandbox.discoveryExploreCards(),/onclick="go\('professionals'\)"/);
assert.match(sandbox.discoveryExploreCards(),/onclick="go\('rides'\)"/);
assert.match(sandbox.discoveryExploreCards(),/onclick="go\('stays'\)"/);
const initial=sandbox.discoveryPage();
assert.match(initial,/TAMÃO PROFISSIONAIS/);
assert.match(initial,/id="discovery-city"/);
sandbox.discoveryAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(rendered>0,true);
assert.equal(calls.length,1);
assert.equal(calls[0][0],'discovery_public_search');
assert.equal(calls[0][1].p_vertical,'professionals');
assert.equal(calls[0][1].p_limit,24);
const displayed=sandbox.discoveryPage();
assert.match(displayed,/Eletricista/);
assert.doesNotMatch(displayed,/<svg onload/);
assert.match(displayed,/&lt;svg onload=alert\(1\)&gt;/);
assert.match(displayed,/wa\.me\/555599998888/);
assert.doesNotMatch(displayed,/email|owner_id|user_id/i);
sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_state_code,'SC');
assert.equal(calls.at(-1)[1].p_city_key,'florianopolis');
assert.match(sandbox.discoveryPage(),/id="discovery-occupation"/);
assert.equal(calls.at(-1)[1].p_occupation_query,'Eletricista');
assert.equal(calls.at(-1)[1].p_min_seats,null);
assert.equal(calls.at(-1)[1].p_property_type,null);
assert.equal(calls.at(-1)[1].p_max_price_cents,null);
for(const [kind,term] of [['rides','CARONAS'],['stays','HOSPEDAGENS']]){
 current=kind;
 results=[];
 sandbox.discoveryAfterRender();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.at(-1)[1].p_vertical,kind);
 const page=sandbox.discoveryPage();
 assert.match(page,new RegExp('TAMÃO '+term));
 assert.match(page,/Nenhum anúncio publicado encontrado/);
}
current='rides';
requestedDeparture='2030-03-10T09:30';
assert.match(sandbox.discoveryPage(),/id="discovery-departure-after"/);
sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_departure_after,new Date(requestedDeparture).toISOString(),
 'ride date filter must be sent in UTC, preserving local visitor intent');
assert.equal(calls.at(-1)[1].p_min_guests,null);
assert.match(sandbox.discoveryPage(),/id="discovery-min-seats"/);
assert.equal(calls.at(-1)[1].p_min_seats,2);
assert.equal(calls.at(-1)[1].p_occupation_query,null);
assert.equal(calls.at(-1)[1].p_max_price_cents,null);
current='stays';
requestedDeparture='';
sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_departure_after,null,
 'stays must not inherit ride date filters');
assert.match(sandbox.discoveryPage(),/id="discovery-property-type"/);
assert.match(sandbox.discoveryPage(),/id="discovery-max-price"/);
assert.equal(calls.at(-1)[1].p_property_type,'inn');
assert.equal(calls.at(-1)[1].p_max_price_cents,30000);
assert.equal(calls.at(-1)[1].p_min_seats,null);
assert.equal(calls.at(-1)[1].p_occupation_query,null);
// Invalid and deliberately oversized values never become broad, unintended RPC filters.
minSeats='9';propertyType='other<script>';maxPrice='600000';
current='rides';sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_min_seats,null);
current='stays';sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_property_type,null);
assert.equal(calls.at(-1)[1].p_max_price_cents,null);
current='admin';
assert.equal(sandbox.discoveryKind(),'');
const html=read('index.html'),sw=read('sw.js'),boot=read('js/bootstrap.js'),
 home=read('js/customer.js'),css=read('css/discovery.css');
for(const file of ['js/discovery.js','css/discovery.css']){
 assert.ok(!html.includes('./'+file),'discovery must not load on startup');
 assert.ok(!sw.includes("'./"+file+"'"),'discovery must be lazy in PWA cache');
 assert.ok(boot.includes('./'+file),'the lazy loader must reference the asset');
}
for(const kind of ['professionals','rides','stays']){
 assert.ok(boot.includes(kind+":typeof discoveryPage==='function'"),kind+' lazy route missing');
}
assert.match(boot,/discoveryRequestModule/);
assert.match(home,/tamaoDiscoveryEntryHub/);
assert.match(css,/@media\(max-width:760px\)/);
console.log('PASS: 3 browse routes, RLS query, safe HTML/WhatsApp, location filters and PWA assets.');
