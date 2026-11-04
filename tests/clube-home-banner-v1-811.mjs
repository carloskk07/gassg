import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=get('js/customer.js');
const css=get('css/marketing-premium.css');
new vm.Script(customer);
const begin=customer.indexOf('function tamaoHomeCouponBanner(){');
const end=customer.indexOf('\nfunction customerProductName(',begin);
assert.ok(begin>0&&end>begin,'Home banner renderer must exist');
const ctx=vm.createContext({});
vm.runInContext(customer.slice(begin,end)+'\nthis.banner=tamaoHomeCouponBanner;',ctx);
const markup=ctx.banner();
for(const term of ['CLUBE TAMÃO','Cupons','Cashback','Indicações','go(\'club\')','go(\'earn\')','ILUSTRAÇÃO DE CUPOM','EXEMPLO','confirmados no Clube'])
 assert.ok(markup.includes(term),'missing clear banner item: '+term);
for(const claim of ['Comprar agora','Compre seu pacote','Desconto garantido','Cupom disponível','Compre por Pix'])
 assert.ok(!markup.includes(claim),'must not advertise unaudited sales: '+claim);
assert.equal((markup.match(/<section /g)||[]).length,1);
assert.match(markup,/class="tamao-coupon-banner"/);
assert.ok(customer.includes('return shell(`${regionalPriceSection}')&&
 customer.includes('${tamaoHomeCouponBanner()}'), 'both public and internal home variants must include the banner');
assert.ok(css.includes('.tamao-coupon-banner-ticket')&&css.includes('@media(max-width:620px)'),'banner must render responsive vector voucher without an external media dependency');
assert.ok(!markup.includes('href="http'),'banner must navigate internally');
console.log('V1.811 PASS — visual Clube coupon banner, responsive accessibility, no false live sales, all home variants.');
