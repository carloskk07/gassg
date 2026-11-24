import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const growth=read('js/growth.js');
const couponShop=read('js/clube-coupon-shop.js');
const premium=read('js/club-premium.js');
const css=read('css/club-premium.css');
const boot=read('js/bootstrap.js');
assert.match(growth,/import\('\/js\/clube-coupon-shop\.js'\)/);
assert.match(couponShop,/import\('\/js\/club-premium\.js\?v=1168'\)/);
assert.match(couponShop,/globalThis\.club=globalThis\.clubPremiumPage/);
assert.doesNotMatch(boot,/club-premium\.js/);
new vm.Script(premium,{filename:'club-premium.js'});
const ctx={
 globalThis:{liveReady:()=>false,liveRuntime:{session:null},document:null},
 state:{user:{cashback:0, purchases:0,cashbackDebt:0}},
 BRL:{format:v=>'R$ '+Number(v).toFixed(2)},
 shell:v=>v,esc:v=>String(v),console,
 clubePaidCouponPanel:()=>'<section id="my-private-vouchers"></section>'
};
vm.runInNewContext(premium+'\nthis.clubView=clubPremiumPage;',ctx);
const guest=ctx.clubView();
for(const must of [
 'club-premium-hero','club-premium-benefits','club-premium-how',
 'club-premium-faq','club-premium-account','club-premium-offers',
 'Descontos para aproveitar','Cashback para voltar',
 'Mais controle da sua economia','Condições do pacote em destaque',
 'data-coupon-price','data-coupon-face','data-coupon-minimum','data-coupon-availability',
 'id="clube-visitor-coupon-email"','name="full_name"','name="phone"',
 'value="login"','value="register"','onsubmit="return tamaoWelcomeRegister(event)"',
 'Ter um pacote não garante ofertas ou revendas disponíveis no seu CEP',
 'Entrar no Clube não gera cobrança','club-premium-faq-items'
])assert.ok(guest.includes(must),'Missing visible, truthful Club detail: '+must);
assert.match(guest,/class="tamao-coupon-price-board card form-stack[^"]*" hidden/);
assert.match(guest,/<form[^>]*data-tamao-account-context="club"/);
assert.equal((guest.match(/<details>/g)||[]).length,5);
assert.match(guest,/<details class="club-premium-register-details">/);
assert.match(guest,/<input id="clube-visitor-coupon-email"[^>]*required>/);
assert.match(css,/\.club-premium-register-details:not\(\[open\]\)>\.club-premium-register-fields\{display:none\}/);
assert.equal((guest.match(/class="card club-premium-benefit"/g)||[]).length,3);
assert.doesNotMatch(guest,/SEU CASHBACK DISPONÍVEL|my-private-vouchers/);
assert.doesNotMatch(guest,/R\$ ?8,90|R\$ ?19,90|QR Code Pix|compra garantida|economia garantida/i);
assert.equal((guest.match(/<svg class="club-premium-icon"/g)||[]).length,10);

ctx.globalThis.liveReady=()=>true;
ctx.globalThis.liveRuntime.session={user:{id:'customer-a',is_anonymous:false,email_confirmed_at:null}};
assert.match(ctx.clubView(),/id="clube-visitor-coupon-email"/,'Unconfirmed user must remain guest');
ctx.globalThis.liveRuntime.session.user.email_confirmed_at='2026-11-23T00:00:00Z';
ctx.state.user={cashback:7.25,purchases:2,cashbackDebt:0};
const privateMember=ctx.clubView();
assert.match(privateMember,/CLUBE TAMÃO \/ VANTAGENS DA SUA CONTA/,'Verified member retains route identity for navigation');
assert.match(privateMember,/SEU CASHBACK DISPONÍVEL/);
assert.match(privateMember,/R\$ 7\.25/);
assert.match(privateMember,/my-private-vouchers/);
assert.match(privateMember,/club-premium-shop-section/);
assert.match(privateMember,/club-premium-member-balance/);
assert.doesNotMatch(privateMember,/clube-visitor-coupon-email|tamao-coupon-price-board/);
assert.equal((privateMember.match(/SEU CASHBACK DISPONÍVEL/g)||[]).length,1);
ctx.state.user={cashback:0,purchases:0,cashbackDebt:5};
assert.match(ctx.clubView(),/em compensação/);
assert.match(ctx.clubView(),/R\$ 5\.00/);

for(const required of [
 '.club-premium-hero','.club-premium-entry-card','#club-premium-offers',
 '.club-premium-faq-items','.club-premium-member-balance',
 '@media(max-width:740px)','@media(max-width:540px)',
 '@media(max-width:350px)',':focus-visible',
 '[hidden]{display:none!important}'
])assert.ok(css.includes(required),'Missing premium CSS safeguard '+required);
assert.match(premium,/css\/club-premium\.css\?v=1168/);
assert.match(premium,/globalThis\.clubPremiumPage=clubPremiumPage/);
assert.doesNotMatch(guest,/🎟️|💚|🔎|⭐|🤝|💵/);
assert.doesNotMatch(privateMember,/🎟️|💚|🔎|⭐|🤝|💵/);
console.log('V1.1164 PASS — premium Club visitor/member, registered user gate, verified offer, safe benefits, original voucher/checkout and responsive styles');
