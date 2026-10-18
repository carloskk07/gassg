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
const sandbox={
 route:()=>current,shell:s=>s,esc,BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 chamaFetch:async()=>({}),CHAMA_BACKEND:{url:'https://example.test',publishableKey:'test-publishable'},
 render:()=>{rendered++;},
 document:{getElementById:(id)=>({
   'discovery-uf':{value:'SC'},'discovery-city':{value:'Florianópolis'}
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
 guests:null,seats_available:null
}];
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
current='admin';
assert.equal(sandbox.discoveryKind(),'');
const html=read('index.html'),sw=read('sw.js'),boot=read('js/bootstrap.js'),
 home=read('js/customer.js'),css=read('css/discovery.css');
for(const file of ['js/discovery.js','css/discovery.css']){
 assert.ok(html.includes('./'+file),'asset missing in index: '+file);
 assert.ok(sw.includes("'./"+file+"'"),'asset missing in PWA precache: '+file);
}
for(const kind of ['professionals','rides','stays']){
 assert.ok(boot.includes(kind+':discoveryPage'),kind+' route missing');
}
assert.match(boot,/globalThis\.discoveryAfterRender/);
assert.match(home,/discoveryExploreCards\(\)/);
assert.match(css,/@media\(max-width:760px\)/);
console.log('PASS: 3 browse routes, RLS query, safe HTML/WhatsApp, location filters and PWA assets.');
