import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const a=source.indexOf('function adminFinancePixTariff(');
const b=source.indexOf('function adminFinanceRealAllowed(',a);
assert.ok(a>=0&&b>a);
const ctx=vm.createContext({});
vm.runInContext(source.slice(a,b)+'\nthis.estimate=adminFinancePixTariff;this.view=adminFinancePixTariffView;',ctx);
const e=ctx.estimate(890);
assert.equal(e.rateBps,99);assert.equal(e.feeCents,9);assert.equal(e.netCents,881);
assert.equal(e.estimate,true);
assert.equal(e.checkedOn,'2026-11-13');
assert.equal(e.sourceUrl,'https://www.mercadopago.com.br/ferramentas-para-vender/check-out');
for(const amount of [1,50,100,890,10000,1000000000]){
 const r=ctx.estimate(amount);
 assert.ok(Number.isSafeInteger(r.feeCents)&&r.feeCents>=0&&r.feeCents<=amount);
 assert.equal(r.feeCents+r.netCents,amount);
 assert.ok(r.feeCents*10000>=amount*99,'forecast must not understate the standard tariff');
 assert.ok((r.feeCents-1)*10000<amount*99,'round up by at most one cent');
}
for(const invalid of [null,undefined,'890',0,-1,8.9,NaN,Infinity,1000000001]){
 assert.equal(ctx.estimate(invalid),null);
 assert.equal(ctx.view(invalid),'','unknown amounts cannot become a zero-cost prediction');
}
const html=ctx.view(890);
assert.match(html,/R\$ 0,09 \(0,99%\)/);
assert.match(html,/Líquido previsto: <strong>R\$ 8,81/);
assert.match(html,/A conciliação confirma o valor efetivo/);
assert.doesNotMatch(source.slice(a,b),/adminInvoke|chamaFetch|fetch\(|net_proceeds_verified_at|clube_coupon_paid_net_proceeds_verify/,
 'a published tariff calculates a forecast and cannot fabricate financial evidence');
assert.match(source,/p\.netReconciliationRecorded!==true\?adminFinancePixTariffView\(p\.amountCents\)/,
 'a forecast must not replace an already reconciled receipt');
console.log('PASS: official Pix tariff, conservative cent rounding, invalid amounts rejected and no invented receipt.');
