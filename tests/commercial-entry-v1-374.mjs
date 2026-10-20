import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const growth=read('js/growth.js');
const acquisition=read('js/acquisition.js');
const css=read('css/marketing-premium.css');
new vm.Script(growth,{filename:'growth.js'});
new vm.Script(acquisition,{filename:'acquisition.js'});

const first=growth.indexOf('function sponsorsLanding(){');
const second=growth.indexOf('function merchantsLanding(){',first);
const end=growth.indexOf('\nfunction merchantJoin(){',second);
assert.ok(first>=0&&second>first&&end>second);
const sponsor=growth.slice(first,second);
const merchant=growth.slice(second,end);

// First-fold sponsor selection gives a human-scale goal instead of requiring
// visitors to read the entire page. Every button uses the existing safe contact.
const sponsorSandbox=vm.createContext({shell:x=>x});
vm.runInContext(sponsor+'\nthis.page=sponsorsLanding;',sponsorSandbox);
const sponsorHtml=sponsorSandbox.page();
const heroEnd=sponsorHtml.indexOf('public-sponsor-selector-intro');
assert.ok(heroEnd>0);
const hero=sponsorHtml.slice(0,heroEnd);
assert.ok(hero.includes('sponsor-intent-quick'));
assert.ok(hero.includes('aria-label="Escolha o tipo de parceria para sua marca"'));
assert.ok(hero.includes('Escolha seu objetivo e envie sua proposta'));
for(const intent of ['visibility','relationship','local']){
  assert.ok(hero.includes("openSponsorContact('"+intent+"')"),'hero missing '+intent);
  assert.ok(sponsorHtml.includes("openSponsorContact('"+intent+"')"),
   'original detailed sponsor formats must remain: '+intent);
}
assert.ok(hero.includes('openSponsorContact()'),'generic contact also available');
assert.ok(sponsorHtml.includes('sponsor-visual-story'),'conceptual visual remains');
assert.ok(sponsorHtml.includes('EXEMPLO DE FORMATO'),'example labeling remains');
assert.ok(!/resultados garantidos|milhares de clientes garantidos/i.test(sponsorHtml));

// Merchant onboarding starts immediately after commercial proposition,
// without removing the information sections or bypassing internal-only logic.
assert.ok(merchant.indexOf('merchant-landing-premium')>=0);
const conversion=merchant.indexOf('merchant-conversion-start');
assert.ok(conversion>merchant.indexOf('merchant-landing-premium'));
assert.ok(conversion<merchant.indexOf('public-page-jump-rail'));
assert.match(merchant,/<details class="merchant-secondary-lead" open>/,
  'minimal advertiser form must be expanded on first visit, not behind an extra click');
assert.ok(merchant.includes('Quero anunciar meu comércio com nome e WhatsApp'),
  'inquiry CTA must explain simple signup');
assert.ok(merchant.includes('openMerchantPortal(true)'),
  'optional full operational signup must remain available');
assert.ok(conversion<merchant.indexOf('merchant-cro-steps'));
assert.ok(conversion<merchant.indexOf('id="merchant-margin"'));
assert.equal((merchant.match(/prelaunchMerchantLeadSection\(\)/g)||[]).length,1,
 'existing interest form must render once');
assert.ok(merchant.includes("internalPilot?'':`<section class=\"merchant-conversion-start\""),
 'internal-only mode must never show live interest form');
assert.ok(merchant.includes('openMerchantPortal(true)'),'main CTA opens actual signup');
assert.ok(merchant.includes('policyPercent(merchantPilotFeeRate())'));
assert.ok(merchant.includes('merchant-margin')&&merchant.includes('merchant-how'));
assert.ok(merchant.includes('Após habilitação'));
assert.ok(merchant.includes('O cliente paga diretamente à sua revenda'));

// Progressive disclosure reduces mobile clutter but retains every validation
// and personal-data consent gate. Native <details> works without JS.
const begin=acquisition.indexOf('function prelaunchMerchantLeadSection(){');
const finish=acquisition.indexOf('function openPrelaunchMerchantLead(){',begin);
assert.ok(begin>=0&&finish>begin);
const formFn=acquisition.slice(begin,finish);
const formSandbox=vm.createContext({prelaunchLeadSent:()=>false});
vm.runInContext(formFn+'\nthis.page=prelaunchMerchantLeadSection;',formSandbox);
const form=formSandbox.page();
for(const field of ['partner-business','partner-name','partner-phone',
 'partner-postal','partner-note','partner-consent','partner-submit',
 'partner-website','name="partner-interest"']){
 assert.ok(form.includes(field),'legacy field or guard missing: '+field);
}
assert.ok(form.includes('merchant-lead-form-head'));
const collapsed=form.indexOf('<details class="merchant-lead-options">');
const firstEnd=form.indexOf('</details>',collapsed);
const secondOption=form.indexOf('<details class="merchant-lead-options">',firstEnd+10);
const secondEnd=form.indexOf('</details>',secondOption);
assert.ok(collapsed>0&&firstEnd>collapsed&&secondOption>firstEnd&&secondEnd>secondOption);
assert.ok(form.indexOf('partner-name')>collapsed&&form.indexOf('partner-name')<firstEnd);
assert.ok(form.indexOf('name="partner-interest"')>collapsed&&form.indexOf('name="partner-interest"')<firstEnd);
assert.ok(form.indexOf('partner-postal')>secondOption&&form.indexOf('partner-postal')<secondEnd);
assert.ok(form.indexOf('partner-note')>secondOption&&form.indexOf('partner-note')<secondEnd);
assert.ok(form.indexOf('partner-phone')<collapsed);
assert.ok(form.indexOf('partner-consent')>secondEnd);
assert.ok(!acquisition.includes("if(!interests.length)return prelaunchMerchantFieldError('partner-interest-categories'"),
 'advertiser categories are optional at first contact');
assert.ok(!acquisition.includes("if(contactName.length<2)return prelaunchMerchantFieldError('partner-name'"),
 'personal contact name is optional');
assert.ok(acquisition.includes("if(!consent)return prelaunchMerchantFieldError('partner-consent'"));
assert.ok(acquisition.includes("leadType:'merchant'"),'lead still uses server onboarding');

// Narrow screens and keyboard navigation must remain supported.
for(const token of ['.merchant-conversion-start','.merchant-lead-options',
 '.sponsor-intent-quick','.sponsor-intent-quick button:focus-visible',
 '@media(max-width:620px)','@media(max-width:370px)',
 '@media(prefers-reduced-motion:reduce)']){
 assert.ok(css.includes(token),'missing responsive/accessibility rule '+token);
}
console.log('TAMÃO V1.374 PASS — merchant form first, optional-only collapse, sponsor objective CTA and preserved authorization.');
