import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

// Nationwide referrals must not assert that another city's buyers can order
// from a São Gabriel partner. City hints are optional, never offer evidence.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const growth=fs.readFileSync(path.join(root,'js/growth.js'),'utf8');
const customer=fs.readFileSync(path.join(root,'js/customer.js'),'utf8');
const core=fs.readFileSync(path.join(root,'js/core.js'),'utf8');
const acquisition=fs.readFileSync(path.join(root,'js/acquisition.js'),'utf8');
const source=/function referralSharePayload\(url,region\)\s*\{[\s\S]*?^\}/m.exec(growth)?.[0];
assert.ok(source,'A reusable, testable nationwide share formatter is required');
const payload=vm.runInNewContext(source+'\nreferralSharePayload');
const url='https://tamao.com.br/?ref=fixture';
const outside=payload(url,{city:'Porto Alegre',state:'RS'});
assert.equal(outside.url,url);
assert.equal(outside.title,'TAMÃO — Pediu? Tá na mão.');
assert.match(outside.text,/Porto Alegre\/RS/);
assert.match(outside.text,/disponibilidade pelo CEP/);
assert.doesNotMatch(outside.text,/São Gabriel/);
const other=payload(url,{city:'Curitiba',state:'PR'});
assert.match(other.text,/Curitiba\/PR/);
assert.doesNotMatch(other.text,/Porto Alegre/);
const unknown=payload(url,null);
assert.match(unknown.text,/na sua região/);
assert.doesNotMatch(unknown.text,/São Gabriel/);
const invalid=payload(url,{city:'Porto Alegre',state:'INVALID'});
assert.match(invalid.text,/na sua região/);
assert.ok(growth.includes('navigator.share(payload)'), 'Native sharing must use validated location copy');
assert.ok(growth.includes('navigator.clipboard.writeText(payload.text)'), 'Clipboard copy must match native sharing');
assert.ok(!acquisition.includes('Ex.: entregamos em toda São Gabriel'),
 'Partner onboarding cannot assume the founding city');
assert.ok(acquisition.includes('atendemos vários bairros da nossa cidade'),
 'Partner onboarding needs a nationwide-ready example');
assert.ok(customer.includes("'Informe seu CEP'"), 'Customer default location must not assume São Gabriel');
assert.ok(!customer.includes('atendimento em São Gabriel/RS'), 'Delivery details must use the buyer postal code');
assert.ok(core.includes("'Consulte sua região'"), 'Public footer must be region-aware');
assert.ok(!growth.includes('VENDA PELO TAMÃO — SÃO GABRIEL'), 'Merchant CTA must be nationwide');
console.log('Nationwide sharing, customer region and merchant acquisition copy passed.');
