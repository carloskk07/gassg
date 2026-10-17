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
assert.ok(home.includes('conciseHome?\`<section class="home-buying-steps"')||
  home.includes('conciseHome?\`<section class="home-buying-steps"'.replace('\\','')),
  'compact buying guide must appear only in first-visit condition');
assert.ok(home.includes('home-buying-steps-list'));
assert.ok(home.includes('Gás, água ou outros essenciais, sem item obrigatório.'));
assert.ok(home.includes('O pedido só avança após o aceite da revenda.'));
assert.ok(home.indexOf('id="home-discover"')<home.indexOf('home-buying-steps"'),
 'buying guide should follow product discovery, not displace the lead CTA');
assert.ok(home.indexOf('home-buying-steps"')<home.indexOf('homeRegionalPriceBoard(homeRegion)'),
 'buyer guide should precede the regional price panel');
assert.ok(home.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
 'verified price evidence cannot be weakened');
assert.ok(home.includes("const primaryAction=acquisitionOpen?'homeDiscoverFocus()':'startCustomerAvailability()'"),
 'public customer entry continues to use vetted order flows');

const sponsorStart=growth.indexOf('function sponsorsLanding(){');
const merchantStart=growth.indexOf('\nfunction merchantsLanding(){',sponsorStart);
const sponsor=growth.slice(sponsorStart,merchantStart);
assert.ok(sponsorStart>=0&&merchantStart>sponsorStart);
const sponsorEnv=vm.createContext({shell:html=>html});
vm.runInContext(sponsor+'\nthis.getPage=sponsorsLanding;',sponsorEnv);
const html=sponsorEnv.getPage();
for(const key of ['sponsor-hero-layout','sponsor-hero-copy','sponsor-visual-story',
 'sponsor-visual-feature','sponsor-visual-details','CONCEITO ILUSTRATIVO',
 'Não é campanha ativa','aria-label="Ilustração de uma proposta']){
 assert.ok(html.includes(key),'sponsor story lacks '+key);
}
assert.ok(html.indexOf('sponsor-hero-copy')<html.indexOf('sponsor-visual-story'));
assert.equal((html.match(/class="sponsor-visual-story"/g)||[]).length,1);
for(const format of ['visibility','relationship','local']){
 assert.ok(html.includes("openSponsorContact('"+format+"')"),
  'every campaign format must retain the real sponsor lead');
}
assert.ok(html.includes('openSponsorContact()'));
assert.ok(!/clientes garantidos|mais de [0-9]+ mil|resultados garantidos/i.test(html));
const merchantEnd=growth.indexOf('\nfunction merchantJoin(){',merchantStart);
const merchant=growth.slice(merchantStart,merchantEnd);
assert.ok(merchant.includes('merchant-visual-economy'));
assert.ok(merchant.includes('TAXA POR PEDIDO CONCLUÍDO'));
assert.ok(merchant.includes('${merchantFeeLabel}'),
 'merchant hero must display the policy-derived rate, not a hard-coded fee');
assert.ok(merchant.includes('Sem mensalidade'));
assert.ok(merchant.includes('Visão ilustrativa dos recursos.'));
assert.ok(merchant.includes('openPrelaunchMerchantLead()'),
 'merchant enrollment remains the same controlled flow');
assert.ok(merchant.includes('merchant-margin')&&merchant.includes('merchant-how'),
 'existing calculator and how-it-works destinations must remain');

for(const name of ['.home-buying-steps-list','.sponsor-visual-story',
 '.sponsor-hero-layout','.merchant-visual-economy',
 '@media(max-width:1000px)','@media(max-width:620px)',
 '@media(max-width:370px)']){
 assert.ok(css.includes(name),'responsive styles missing '+name);
}
console.log('TAMÃO V1.372 PASS — accurate visitor guidance and campaign/merchant storytelling.');
