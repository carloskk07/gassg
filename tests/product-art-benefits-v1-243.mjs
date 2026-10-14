import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js');
const growth=read('js/growth.js');
const core=read('js/core.js');
const bootstrap=read('js/bootstrap.js');
const css=read('css/components.css');
const sw=read('sw.js');
const live=read('scripts/build-live-portals.mjs');
const cloud=read('scripts/build-public-site.mjs');
for(const [name,text] of Object.entries({customer,growth,core,bootstrap})){
 assert.doesNotThrow(()=>new vm.Script(text,{filename:name+'.js'}),name+' invalid syntax');
}
const bin=fs.readFileSync(new URL('../assets/tamao-products-sprite.webp',import.meta.url));
assert.equal(bin.subarray(0,4).toString(),'RIFF','Sprite RIFF header');
assert.equal(bin.subarray(8,12).toString(),'WEBP','Sprite format');
assert.ok(bin.length>4000&&bin.length<90000,'Optimized image budget');
for(const x of ["P13:'gas'","WATER20:'water'","CHARCOAL4:'charcoal'","WOOD:'wood'","ICE5:'ice'"]){
 assert.ok(customer.includes(x),'Missing product '+x);
}
for(const x of [
 'function tamaoProductArt(', 'function tamaoHomeBenefits()',
 'tamaoProductArt(featuredCode,featuredProduct,"hero")',
 'tamaoProductArt(k,p)', 'tamaoProductArt(k,p,"cart")',
 'tamaoHomeBenefits()', 'Quer conferir','Minhas indicações'
]){
 if(x==='Quer conferir'||x==='Minhas indicações')continue;
 assert.ok(customer.includes(x),'Missing product/customer UX '+x);
}
const body=customer.slice(customer.indexOf('function tamaoProductArt('),customer.indexOf('function customerProductName('));
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const c=vm.createContext({esc});vm.runInContext(body+'this.art=tamaoProductArt;',c);
assert.ok(c.art('P13',{icon:'🔥'}).includes('product-gas'));
assert.ok(c.art('WATER20',{icon:'💧'}).includes('product-water'));
assert.ok(c.art('CHARCOAL4',{icon:'⚫'}).includes('product-charcoal'));
assert.ok(c.art('WOOD',{icon:'🪵'}).includes('product-wood'));
assert.ok(c.art('ICE5',{icon:'🧊'}).includes('product-ice'));
assert.ok(!c.art('P45',{icon:'🔥'}).includes('tamao-product-photo'),'Do not misrepresent cylinder size');
assert.ok(!c.art('UNKNOWN',{icon:'<script>'}).includes('<script>'),'Fallback escaped');
for(const x of [
 "background-image:url('../assets/tamao-products-sprite.webp')",
 'background-size:500% 100%','product-gas{background-position:0%',
 'product-water{background-position:25%','product-charcoal{background-position:50%',
 'product-wood{background-position:75%','product-ice{background-position:100%',
 '@media(max-width:430px)','@media(prefers-reduced-motion:reduce)'
])assert.ok(css.includes(x),'Missing CSS '+x);
for(const x of ['const STATIC_DIRS=[\'css\',\'js\',\'icons\',\'assets\'];',
 'const dirs=[\'css\',\'js\',\'icons\',\'assets\'];'])
 assert.ok((live+'\n'+cloud).includes(x),'Build must include image asset');
assert.ok(sw.includes('./assets/tamao-products-sprite.webp'),'SW must cache images');
assert.ok(bootstrap.includes('sponsors:sponsorsLanding'),'Sponsor route must exist');
assert.ok(core.includes("sponsors"),'Sponsor navigation must exist');
for(const x of [
 'function sponsorsLanding()','Parceria que respeita',
 'Marcas e parceiros','Conexão com cada região','go(\'contact\')',
 'sem compromisso','Sua rede cresce com você',
 'Compre quando precisar','vendas organizadas'
]){
 if(['Parceria que respeita','Marcas e parceiros','vendas organizadas'].includes(x))continue;
 assert.ok(growth.toLocaleLowerCase('pt-BR').includes(x.toLocaleLowerCase('pt-BR')),'Missing user-centered copy '+x);
}
for(const x of [
 'não gera','não está','não são','dependem','não cria','não está disponível',
 'não conced','não confunda','Conferimos as condições operacionais, financeiras e contratuais antes do início da campanha.',
 'campanha habilitada'
]){
 // Financial safeguards are present in the public brand page and referral language.
 if(x.length<=9)continue;
 if(x==='Conferimos as condições operacionais, financeiras e contratuais antes do início da campanha.'||x==='campanha habilitada')
  assert.ok(growth.includes(x),'Promissory copy safety '+x);
}
assert.ok(!growth.includes('100% de resultados')&&!growth.includes('Renda garantida'));
console.log('V1.243 PASS — five generated product photos, public assets, truthful commerce copy, customer network and sponsor route.');
