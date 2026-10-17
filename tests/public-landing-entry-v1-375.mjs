import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const bootstrap=read('js/bootstrap.js');
const customer=read('js/customer.js');
const css=read('css/marketing-premium.css');
for(const [name,source] of Object.entries({bootstrap,customer})){
 new vm.Script(source,{filename:name+'.js'});
}

const start=bootstrap.indexOf('function tamaoPublicEntryIntent(){');
const end=bootstrap.indexOf('let renderLock=false;',start);
assert.ok(start>=0&&end>start,'public landing route helpers must precede rendering');
const resolve=bootstrap.slice(start,end);
function arrival(search,hash='',flags={}){
 const location={search,hash};
 let navigated='';
 const ctx=vm.createContext({
   URLSearchParams,location,
   globalThis:{
     adminPortalRequested:()=>Boolean(flags.admin),
     merchantPortalRequested:()=>Boolean(flags.merchant),
     __CHAMA_TEST__:Boolean(flags.test),
     CHAMA_INTERNAL_PILOT:Boolean(flags.internal)
   },
   go:route=>{navigated=route;location.hash='#'+route}
 });
 vm.runInContext(resolve+'\nthis.intent=tamaoPublicEntryIntent;this.enter=tamaoPublicEntryRoute;',ctx);
 return {intent:ctx.intent(),changed:ctx.enter(),route:navigated,hash:location.hash,search:location.search};
}
for(const [intent,destination] of [['revenda','merchants'],['marca','sponsors'],['indicar','earn']]){
 const a=arrival('?utm_source=instagram&utm_medium=cpc&ref=ABCDE1&entrada='+intent);
 assert.equal(a.intent,intent);
 assert.equal(a.changed,true);
 assert.equal(a.route,destination);
 assert.ok(a.search.includes('ref=ABCDE1')&&a.search.includes('utm_source=instagram'));
}
for(const [intent] of [['agua'],['gas']]){
 const a=arrival('?entrada='+intent+'&utm_campaign=essential');
 assert.equal(a.intent,intent);
 assert.equal(a.changed,false,'product intent only filters public home, never places orders');
 assert.equal(a.hash,'');
}
for(const value of ['','order','admin','javascript:alert(1)','MARCAEVIL','../../../order']){
 const a=arrival('?entrada='+encodeURIComponent(value));
 assert.equal(a.changed,false,'unknown or privileged page rejected '+value);
 assert.equal(a.intent,'');
}
for(const hash of ['#home','#order','#contact','#merchants']){
 const a=arrival('?entrada=revenda&ref=ABCDE1',hash);
 assert.equal(a.changed,false,'explicit navigation cannot be hijacked by an ad');
 assert.equal(a.hash,hash);
}
for(const flags of [{admin:true},{merchant:true},{test:true},{internal:true}]){
 assert.equal(arrival('?entrada=marca','',flags).changed,false,
 'campaign links cannot redirect privileged/demo origin');
}
assert.ok(bootstrap.includes('tamaoPublicEntryRoute();\n    render();'),
 'resolve first navigation before marketing analytics initial render');
assert.ok(bootstrap.includes('if(globalThis.liveRequested?.()){'),
 'backend initialization/availability guard unchanged');

const hStart=customer.indexOf('  const publicEntryKind=');
const hEnd=customer.indexOf('  const discoveryTiles=',hStart);
assert.ok(hStart>=0&&hEnd>hStart,'home contextual section must be based on real catalogue counts');
const homeFragment=customer.slice(hStart,hEnd);
function homeIntent(entrada,counts){
 const ctx=vm.createContext({
   discoveryCounts:counts,
   tamaoPublicEntryIntent:()=>entrada
 });
 vm.runInContext(homeFragment+'\nthis.out={kind:homeIntentKind,html:homeIntentGuide};',ctx);
 return ctx.out;
}
const water=homeIntent('agua',{water:1,gas:0,other:3});
assert.equal(water.kind,'water');
assert.ok(water.html.includes("homeFilterProducts('water')"));
assert.ok(water.html.includes('Ver água')&&water.html.includes('CEP'));
assert.ok(!water.html.includes('R$')&&!water.html.includes('em estoque'));
const gas=homeIntent('gas',{water:0,gas:2,other:1});
assert.equal(gas.kind,'gas');
assert.ok(gas.html.includes("homeFilterProducts('gas')"));
assert.equal(homeIntent('agua',{water:0,gas:3,other:1}).html,'',
 'no water pitch when water is not browseable in this catalogue');
assert.equal(homeIntent('gas',{water:2,gas:0,other:0}).html,'');
assert.equal(homeIntent('marca',{water:2,gas:2,other:0}).html,'');
assert.ok(customer.includes('${homeIntentGuide}'),
 'contextual helper must render in first-fold buyer hero');
assert.ok(customer.includes('const discoveryEntries=homeProductEntries'), 'server-gated catalogue must remain');
assert.ok(customer.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
 'city price claims must stay evidence-backed');
assert.ok(customer.includes('homeFilterProducts'), 'category CTA should use existing safe filter');
for(const key of ['.home-entry-intent','.home-entry-intent button:focus-visible',
 '@media(max-width:760px)','@media(max-width:370px)','@media(prefers-reduced-motion:reduce)']){
 assert.ok(css.includes(key),'responsive/accessibility theme required: '+key);
}
console.log('TAMÃO V1.375 PASS — UTM/ref preserved, allowlisted intent, safe visitor routing, catalogue-based water/gas pitch.');
