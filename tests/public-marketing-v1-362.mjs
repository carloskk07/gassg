import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const growth=read('js/growth.js');
const core=read('js/core.js');
const index=read('index.html');
const sw=read('sw.js');
const css=read('css/marketing-premium.css');

// Syntax, route/CTA contract and truthful marketing, without remote services.
for(const [name,code] of Object.entries({customer,growth,core}))
  new vm.Script(code,{filename:name+'.js'});

const home=customer.slice(customer.indexOf('function home(){'),customer.indexOf('\nfunction orderPage(){'));
assert.ok(home.length>10000,'home implementation extracted');
for(const token of [
 'home-quick-category','homeDiscoverFocus();homeFilterProducts',
 'discoveryCounts.gas','discoveryCounts.water','discoveryCounts.other',
 'tamao-visitor-paths','visitor-path-buyer','visitor-path-merchant','visitor-path-network',
 "go('merchants')","go('earn')",'startHomeBrowse()',
 'homeRegionalPriceBoard(homeRegion)'
])assert.ok(home.includes(token),'home journey lacks '+token);
assert.ok(home.indexOf('home-discover-grid')<home.indexOf('homeRegionalPriceBoard(homeRegion)'),
 'verified regional price panel must follow product discovery');
assert.ok(home.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
 'marketing cannot display unverified city prices');
assert.ok(home.includes('home-first-visit'),
 'unserved markets must keep honest first-visit path');

const merchant=growth.slice(growth.indexOf('function merchantsLanding(){'),growth.indexOf('\nfunction merchantJoin(){'));
const sponsors=growth.slice(growth.indexOf('function sponsorsLanding(){'),growth.indexOf('\nfunction ',growth.indexOf('function sponsorsLanding(){')+1));
const learn=growth.slice(growth.indexOf('function learn(){'),growth.indexOf('\nfunction ',growth.indexOf('function learn(){')+1));
const earn=growth.slice(growth.indexOf('function earn(){'),growth.indexOf('\nfunction ',growth.indexOf('function earn(){')+1));
assert.ok(merchant.includes("openPrelaunchMerchantLead()"),'primary merchant lead remains');
assert.ok(merchant.includes('merchant-panel-link')&&merchant.includes('openMerchantPortal()'),
 'existing partners need direct access to their portal');
assert.ok(merchant.includes('Você continua no controle'),'merchant hero must state autonomy');
assert.ok(sponsors.includes('sponsor-format-grid')&&sponsors.includes('openSponsorContact()'),
 'sponsor choices and existing lead action are preserved');
assert.ok(sponsors.includes('depend')||sponsors.includes('avaliação'),
 'prospective campaign must not claim to be live');
assert.ok(earn.includes("go('refer')"),'customer referral path remains functional');
assert.ok(learn.includes('startHomeBrowse()')&&!learn.includes('onclick="startCustomerAvailability()"'),
 'buyer information page must start with an empty basket, never auto-add gas');
assert.ok(core.includes('const merchantAction=merchantPortal?"go(\'merchant\')":testDemo?"setMode(\'merchant\')":"go(\'merchants\')"'),
 'public Revenda switch must not jump over the marketing page');
assert.ok(index.includes('css/marketing-premium.css'),'browser loads the marketing stylesheet');
assert.ok(sw.includes('css/marketing-premium.css')&&sw.includes('home-showcase.js'),
 'offline visitor paths include all hero dependencies');
for(const token of [
 '.home-quick-category','.tamao-visitor-paths','.visitor-paths-grid',
 '.sponsor-format-grid','@media(max-width:620px)','prefers-reduced-motion',
 ':focus-visible'
])assert.ok(css.includes(token),'missing visual/responsive/accessibility rule '+token);
for(const selector of ['.home-trust-brief','.home-trust-answers','.home-notify-shortcut',
  '@media(max-width:850px)','@media(max-width:540px)']){
  assert.ok(css.includes(selector),'V1.363 responsive clarity element missing: '+selector);
}
// V1.364: public and mobile buyer entry must never force P13 into a cart.
assert.match(core,/\['order','🧺','Pedir','browse'\]/,
 'mobile order CTA must open product-first browsing');
assert.match(core,/act==='browse'\?"startHomeBrowse\(\)"/,
 'bottom nav click must preserve the basket and open the product chooser');
assert.match(core,/nav-btn-shop/,'buy action needs an identifiable mobile style');
assert.ok(home.includes("${!conciseHome?valueBridge:''}"),
 'unverified first visit must not repeat buyer-merchant-network cards');
assert.ok(home.includes('home-starter-neutral'),
 'unserved visitor sees neutral products rather than default gas');
assert.ok(home.includes("onclick=\"startHomeBrowse()\""),
 'verified region generic product CTA may not force P13');
for(const selector of ['.home-starter-neutral','.nav-btn-shop',
  '@media(max-width:370px)']){
  assert.ok(css.includes(selector),'missing V1.364 mobile conversion rule '+selector);
}
const learnCtas=learn.match(/onclick="startHomeBrowse\(\)"/g)||[];
assert.equal(learnCtas.length,2,'both educational CTAs must open the product chooser');
assert.ok(!learn.includes('onclick="startCustomerAvailability()"'),
 'educational pages must never pre-select a featured gas product');
assert.doesNotMatch(sponsors,/\d+[.,]?\d*% (?:de )?(?:conversão|alcance)|milhares de clientes/i,
 'no invented sponsorship results');


// V1.365: decisional shortcuts must target real sections and be keyboard-friendly.
assert.match(merchant,/merchant-jump-rail/);
assert.match(merchant,/publicLandingJump\('merchant-margin'\)/);
assert.match(merchant,/publicLandingJump\('merchant-how'\)/);
assert.match(merchant,/id="merchant-margin" tabindex="-1"/);
assert.match(merchant,/id="merchant-how" tabindex="-1"/);
assert.ok(merchant.includes('prelaunchMerchantLeadSection()'),'merchant lead component still renders');
assert.ok(read('js/acquisition.js').includes('id="partner-interest"'),'merchant lead section anchor must exist');
assert.match(learn,/buyer-jump-rail/);
assert.match(learn,/id="buyer-guide-steps" tabindex="-1"/);
assert.match(learn,/id="buyer-guide-questions" tabindex="-1"/);
for(const key of ['visibility','relationship','local'])
  assert.ok(sponsors.includes("openSponsorContact('"+key+"')"),'missing sponsor contact action '+key);
assert.match(sponsors,/public-sponsor-selector-intro/);
assert.ok(core.includes('sponsors'),'public sponsor route preserved');
const bootstrap=read('js/bootstrap.js');
assert.ok(bootstrap.includes('openSponsorContact,publicLandingJump,startOrder'),
 'public jump handler needs window exposure for inline route buttons');
for(const selector of ['.public-page-jump-rail','.public-sponsor-selector-intro',
  '.sponsor-format-grid article button','@media(max-width:480px)',
  'scroll-margin-top:100px']){
  assert.ok(css.includes(selector),'missing accessible marketing path styling: '+selector);
}
const jumpStart=growth.indexOf('function publicLandingJump(');
const jumpEnd=growth.indexOf('\nfunction club(){',jumpStart);
assert.ok(jumpStart>=0&&jumpEnd>jumpStart,'jump helper must exist');
const records={scrolled:[],focused:[]};
const validIds=new Set(['merchant-margin','merchant-how','buyer-guide-steps','buyer-guide-questions']);
const jumpContext=vm.createContext({
 document:{getElementById:id=>validIds.has(id)?{
  scrollIntoView:options=>records.scrolled.push([id,options.block,options.behavior]),
  focus:options=>records.focused.push([id,options.preventScroll])
 }:null},
 globalThis:{matchMedia:()=>({matches:true})}
});
vm.runInContext(growth.slice(jumpStart,jumpEnd)+'\nthis.jump=publicLandingJump;',jumpContext);
assert.equal(jumpContext.jump('merchant-margin'),true);
assert.equal(jumpContext.jump('buyer-guide-questions'),true);
assert.equal(jumpContext.jump('evil-selector'),false);
assert.deepEqual(records.scrolled.map(a=>a[0]),['merchant-margin','buyer-guide-questions']);
assert.ok(records.scrolled.every(a=>a[2]==='auto'),'reduced-motion system setting respected');
assert.ok(records.focused.every(a=>a[1]===true),'focus should follow scroll without a second scroll');
const sponsorStart=growth.indexOf('function openSponsorContact(');
const sponsorEnd=growth.indexOf('\nfunction ',sponsorStart+1);
assert.ok(sponsorStart>=0&&sponsorEnd>sponsorStart,'sponsor contact helper must exist');
const fields={kind:{value:''},message:{value:''},name:{focus:()=>{}}};
const sponsorCtx=vm.createContext({
 route:()=> 'contact',
 document:{
  getElementById:id=>id==='public-request-kind'?fields.kind:
   id==='public-request-message'?fields.message:
   id==='public-contact-name'?fields.name:null,
  querySelector:selector=>selector==='.public-contact-card'?{scrollIntoView:()=>{}}:null
 },
 globalThis:{contactKindChanged:()=>{}},go:()=>{throw Error('must remain on contact page')},
 setTimeout:()=>{throw Error('no route scheduling expected')}
});
vm.runInContext(growth.slice(sponsorStart,sponsorEnd)+'\nthis.sponsor=openSponsorContact;',sponsorCtx);
for(const [format,word] of [['visibility','divulgação identificada'],['relationship','benefícios'],['local','revendas']]){
 fields.message.value='';
 sponsorCtx.sponsor(format);
 assert.equal(fields.kind.value,'sponsor');
 assert.ok(fields.message.value.includes(word),'prefill must reflect '+format);
}
fields.message.value='Mensagem personalizada pelo visitante';
sponsorCtx.sponsor('visibility');
assert.equal(fields.message.value,'Mensagem personalizada pelo visitante',
 'sponsor CTA may never erase an existing customer draft');
assert.ok(!growth.includes('milhares de clientes garantidos'),
 'no fabricated reach may be introduced');

console.log('V1.365: public hero, visitor paths, partner access, sponsor clarity and mobile styling verified.');
