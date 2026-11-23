import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('js/core.js');
const css=read('css/components.css');
const buyer=read('js/customer.js');
const credits=read('js/ads-credits.js');
const coupons=read('js/clube-coupon-shop.js');
const mobility=read('js/mobility.js');
const merchant=read('js/merchant.js');
const admin=read('js/admin.js');
const pilot=read('js/admin-ads-credit.js');

for(const [path,data] of Object.entries({
 'js/core.js':core,'js/customer.js':buyer,
 'js/ads-credits.js':credits,'js/clube-coupon-shop.js':coupons,
 'js/mobility.js':mobility,'js/merchant.js':merchant,
 'js/admin.js':admin,'js/admin-ads-credit.js':pilot
}))assert.doesNotThrow(()=>new vm.Script(data,{filename:path}),path);

const block=core.match(/ function recipientHtml\([\s\S]*?\n \}(?=\n\n globalThis\.tamaoPixRecipientHtml=recipientHtml;)/);
assert.ok(block,'Recipient identity must be a pure shared helper, not a payment operation');
const context=vm.createContext({});
vm.runInContext(`
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 ${block[0]}
 globalThis.renderRecipient=recipientHtml;
`,context);
const platform=context.renderRecipient({scope:'platform'});
assert.match(platform,/RESPONSÁVEL TÉCNICO TAMÃO/);
assert.match(platform,/Carlos Alberto dos Santos Freitas/);
assert.match(platform,/Cobrança gerada pelo sistema oficial do TAMÃO/);
assert.match(platform,/Antes de pagar, confira no aplicativo do banco/);
assert.match(platform,/CPF: os dígitos finais não são divulgados/);
assert.doesNotMatch(platform,/[0-9]{11}|CPF final \*\*\d{2}/);

const merchantView=context.renderRecipient({scope:'merchant',merchantName:'Revenda Parceira'});
assert.match(merchantView,/RECEBIMENTO DIRETO À REVENDA/);
assert.match(merchantView,/Revenda Parceira/);
assert.doesNotMatch(merchantView,/Carlos Alberto/);
assert.match(merchantView,/não pelo TAMÃO/);

const sellerView=context.renderRecipient({scope:'seller',sellerName:'Vendedor do Clube'});
assert.match(sellerView,/VENDEDOR DO PACOTE/);
assert.match(sellerView,/Vendedor do Clube/);
assert.doesNotMatch(sellerView,/Carlos Alberto/);
assert.ok(!context.renderRecipient({scope:'unknown'}));
assert.match(context.renderRecipient({scope:'merchant',
 merchantName:'<img src=x onerror=alert(1)>'}),/&lt;img/);
assert.doesNotMatch(context.renderRecipient({scope:'merchant',
 merchantName:'<img src=x onerror=alert(1)>'}),/<img/);
assert.doesNotMatch(context.renderRecipient({
 scope:'platform',recipientVerified:true,cpfFinal:'77'
}),/CPF final \*\*09/,'No client-controlled flag may publish bank verification');

assert.match(css,/\.tamao-pix-trust/);
assert.match(buyer,/onlinePayment\.pixPayable===true/);
assert.match(buyer,/tamaoPixRecipientHtml\?\.\(\{scope:'merchant'/);
assert.match(credits,/tamaoCreditPixHtml\(pix\)/);
assert.match(credits,/tamaoPixRecipientHtml\?\.\(\{scope:'platform'/);
assert.match(coupons,/pixDisplayFresh&&partnerPixProven/);
assert.match(coupons,/scope:purchase\.fundingModel==='partner_funded'\?'seller':'platform'/);
assert.match(mobility,/const pix=payable\?/);
assert.match(mobility,/tamaoPixRecipientHtml\?\.\(\{scope:'platform'/);
assert.match(merchant,/merchantBillingPixProofValid\?\.\(request\)/);
assert.match(merchant,/const identity=globalThis\.tamaoPixRecipientHtml\?\.\(\{scope:'platform'/);
assert.match(admin,/tamaoPixRecipientHtml\?\.\(\{scope:'platform'/);
assert.match(pilot,/const pix=code\?/);
assert.match(pilot,/tamaoPixRecipientHtml\?\.\(\{scope:'platform'/);

for(const source of [core,buyer,credits,coupons,mobility,merchant,admin,pilot]){
 assert.ok(!source.includes('Exemplo de apresentação — não representa uma cobrança real'),
  'Do not put placeholder disclaimers in production');
}
console.log('V1.1162 PASS: platform identity, merchant/seller isolation, XSS safety, no invented CPF, and seven payable Pix screens.');
