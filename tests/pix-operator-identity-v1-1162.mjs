import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pixFixture} from './helpers/pix-fixture.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('js/core.js');
const trust=read('js/pix-recipient-trust.js');
const buyer=read('js/customer.js');
const credits=read('js/ads-credits.js');
const coupons=read('js/clube-coupon-shop.js');
const mobility=read('js/mobility.js');
const merchant=read('js/merchant.js');
const admin=read('js/admin.js');
const pilot=read('js/admin-ads-credit.js');

for(const [path,data] of Object.entries({
 'js/core.js':core,'js/pix-recipient-trust.js':trust,'js/customer.js':buyer,
 'js/ads-credits.js':credits,'js/clube-coupon-shop.js':coupons,
 'js/mobility.js':mobility,'js/merchant.js':merchant,
 'js/admin.js':admin,'js/admin-ads-credit.js':pilot
}))assert.doesNotThrow(()=>new vm.Script(data,{filename:path}),path);

assert.ok(core.includes("'./js/pix-recipient-trust.js'+"));
assert.ok(core.includes("if(!valid(code,amountCents))return ''"));
const context=vm.createContext({});
vm.runInContext(trust,context);
assert.equal(typeof context.tamaoPixRecipientHtml,'function');
const renderRecipient=context.tamaoPixRecipientHtml;
const platform=renderRecipient({scope:'platform'});
assert.match(platform,/RESPONSÁVEL TÉCNICO TAMÃO/);
assert.match(platform,/Carlos Alberto dos Santos Freitas/);
assert.match(platform,/Cobrança gerada pelo sistema oficial do TAMÃO/);
assert.match(platform,/Antes de pagar, confira no aplicativo do banco/);
assert.match(platform,/CPF: os dígitos finais não são divulgados/);
assert.doesNotMatch(platform,/[0-9]{11}|CPF final \*\*\d{2}/);

const merchantView=renderRecipient({scope:'merchant',merchantName:'Revenda Parceira'});
assert.match(merchantView,/RECEBIMENTO DIRETO À REVENDA/);
assert.match(merchantView,/Revenda Parceira/);
assert.doesNotMatch(merchantView,/Carlos Alberto/);
assert.match(merchantView,/não pelo TAMÃO/);

const sellerView=renderRecipient({scope:'seller',sellerName:'Vendedor do Clube'});
assert.match(sellerView,/VENDEDOR DO PACOTE/);
assert.match(sellerView,/Vendedor do Clube/);
assert.doesNotMatch(sellerView,/Carlos Alberto/);
assert.ok(!renderRecipient({scope:'unknown'}));
assert.match(renderRecipient({scope:'merchant',
 merchantName:'<img src=x onerror=alert(1)>'}),/&lt;img/);
assert.doesNotMatch(renderRecipient({scope:'merchant',
 merchantName:'<img src=x onerror=alert(1)>'}),/<img/);
assert.doesNotMatch(renderRecipient({
 scope:'platform',recipientVerified:true,cpfFinal:'77'
}),/CPF final/,'No client-controlled flag may publish bank verification');

assert.match(trust,/class="tamao-pix-trust"/);
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

for(const source of [core,trust,buyer,credits,coupons,mobility,merchant,admin,pilot]){
 assert.ok(!source.includes('Exemplo de apresentação — não representa uma cobrança real'),
  'Do not put placeholder disclaimers in production');
}
console.log('V1.1162 PASS: platform identity, merchant/seller isolation, XSS safety, no invented CPF, and seven payable Pix screens.');

// The bank-check warning must remain visible if the optional module stalls.
const helper=core.slice(core.indexOf('// The same bank-readable Pix'));
const scripts=[],timers=new Map();
let seq=0,draws=0,insertFails=false;
const loader=vm.createContext({TextEncoder,TextDecoder,URL,
 setTimeout:(fn,ms)=>{assert.equal(ms,15000);timers.set(++seq,fn);return seq;},
 clearTimeout:id=>timers.delete(id),
 document:{currentScript:{src:'https://tamao.com.br/js/core.js?v=release-sha'},baseURI:'https://tamao.com.br/',
  createElement:()=>({remove(){this.removed=true}}),
  head:{appendChild:s=>{if(insertFails)throw Error('blocked');scripts.push(s)}}},
 render:()=>draws++});
vm.runInContext(read('js/qr-generator.js'),loader);
vm.runInContext(helper,loader);
const pix=pixFixture();
assert.equal(loader.tamaoPixMarkup(pix,{amountCents:4990}),'');
assert.equal(scripts.length,0,'invalid payment never requests trust module');
let pending=loader.tamaoPixMarkup(pix,{amountCents:1990});
assert.match(pending,/<svg\b/);
assert.match(pending,/Antes de pagar, confira/);
assert.doesNotMatch(pending,/Carlos Alberto|CPF final/);
assert.equal(scripts[0].src,'./js/pix-recipient-trust.js?v=release-sha');
loader.tamaoPixMarkup(pix,{amountCents:1990});
assert.equal(scripts.length,1);
[...timers.values()][0]();
assert.equal(timers.size,0);
assert.equal(scripts[0].removed,true);
assert.match(loader.tamaoPixMarkup(pix,{amountCents:1990}),/Tentar carregar identificação/);
assert.equal(scripts.length,1,'render does not auto retry');
insertFails=true;
loader.tamaoPixRetryRecipient();
assert.equal(timers.size,0);
assert.match(loader.tamaoPixMarkup(pix,{amountCents:1990}),/Tentar carregar identificação/);
insertFails=false;
loader.tamaoPixRetryRecipient();loader.tamaoPixRetryRecipient();
assert.equal(scripts.length,2);
const beforeLate=draws;
scripts[0].onload();scripts[0].onerror();
assert.equal(draws,beforeLate);
assert.equal(timers.size,1);
vm.runInContext(trust,loader);
scripts[1].onload();
assert.equal(timers.size,0);
assert.doesNotMatch(loader.tamaoPixMarkup(pix,{amountCents:1990}),/Tentar carregar identificação/);
assert.match(loader.tamaoPixRecipientHtml({scope:'merchant',merchantName:'Revenda'}),/RECEBIMENTO DIRETO À REVENDA/);
assert.doesNotMatch(loader.tamaoPixRecipientHtml({scope:'merchant',merchantName:'Revenda'}),/Carlos Alberto/);
console.log('PASS: versioned recipient module, bounded retries, persistent bank-check guidance and exact scope.');
