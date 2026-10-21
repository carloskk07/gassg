import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const bootstrap=read('js/bootstrap.js');
const index=read('index.html');
const css=read('css/marketing-premium.css');
for(const [name,source] of Object.entries({customer,bootstrap})){
  new vm.Script(source,{filename:name+'.js'});
}
const home=customer.slice(customer.indexOf('function home(){'),customer.indexOf('\nfunction orderPage(){'));
assert.ok(home.length>10000);
const quote=home.indexOf('homeRegionalPriceBoard(homeRegion)');
const catalogue=home.indexOf('class="home-discover tamao-home-catalog"');
const services=home.indexOf('tamaoDiscoveryEntryHub()}');
assert.ok(quote>=0&&catalogue>quote&&services>catalogue,
 'The regional quotation must precede the full catalogue and the single service hub');
assert.ok(home.includes("onclick=\\"startHomeBrowse()\\""),
 'The browse CTA opens an empty basket without automatically selecting gas');
assert.ok(home.includes("if(!testDemo&&!internalPilot)return shell("),
 'The redundant hero must be absent from public visitor rendering');
assert.ok(home.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
  'presentation prices must still be verified and marked non-quotational');
assert.ok(home.includes("const primaryAction=acquisitionOpen?'homeDiscoverFocus()':'startCustomerAvailability()'"),
  'existing eligibility-dependent purchase action must stay in place');

// Product discovery must fail open to an empty basket if the gallery is missing.
const begin=customer.indexOf('function homeProductGroup(');
const end=customer.indexOf('function home(){',begin);
let neutralEntry=0;
let legacyEntry=0;
const discoveryContext=vm.createContext({
 document:{getElementById:()=>null},
 startHomeBrowse:()=>{neutralEntry++;return 'neutral'},
 startCustomerAvailability:()=>{legacyEntry++;return 'legacy'}
});
vm.runInContext(customer.slice(begin,end)+'\nthis.discover=homeDiscoverFocus;',discoveryContext);
assert.equal(discoveryContext.discover(),'neutral');
assert.equal(neutralEntry,1);
assert.equal(legacyEntry,0,'missing gallery may not add gas automatically');

const metadataCode=bootstrap.slice(0,bootstrap.indexOf('let renderLock=false;'));
assert.match(metadataCode,/TAMAO_PUBLIC_PAGE_IDENTITY/);
const metadata={content:'',setAttribute(name,value){if(name==='content')this.content=value}};
const heading={
 textContent:'Quero vender com mais autonomia',
 attributes:{},focused:false,
 setAttribute(name,value){this.attributes[name]=value},
 focus(options){this.focused=options?.preventScroll===true}
};
const main={querySelector:sel=>sel==='h1'?heading:null};
const announcement={textContent:''};
let current='merchants',admin=false,merchantPortal=false,scrolls=0;
const document={
 title:'TAMÃO',
 querySelector:sel=>sel==='meta[name="description"]'?metadata:null,
 getElementById:id=>id==='tamao-main'?main:id==='tamao-route-announcement'?announcement:null
};
const ctx=vm.createContext({
 document,
 globalThis:{
  adminPortalRequested:()=>admin,
  merchantPortalRequested:()=>merchantPortal
 },
 route:()=>current,
 window:{scrollTo:()=>{scrolls++}}
});
vm.runInContext(metadataCode+'\nthis.identity=updatePublicPageIdentity;this.announce=announcePublicPageNavigation;',ctx);
ctx.identity(current);
assert.match(document.title,/Para revendas/);
assert.match(metadata.content,/preços, produtos, estoque e entregas/);
ctx.announce();
assert.equal(heading.focused,true);
assert.equal(heading.attributes.tabindex,'-1');
assert.equal(scrolls,1);
assert.equal(announcement.textContent,heading.textContent);
current='sponsors';ctx.identity(current);
assert.match(document.title,/Para marcas/);
assert.match(metadata.content,/divulgação regional/);
current='learn';ctx.identity(current);
assert.match(document.title,/Como funciona/);
assert.match(metadata.content,/confirmação da revenda/);
current='home';ctx.identity(current);
assert.match(document.title,/TAMÃO/);
assert.match(metadata.content,/CEP/);

// Admin and merchant portal shells must not be rebranded as visitor pages.
admin=true;const before=document.title;ctx.identity('sponsors');ctx.announce();
assert.equal(document.title,before);
assert.equal(scrolls,1);
admin=false;merchantPortal=true;ctx.identity('merchants');ctx.announce();
assert.equal(document.title,before);
assert.equal(scrolls,1);

assert.match(bootstrap,/window.addEventListener\('hashchange',\(\)=>\{\s*render\(\);\s*announcePublicPageNavigation\(\);/);
assert.ok(index.includes('id="tamao-route-announcement"'));
assert.ok(css.includes('.tamao-visually-hidden'));
assert.ok(css.includes('.marketing-hero .starter-cta'));
assert.ok(css.includes('@media(max-width:620px)'));
console.log('TAMÃO V1.371 PASS — buyer-first hero, neutral entry, public route focus and page identity.');
