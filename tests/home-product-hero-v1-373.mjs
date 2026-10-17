import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js');
const css=read('css/marketing-premium.css');
new vm.Script(customer,{filename:'customer.js'});

const home=customer.slice(customer.indexOf('function home(){'),customer.indexOf('\nfunction orderPage(){'));
assert.ok(home.length>10000,'the real customer home was located');
const before=home.indexOf('const heroVisualCodes=');
const after=home.indexOf('const feeBps=',before);
assert.ok(before>=0&&after>before,'hero visuals must be built from catalogue entries');
const fixture=home.slice(before,after);

function heroFor(codes){
  const entries=codes.map(code=>[code,{name:code==='P13'?'Gás 13 kg':code==='WATER20'?'Água 20 L':code,icon:'📦'}]);
  const products=Object.fromEntries(entries);
  const context=vm.createContext({
    products,discoveryEntries:entries,
    customerProductName:(code,product)=>product.name,
    tamaoProductArt:code=>'<span data-art="'+code+'">foto</span>',
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
  });
  vm.runInContext(fixture+'\nthis.result={codes:heroVisualCodes,cards:heroVisualCards};',context);
  return context.result;
}
const both=heroFor(['OTHER1','WATER20','P13']);
assert.equal(Array.from(both.codes).join(','),'P13,WATER20',
  'visual order can favor gas and water while staying in verified browseable catalogue');
assert.ok(both.cards.includes('data-art="P13"')&&both.cards.includes('data-art="WATER20"'));
assert.ok(both.cards.includes('type="button"')&&both.cards.includes('onclick="quickProduct(\'P13\')"'));
assert.ok(both.cards.includes('onclick="quickProduct(\'WATER20\')"'));
assert.ok(both.cards.includes('aria-label="Escolher Gás 13 kg e consultar entrega pelo CEP"'));
assert.equal((both.cards.match(/class="home-editorial-(?:gas|water) home-editorial-choice"/g)||[]).length,2,
  'exactly two clickable product cards, excluding nested image spans');
const waterOnly=heroFor(['WATER20']);
assert.equal(Array.from(waterOnly.codes).join(','),'WATER20');
assert.ok(!waterOnly.cards.includes("quickProduct('P13')"),'no invented gas item');
assert.ok(waterOnly.cards.includes("quickProduct('WATER20')"));
const other=heroFor(['OTHER1']);
assert.equal(Array.from(other.codes).join(','),'OTHER1');
assert.ok(!other.cards.includes('Gás 13 kg')&&!other.cards.includes('Água 20 L'));
const empty=heroFor([]);
assert.equal(empty.cards,'','no product cards without browseable catalogue items');
assert.ok(home.includes("heroVisualCards||'<button type=\"button\" class=\"home-editorial-empty\""));
assert.ok(home.includes('Vitrine')===false||home.includes('Escolha visual de produtos do catálogo'));
assert.ok(home.includes('onclick="homeDiscoverFocus()"')&&
  home.includes('Explorar todos os produtos'));
assert.ok(home.includes('Preço e entrega dependem das opções confirmadas'));
assert.ok(home.includes('aria-hidden="true"></div>'),'decorative orbit remains hidden');
assert.ok(home.includes("const primaryAction=acquisitionOpen?'homeDiscoverFocus()':'startCustomerAvailability()'"),
 'existing buyer entry is preserved');
assert.ok(customer.includes("function quickProduct(k){state.cart=normalizeCart({});state.checkout.glpContainerMode='exchange';setCartProduct(k,1);go('order')}"),
 'an explicit product click builds its own basket, without adding gas to a water click');
assert.ok(home.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
  'city pricing remains evidence-gated');
for(const selector of ['.home-editorial-choice','.home-editorial-all',
 '.home-editorial-choice:focus-visible','.home-editorial-empty',
 '@media(max-width:1030px)','@media(max-width:620px)',
 '@media(max-width:370px)','@media(prefers-reduced-motion:reduce)']){
 assert.ok(css.includes(selector),'responsive or accessible hero style absent: '+selector);
}
console.log('TAMÃO V1.373 PASS — clickable artwork uses browseable catalogue only; no forced basket or false availability.');
