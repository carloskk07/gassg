import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=get('js/customer.js'), html=get('index.html'), css=get('css/marketing-premium.css'), bonus=get('js/welcome-bonus.js');
new vm.Script(customer);
assert.ok(customer.includes("getElementById('tamao-coupon-home-template')"));
assert.equal(customer.split('${couponBanner}').length-1,2,'both public and internal home variants show banner');
const start=html.indexOf('<template id="tamao-coupon-home-template">');
const end=html.indexOf('</template>',start);
assert.ok(start>0&&end>start,'static banner template exists');
const markup=html.slice(start,end);
for(const term of ['CLUBE TAMÃO','Cupons','Cashback','Indicações',"go('club')","go('earn')",'DESCONTOS EM COMPRAS ELEGÍVEIS','CUPONS','confirmados no Clube'])
 assert.ok(markup.includes(term),'banner missing: '+term);
for(const claim of ['ILUSTRAÇÃO DE CUPOM','EXEMPLO','R$ 5','Comprar agora','Compre seu pacote','Desconto garantido','Cupom disponível','Compre por Pix'])
 assert.ok(!markup.includes(claim),'cannot advertise sales before approval: '+claim);
assert.equal((markup.match(/<section /g)||[]).length,1);
assert.match(markup,/class="tamao-coupon-banner"/);
assert.match(markup,/class="tamao-coupon-price-board" hidden/);
assert.match(markup,/data-coupon-price/);
assert.match(markup,/data-coupon-minimum/);
assert.match(markup,/class="tamao-coupon-banner-main" onclick="tamaoWelcomeShowSignup\(\)"/);
assert.doesNotMatch(markup,/onclick="go\('club'\)">Quero participar/);
assert.ok(bonus.includes("clube_coupon_home_prices_v1_820") && bonus.includes("all_products_3x5_sponsor"));
assert.ok(bonus.includes("liveUpgradeAccount(email)"),'welcome signup must use real account confirmation');
assert.ok(css.includes('.tamao-coupon-banner-ticket')&&css.includes('@media(max-width:760px)'),'voucher must be responsive');
assert.ok(start>html.indexOf('<div id="toast"'),'banner template must survive app route rendering');
console.log('V1.811 PASS — truthful, responsive campaign banner as static HTML, two home routes and no merchant JS cost.');
