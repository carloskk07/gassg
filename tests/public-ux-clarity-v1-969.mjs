import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),home=read('js/home-showcase.js');
const customer=read('js/customer.js'),growth=read('js/growth.js');
const mobility=read('js/mobility.js'),merchant=read('js/merchant.js');
const mobCss=read('css/mobility.css'),css=read('css/public-ux.css');
const boot=read('js/bootstrap.js'),audit=read('.github/workflows/audit.yml');
assert.match(boot,/tamaoEnsurePublicExperienceStyles\(r\)/,
 'Route-specific CSS must load when Club, Network, Sponsors or Team are rendered');
assert.match(boot,/\['home','order','tracking','learn','club','earn','refer','merchants','sponsors','professionals','rides','stays','mobility','advertise','merchant-join','merchant-team','contact'\]/);
assert.match(boot,/css\/public-ux\.css/);
assert.match(read('sw.js'),/\.\/css\/public-ux\.css/,
 'The route-specific style must remain available in the PWA offline snapshot');
assert.doesNotMatch(read('css/marketing-premium.css'),/tamao-club-visitor-focus/,
 'New route-specific styles must not regress the eager Home CSS budget');

for(const [name,code] of [['core',core],['home-showcase',home],['growth',growth],
 ['customer',customer],['mobility',mobility],['merchant',merchant]])
 new vm.Script(code,{filename:name+'.js'});
assert.match(audit,/node tests\/public-ux-clarity-v1-969\.mjs/);

// A paused service cannot compete with working services in global navigation,
// but direct links must keep the accurate unavailability explanation.
const shell=core.slice(core.indexOf('function siteFooter('),core.indexOf('function bottomNav('));
assert.doesNotMatch(shell,/(\['stays','Hospedagens'|go\(\\'stays\\'\))/);
assert.doesNotMatch(shell,/\['home','Produtos'\]/,'header commerce CTA replaces redundant product link');
assert.match(shell,/\['earn','Indicações'\]/);
assert.match(shell,/label:'Serviços'/);
assert.match(shell,/label:'Conheça'/);
assert.match(shell,/\['mobility','Moto e carro'\]/);
assert.match(shell,/\['club','Clube'\]/);
assert.match(boot,/stays:typeof discoveryPage/);
assert.match(read('js/discovery.js'),/Hospedagens temporariamente indisponíveis/);

// The no-offer market must start with the product action and never advertise
// prices or create payment merely because a user browsed.
const quoteCtx=vm.createContext({
 globalThis:{liveRuntime:{},liveReady:()=>false},
 products:{P13:{name:'Botijão 13 kg',hidden:false}},
 state:{cart:{}},
 BRL:{format:n=>'R$ '+Number(n).toFixed(2)},
 esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('&','&amp;'),
 customerProductName:(_,product)=>product?.name||''
});
vm.runInContext(home+';this.quote=homeRegionalPriceBoard;',quoteCtx);
let quote=quoteCtx.quote({city:'São Gabriel',state:'RS'});
assert(quote.indexOf('class="city-price-controls"')<quote.indexOf('class="city-price-empty"'),
 'the product action must precede the empty market explanation');
assert.match(quote,/pedido só avança com uma revenda e um preço confirmados/);
assert.doesNotMatch(quote,/tamao-home-coupon-rail|Ver cupons e Clube/,
 'a separately placed campaign must not repeat in the quote');
assert.match(quote,/onclick="homeDiscoverFocus\(\)">Ver produtos/);
assert.doesNotMatch(quote,/R\$ 115/);
assert.match(customer,/homeRegionalPriceBoard\(homeRegion\)/);
assert.match(customer,/\$\{couponBanner\}/);

// Public Club displays exactly one verified offer card beside a compact hero,
// never hardcoded paid packages or a Pix button for unverified visitors.
const clubStart=growth.indexOf('function club(){');
const clubEnd=growth.indexOf('  const purchases=',clubStart);
assert(clubStart>=0&&clubEnd>clubStart);
const guestSrc=growth.slice(clubStart,clubEnd)+'  return "";}\nthis.club=club;';
const guestCtx=vm.createContext({globalThis:{document:null,liveReady:()=>false,
 __CHAMA_TEST__:false},shell:x=>x});
vm.runInContext(guestSrc,guestCtx);
const guest=guestCtx.club();
assert.match(guest,/tamao-club-visitor-focus/);
assert.match(guest,/tamao-coupon-price-board card form-stack" hidden/);
assert.match(guest,/data-coupon-price/);
assert.match(guest,/data-coupon-face/);
assert.match(guest,/onsubmit="return tamaoWelcomeRegister\(event\)"/);
assert.equal((guest.match(/tamao-coupon-price-board card form-stack/g)||[]).length,1);
assert.doesNotMatch(guest,/R\$\s*8,90|onclick="clubeCouponBuy/);
assert.match(guest,/Ter um pacote não garante ofertas ou revendas disponíveis/);

// One referral choice rail and two transparent economic examples, without
// a redundant four-card editorial benefit grid and extra CTAs.
const earnStart=growth.indexOf('function earn(){'),earnEnd=growth.indexOf('\nfunction learn(){',earnStart);
const earnSrc=growth.slice(earnStart,earnEnd);
const econCtx=vm.createContext({
 merchantEconomicsExample:()=>({fee:9,merchantNet:111}),
 referralPilotRate:()=>.02,merchantPilotFeeRate:()=>.075,
 policyPercent:n=>(n*100).toFixed(1)+'%',
 referralExample:n=>n*.02,BRL:{format:n=>'R$ '+Number(n).toFixed(2)},
 shell:x=>x
});
vm.runInContext(earnSrc+';this.earn=earn;',econCtx);
const earnHtml=econCtx.earn();
assert.equal((earnHtml.match(/class="tamao-cro-paths"/g)||[]).length,1);
assert.equal((earnHtml.match(/class="opportunity-card /g)||[]).length,2);
assert.equal((earnHtml.match(/tamao-benefit-guide-card/g)||[]).length,0);
assert.doesNotMatch(earnHtml,/growth-network-intro|SUAS VANTAGENS, DO SEU JEITO/);
assert.match(earnHtml,/habilitação comercial/);
assert.match(earnHtml,/primeira compra qualificada/);
assert.match(earnHtml,/go\('refer'\)/);
assert.match(earnHtml,/go\('club'\)/);
assert.match(earnHtml,/go\('merchants'\)/);

// Sponsors: three objectives exactly once, plus one contact entry.
// The existing live planner remains in place and no revenue is invented.
const spStart=growth.indexOf('function sponsorsLanding(){');
const spEnd=growth.indexOf('\nfunction merchantsLanding(){',spStart);
const spSrc=growth.slice(spStart,spEnd);
const sponsorCtx=vm.createContext({shell:x=>x,globalThis:{
 tamaoAdsPlannerLoad:()=>{},tamaoAdsPlannerSection:()=>'<div id="verified-public-planner"></div>'
}});
vm.runInContext(spSrc+';this.sponsors=sponsorsLanding;',sponsorCtx);
const sponsors=sponsorCtx.sponsors();
assert.match(sponsors,/verified-public-planner/);
assert.match(sponsors,/sponsor-format-grid/);
assert.doesNotMatch(sponsors,/sponsor-intent-quick|tamao-sponsor-footer/);
for(const goal of ['visibility','relationship','local']){
 assert.equal(sponsors.split("openSponsorContact('"+goal+"')").length-1,1,
  'do not render duplicate CTAs for '+goal);
}
assert.match(sponsors,/openSponsorContact\(\)/);
assert.match(sponsors,/inventário disponível/);

// A protected team state should never strand a new partner on an empty page.
assert.match(merchant,/Acesse sua revenda para gerenciar a equipe/);
assert.match(merchant,/Entrar no painel da revenda →/);
assert.match(merchant,/onclick="go\(\\'merchant\\'\)">Entrar no painel da revenda/);
for(const part of ['.mobility-provider-card', '.mobility-access-layout',
 '.mobility-driver-panel','@media(max-width:760px)',':focus-visible'])
 assert(mobCss.includes(part),'missing accessible mobility design '+part);
for(const part of ['.tamao-club-visitor-focus',
 '.tamao-network-clarity','.merchant-team-access','@media(max-width:600px)'])
 assert(css.includes(part),'missing responsive public experience '+part);
const mobilityStart=mobility.indexOf('function mobilityPage(){');
const mobilityEnd=mobility.indexOf('\nfunction ',mobilityStart+1);
const mobilityPage=mobility.slice(mobilityStart,mobilityEnd);
assert.match(mobilityPage,/Encontrar mototaxista/);
assert.match(mobilityPage,/Encontrar motorista/);
assert.match(mobilityPage,/mobility-provider-card/);
assert.match(mobilityPage,/mobility-driver-panel/);
assert.match(mobilityPage,/mobilityLogin\(event\)/);
assert.doesNotMatch(mobilityPage,/<iframe[^>]*src="https?:\/\//);

// The Admin's public-facing status strip must not imply orders are live just
// because the platform mode is LIVE. Only the independent server gate decides.
const adminSrc=read('js/admin.js');
const opStart=adminSrc.indexOf('function adminOperationModeLabel(');
const opEnd=adminSrc.indexOf('function adminExecutiveKpi(',opStart);
assert.ok(opStart>0&&opEnd>opStart,'Admin operational summary functions must exist');
const opCtx=vm.createContext({
 adminBillingE2EState:()=>({validated:false}),
 adminBillingProviderName:()=> 'Mercado Pago',
 adminRuntime:{providerHealth:{ok:true},lastSyncAt:'2026-11-12T12:00:00Z'},
 adminRelativeTime:()=> 'agora',
 esc:value=>String(value)
});
vm.runInContext(adminSrc.slice(opStart,opEnd)+'\nthis.renderStrip=adminOperationalStrip;',opCtx);
const baseOps={merchantBilling:{paymentIngress:{}},incidents:[]};
const closed=opCtx.renderStrip({...baseOps,launchReadiness:{
 operationMode:'LIVE',commerceEnabled:false,securityBlockers:[],unresolvedWarnings:[]
}});
assert.match(closed,/PLATAFORMA ATIVA/);
assert.match(closed,/PEDIDOS NÃO HABILITADOS/);
assert.match(closed,/admin-ops-strip warning/,
 'zero operational blockers must not represent disabled commerce as green');
assert.doesNotMatch(closed,/<strong>LIVE<\/strong>/,
 'the technical LIVE flag alone does not authorize sales');
const eligible=opCtx.renderStrip({...baseOps,launchReadiness:{
 operationMode:'LIVE',commerceEnabled:true,securityBlockers:[],unresolvedWarnings:[]
}});
assert.match(eligible,/COMÉRCIO HABILITADO/);
assert.doesNotMatch(eligible,/PEDIDOS NÃO HABILITADOS/);
const unknown=opCtx.renderStrip({...baseOps,launchReadiness:{
 operationMode:'LIVE',securityBlockers:[],unresolvedWarnings:[]
}});
assert.match(unknown,/COMÉRCIO NÃO VERIFICADO/,
 'unknown commercial status must not be interpreted as open');
const paused=opCtx.renderStrip({...baseOps,launchReadiness:{
 operationMode:'PAUSED',commerceEnabled:false,securityBlockers:[],unresolvedWarnings:[]
}});
assert.match(paused,/OPERAÇÃO PAUSADA/);
assert.doesNotMatch(adminSrc.slice(opStart,opEnd),/adminPerform\(|set-operation-mode/,
 'the operational summary must stay read-only');

console.log('V1.969 PASS — simpler public routes, real offers first, honest coupon access, no duplicate sales CTA, protected partner recovery and safe mobility.');
