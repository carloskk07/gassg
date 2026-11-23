import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('index.html');
const visual=read('css/visual-finish.css');
const customer=read('js/customer.js');
const learn=read('js/learn-premium.js');
const sponsors=read('js/sponsors-premium.js');
const agenda=read('js/agenda-design.js');
const agendaCSS=read('css/agenda-design.css');
const couponShop=read('js/clube-coupon-shop.js');
const club=read('js/club-premium.js');
const earn=read('js/earn-premium.js');

for(const [file,code] of [['js/customer.js',customer],['js/agenda-design.js',agenda],['js/sponsors-premium.js',sponsors]]){
 new vm.Script(code,{filename:file});
}
assert.match(html,/<link rel="preload" as="style" href="\.\/css\/visual-finish\.css"/);
assert.match(html,/onload="this\.onload=null;this\.rel='stylesheet'"/);
assert.match(visual,/--vf-ticket:|--vf-wallet:|--vf-calendar:|--vf-shield:/);
assert.match(visual,/data:image\/svg\+xml/);
assert.match(visual,/-webkit-mask:var\(--vf-symbol/);
for(const selector of [
 '.tamao-quick-path-icon','.tamao-benefit-emoji','.visitor-path-icon',
 '.tamao-home-service .intent-icon','.tamao-home-coupon-icon',
 '.sponsor-premium-format-icon','.learn-premium .learn-benefit-symbol',
 '.tamao-network-connections','.tamao-coupon-banner-tags',
 '.sponsor-placement-faux-products','.sponsor-placement-faux-lines'
])assert.ok(visual.includes(selector),'Missing finished brand icon treatment '+selector);
assert.ok(!html.includes('🎟️ Cupons</span>'),'Legacy home Club icon should not be emoji');
assert.ok(!html.includes('💚 Cashback</span>'),'Legacy cashback icon should not be emoji');
assert.ok(!html.includes('🤝 Indicações</span>'),'Legacy Rede icon should not be emoji');
assert.ok(!html.includes('tamao-coupon-banner-sticker">💚'),'Legacy coupon scene sticker should not be emoji');
assert.ok(!customer.includes('🎟️ Cupons, cashback e Clube'),'Old Club shortcut emoji still present');
assert.ok(!customer.includes('🔥 Gás</button>'),'Legacy category emoji still present');
assert.ok(!customer.includes('💧 Água</button>'),'Legacy category emoji still present');

assert.match(sponsors,/Produtos e serviços<\/span><span>Atendimento local/);
assert.match(sponsors,/Marca identificada<\/span><span>Região definida/);
assert.doesNotMatch(sponsors,/sponsor-placement-faux-products" aria-hidden="true"><span><\/span>/);
assert.doesNotMatch(sponsors,/sponsor-placement-faux-lines" aria-hidden="true"><span><\/span>/);
assert.match(sponsors,/PUBLICIDADE/);
assert.match(sponsors,/A posição, a duração e a veiculação efetiva dependem de inventário/);
assert.match(learn,/learn-benefit-club/);
assert.match(learn,/learn-benefit-network/);

assert.doesNotMatch(agenda,/agenda-premium-photo-fallback" aria-hidden="true">✦/);
assert.doesNotMatch(agenda,/agenda-premium-avatar" aria-hidden="true">✦/);
assert.doesNotMatch(agenda,/agenda-design-live-image" aria-hidden="true">✦/);
assert.doesNotMatch(agenda,/agenda-premium-symbol" aria-hidden="true">✦/);
assert.match(agenda,/safe\(String\(item.name\|\|'P'\)/);
assert.match(agenda,/safe\(String\(p.title\|\|'A'\)/);
assert.match(agendaCSS,/agenda-premium-photo-fallback::before/);
assert.match(agendaCSS,/agenda-premium-photo-fallback::after/);
assert.match(agendaCSS,/agenda-design-live-image::before/);
assert.match(agendaCSS,/agenda-premium-avatar,.agenda-design-live-avatar/);
assert.match(agendaCSS,/ATENDIMENTO COM HORA MARCADA/);

// All changes are presentational: real catalog and financial paths remain present.
for(const required of ['clubeCouponShopPanel','clubeCouponBuy','clubeCouponRefundAsk'])
 assert.ok(couponShop.includes(required),'Coupon financial code changed unexpectedly: '+required);
for(const required of ['clubPremiumPage','clubePaidCouponPanel','data-coupon-price'])
 assert.ok(club.includes(required),'Real Club logic still required: '+required);
assert.match(earn,/earnPremiumUpdateEstimate/);
console.log('V1.1165 PASS — global visual finish, honest ad previews, branded Agenda fallback and preserved Club/Rede contracts');
