import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const growth=read('js/growth.js');
const merchant=read('js/merchant.js');
const admin=read('js/admin.js');
const core=read('js/core.js');
const css=read('css/components.css');
for(const [name,code] of Object.entries({customer,growth,merchant,admin,core})){
  new vm.Script(code,{filename:name+'.js'});
}
for(const required of [
  'const discoveryTiles=','home-discover-tile','home-discover-grid',
  'quickProduct(','home-discover-all','PRIMEIRO ESCOLHA.',
  'Montar minha cesta','REFERÊNCIA LOCAL'
])assert.ok(customer.includes(required),'missing customer discovery: '+required);
assert.match(customer,/discoveryTiles=homeProductEntries\s*\.filter\(\(\[code\]\)=>\/\^\[A-Z\]/);
assert.ok(customer.indexOf('home-discover-grid')<customer.indexOf('homeRegionalPriceBoard(homeRegion)'),
  'show categories before the regional price board');
assert.ok(customer.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
  'public city prices must be verified and non-quotational');
assert.ok(customer.includes("return startHomeOrder()"),
  'discover-first must preserve validated order transition');
assert.ok(customer.includes("cityChecked&&!hasConfirmedCityOffers"),
  'do not hide no-offer messaging after actual CEP check');
const merchantLogin=merchant.slice(
  merchant.indexOf('function merchantLiveLoginView(){'),
  merchant.indexOf('function merchantLiveNoAccess(){')
);
for(const token of ['merchant-access-grid','merchant-access-story','merchant-access-panel',
  'merchant-access-form','onsubmit="event.preventDefault();merchantLoginFromUi()"',
  'required','pilotInvite','prospectInvite','merchant-email','go(\'merchants\')'])
  assert.ok(merchantLogin.includes(token),'merchant login contract lost: '+token);
assert.ok(merchantLogin.includes('O cadastro da empresa passa por conferência'),
  'merchant cannot bypass commercial onboarding');
const adminLogin=admin.slice(admin.indexOf('function adminLoginView(){'),
  admin.indexOf('function adminNoAccessView(){'));
assert.ok(adminLogin.includes('onsubmit="event.preventDefault();adminLoginFromUi()"'));
assert.ok(adminLogin.includes('adminRuntime.actionPending'),'admin request state must remain');
assert.ok(adminLogin.includes('previamente autorizadas'),'server-based authorization remains clear');
assert.ok(core.includes('skip-to-main')&&core.includes('id="tamao-main"')&&core.includes('tabindex="-1"'),
  'skip-to-content keyboard navigation missing');
assert.ok(core.includes('<nav class="desktop-only desktop-nav" aria-label="Navegação principal">'));
assert.ok(growth.includes('Veja primeiro os produtos e escolha o que precisa.'),
  'how-it-works journey must not force CEP before discovery');
for(const token of ['.home-discover-grid','.merchant-access-grid',
  '.skip-to-main:focus-visible','@media(max-width:540px)',
  '@media(prefers-reduced-motion:reduce)'])
  assert.ok(css.includes(token),'missing responsive UX/a11y system: '+token);
console.log('TAMÃO V1.346: discovery, marketing, merchant/auth, accessibility contracts OK');
