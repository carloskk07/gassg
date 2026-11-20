import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const growth=read('js/growth.js');
const planner=read('js/ads-planner.js');
const css=read('css/public-ux.css');
const boot=read('js/bootstrap.js');
const premium=read('js/sponsors-premium.js');
assert.match(growth,/function sponsorsLanding\(\)/);
assert.match(growth,/sponsors-premium\.js/);
assert.match(premium,/globalThis\.tamaoSponsorPremiumLanding=sponsorsLandingPremium/);
let mounted=0;
let scrolled='',focused='';
const targets=Object.fromEntries(['sponsor-formats','sponsor-pricing','sponsor-faq'].map(id=>[id,{
  scrollIntoView:options=>{scrolled=id;assert.ok(['smooth','auto'].includes(options.behavior))},
  focus:()=>{focused=id}
}]));
const sponsorCtx=vm.createContext({
  shell:html=>html,
  document:{getElementById:id=>targets[id]||null},
  globalThis:{matchMedia:()=>({matches:false}),
    tamaoAdsPlannerLoad:()=>{mounted++},
    tamaoAdsPlannerSection:()=>'<section id="real-advertiser-form">Existing live campaign manager</section>'
  }
});
vm.runInContext(premium+';this.premium=sponsorsLandingPremium;this.jump=sponsorJumpTo;',sponsorCtx);
const html=sponsorCtx.premium();
assert.equal(mounted,1,'Deferred live planner must still be loaded');
for(const marker of [
 'sponsor-premium-hero','PUBLICIDADE LOCAL NO TAMÃO','Sua marca merece',
 'Criar meu anúncio','sponsor-premium-ad-mock',
 'Prévia de anúncio','Apresentação ilustrativa, não é anúncio publicado',
 'PUBLICIDADE IDENTIFICADA','Sem precisar ter revenda',
 'sponsor-premium-trust-rail','sponsor-premium-value-grid',
 'sponsor-format-grid','sponsor-premium-steps','id="sponsor-pricing"',
 'real-advertiser-form','sponsor-premium-faq-list','sponsor-premium-closing',
 'inventário disponível','Não prometemos audiência','não gera cobrança'
])assert.ok(html.includes(marker),'Missing premium and truthful section: '+marker);
assert.ok(html.indexOf('sponsor-premium-hero')<html.indexOf('sponsor-formats'),
 'Advertiser value should come before format choices');
assert.ok(html.indexOf('sponsor-formats')<html.indexOf('id="sponsor-pricing"'),
 'Full technical planner must not precede the value story');
assert.ok(html.indexOf('id="sponsor-pricing"')<html.indexOf('sponsor-premium-faq'),
 'FAQ should follow the real path to create campaigns');
assert.equal((html.match(/<h1\b/g)||[]).length,1);
assert.equal((html.match(/<details\b/g)||[]).length,5);
for(const kind of ['visibility','relationship','local'])
 assert.equal(html.split("openSponsorContact('"+kind+"')").length-1,1,
   'Exactly one clear CTA per eligible partnership objective');
assert.equal(html.split('openSponsorContact()').length-1,1,
 'One general commercial contact instead of repeated detours');
assert.ok(!html.includes('milhares de pessoas'),'No fictitious audience');
assert.ok(!html.includes('resultados garantidos'),'No fictitious outcomes');
assert.equal(sponsorCtx.jump('sponsor-pricing'),true);
assert.equal(scrolled,'sponsor-pricing');
assert.equal(focused,'sponsor-pricing');
assert.equal(sponsorCtx.jump('unexpected'),false,'Unreviewed jump identifiers are rejected');

const fields=new Map([
 ['sponsor-cpm-budget',{value:'4990'}],
 ['sponsor-cpm-days',{value:'15'}],
 ['sponsor-cpm-result',{textContent:''}],
 ['sponsor-cpm-city',{value:'São Gabriel'}],
 ['sponsor-cpm-state',{value:'RS'}]
]);
const budgets=[1990,4990,9990,19990].map(v=>({
 v,pressed:'false',selected:false,
 getAttribute:key=>key==='data-sponsor-budget'?String(v):null,
 setAttribute(key,value){if(key==='aria-pressed')this.pressed=value},
 classList:{toggle(){}}
}));
const adCtx=vm.createContext({
 document:{
  getElementById:id=>fields.get(id)||null,
  querySelectorAll:query=>query==='[data-sponsor-budget]'?budgets:[]
 },
 globalThis:{liveReady:()=>false,liveRuntime:{session:null}},
 console
});
vm.runInContext(planner+
 ';this.planner=tamaoAdsPlannerSection;this.choose=tamaoAdsChooseBudget;this.preview=tamaoAdsBudgetPreview;',adCtx);
const adHtml=adCtx.planner();
assert.match(adHtml,/sponsor-budget-choices/);
assert.match(adHtml,/sponsor-budget-method/);
assert.match(adHtml,/Como funcionam a medição e a cobrança/);
assert.match(adHtml,/sponsor-ad-live-slot/);
assert.match(adHtml,/sponsor-account-email/,'Actual independent advertiser sign-in remains in the planner');
for(const price of ['R$ 19,90','R$ 49,90','R$ 99,90','R$ 199,90'])
 assert.ok(adHtml.includes(price),'Missing real budget choice: '+price);
assert.equal((adHtml.match(/data-sponsor-budget="/g)||[]).length,4);
assert.equal(adCtx.choose(1990),true);
assert.equal(fields.get('sponsor-cpm-budget').value,'1990');
assert.equal(fields.get('sponsor-cpm-days').value,'7');
assert.equal(budgets[0].pressed,'true');
assert.equal(budgets[1].pressed,'false');
assert.match(fields.get('sponsor-cpm-result').textContent,/1\.658 visualizações verificadas/);
assert.equal(adCtx.choose(12345),false);
assert.equal(fields.get('sponsor-cpm-budget').value,'1990','Invalid budget must not change real selection');
assert.equal(adCtx.preview(4990).chargeEnabled,false,'Planner must not create payment');
assert.equal(adCtx.preview(4990).guaranteedViews,0,'Planner must not promise delivery');
for(const key of [
 '.sponsor-premium-v1090 .sponsor-premium-hero',
 '.sponsor-premium-v1090 .sponsor-hero-layout',
 '.sponsor-premium-v1090 .sponsor-format-grid',
 '.sponsor-premium-workspace .sponsor-budget-choice',
 '.sponsor-premium-faq-list details',
 '@media(max-width:700px)',
 '@media(max-width:410px)',
 ':focus-visible',
 '@media(prefers-reduced-motion:reduce)'
])assert.ok(css.includes(key),'Premium layout must remain accessible/responsive: '+key);
assert.match(boot,/sponsors:\['Anuncie no TAMÃO — Publicidade local'/);
assert.match(read('.github/workflows/audit.yml'),/tests\/sponsor-premium-v1-1090\.mjs/);
console.log('PASS V1.1090: high-trust sponsor landing, truthfully labeled preview, real budget controls, live campaign flow and responsive accessible design.');
