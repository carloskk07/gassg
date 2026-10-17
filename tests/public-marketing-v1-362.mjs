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
assert.doesNotMatch(sponsors,/\d+[.,]?\d*% (?:de )?(?:conversão|alcance)|milhares de clientes/i,
 'no invented sponsorship results');

console.log('V1.362: public hero, visitor paths, partner access, sponsor clarity and mobile styling verified.');
