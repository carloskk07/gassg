import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('js/home-showcase.js'),customer=read('js/customer.js');
const merchant=read('js/merchant.js'),admin=read('js/admin.js');
const discovery=read('js/discovery.js'),bootstrap=read('js/bootstrap.js');
const publicCss=read('css/public-ux.css'),workspaceCss=read('css/workspace-experience.css');
const landing=read('scripts/build-discovery-landings.mjs');
for(const [name,source] of Object.entries({home,customer,merchant,admin,discovery,bootstrap}))
 assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));
assert.match(home,/real\.length>0&&globalThis\.liveReady/);
assert.match(home,/Sem ofertas confirmadas em/);
assert.match(home,/pedido só avança com uma revenda e um preço confirmados/);
assert.match(customer,/page tamao-checkout-page/);
assert.match(customer,/Seu pedido em 4 passos/);
assert.match(customer,/aria-current/);
for(const name of ['merchantAdsStartSection','merchantAdsContactFeedbackSection','merchantAdsCampaignSection','merchantClubeTermsSection','merchantGrowthNetworkSection'])
 assert.ok(merchant.includes(name+'(m)'),name+' preserved');
assert.equal((merchant.match(/class="merchant-growth-group"/g)||[]).length,3);
assert.match(admin,/class="admin-overview-extra"/);
assert.match(admin,/adminGlobalSearchView\(\)[\s\S]*?adminTaskNavView\(\)/);
assert.match(discovery,/class="section discovery-page tamao-paused-page"/);
assert.match(bootstrap,/\['home','order','tracking','learn','club'/);
assert.match(publicCss,/\.tamao-checkout-page \.buyer-journey/);
assert.match(workspaceCss,/\.merchant-workspace \.merchant-growth-group/);
assert.match(landing,/ed-discovery-paused/);
console.log('V1.982 PASS: customer, merchant, admin, paused stays and mobile visual classes. No financial mutation.');
