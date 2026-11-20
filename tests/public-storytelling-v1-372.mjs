import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js');
const growth=read('js/growth.js');
const css=read('css/marketing-premium.css');
for(const [name,source] of Object.entries({customer,growth})){
  new vm.Script(source,{filename:name+'.js'});
}
const home=customer.slice(customer.indexOf('function home(){'),
  customer.indexOf('\nfunction orderPage(){'));
assert.ok(home.length>10000);
assert.ok(home.includes('if(!testDemo&&!internalPilot)return shell('),
 'Real visitor receives condensed quote-first layout');
assert.ok(home.indexOf('homeRegionalPriceBoard(homeRegion)')<
 home.indexOf('class="home-discover tamao-home-catalog"'));
assert.ok(home.indexOf('class="home-discover tamao-home-catalog"')<
 home.indexOf('tamaoDiscoveryEntryHub()}'));
assert.ok(home.includes('tamaoHomeBenefits({compact:true})'),
 'Clube and Rede stay present once, in concise format');
assert.ok(home.includes('acquisitionOpen?prelaunchCustomerLeadSection()'),
 'Availability lead remains only when necessary');
assert.ok(!home.includes('conciseHome?\`<section class="home-buying-steps"'),
 'Old duplicate buying lecture must be removed from the home bundle');
assert.ok(home.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
 'verified price evidence cannot be weakened');
assert.ok(home.includes("const primaryAction=acquisitionOpen?'homeDiscoverFocus()':'startCustomerAvailability()'"),
 'public customer entry continues to use vetted order flows');

const sponsor=read('js/sponsors-premium.js');
assert.match(growth,/function sponsorsLanding\(\)/);
assert.match(growth,/sponsors-premium\.js/);
const sponsorEnv=vm.createContext({shell:html=>html,globalThis:{
 tamaoAdsPlannerLoad:()=>{},
 tamaoAdsPlannerSection:()=>'<section id="real-sponsored-manager"></section>'
}});
vm.runInContext(sponsor+'\nthis.getPage=sponsorsLandingPremium;',sponsorEnv);
const html=sponsorEnv.getPage();
for(const key of ['sponsor-hero-layout','sponsor-hero-copy','sponsor-premium-visual',
 'sponsor-premium-ad-mock','PUBLICIDADE IDENTIFICADA',
 'Apresentação ilustrativa, não é anúncio publicado.',
 'inventário disponível','aria-label="Prévia ilustrativa de anúncio identificado"',
 'sponsor-premium-faq','real-sponsored-manager']){
 assert.ok(html.includes(key),'sponsor story lacks '+key);
}
assert.ok(html.indexOf('sponsor-hero-copy')<html.indexOf('sponsor-premium-visual'));
assert.equal((html.match(/class="sponsor-premium-visual"/g)||[]).length,1);
for(const format of ['visibility','relationship','local']){
 assert.ok(html.includes("openSponsorContact('"+format+"')"),
  'every campaign format must retain the real sponsor lead');
}
assert.ok(html.includes('openSponsorContact()'));
assert.ok(!/clientes garantidos|mais de [0-9]+ mil|resultados garantidos/i.test(html));
const sponsorStart=growth.indexOf('function sponsorsLanding(){');
const merchantStart=growth.indexOf('\nfunction merchantsLanding(){',sponsorStart);
assert.ok(sponsorStart>=0&&merchantStart>sponsorStart);
const merchantEnd=growth.indexOf('\nfunction merchantJoin(){',merchantStart);
const merchant=growth.slice(merchantStart,merchantEnd);
assert.ok(merchant.includes('merchant-visual-economy'));
assert.ok(merchant.includes('TAXA POR PEDIDO CONCLUÍDO'));
assert.ok(merchant.includes('${merchantFeeLabel}'),
 'merchant hero must display the policy-derived rate, not a hard-coded fee');
assert.ok(merchant.includes('Sem mensalidade'));
assert.ok(merchant.includes('Visão ilustrativa dos recursos.'));
assert.ok(merchant.includes('openMerchantPortal(true)'),
 'merchant enrollment opens the live partner registration');
assert.ok(merchant.includes('merchant-margin')&&merchant.includes('merchant-how'),
 'existing calculator and how-it-works destinations must remain');

for(const name of ['.home-buying-steps-list',
 '.merchant-visual-economy',
 '@media(max-width:1000px)','@media(max-width:620px)',
 '@media(max-width:370px)']){
 assert.ok(css.includes(name),'responsive styles missing '+name);
}
const premiumCss=read('css/public-ux.css');
for(const cls of ['.sponsor-premium-visual','.sponsor-premium-v1090 .sponsor-hero-layout',
 '@media(max-width:700px)','@media(max-width:410px)'])
 assert.ok(premiumCss.includes(cls),'Missing new premium sponsor responsive CSS '+cls);
console.log('TAMÃO V1.372 PASS — accurate visitor guidance and campaign/merchant storytelling.');
