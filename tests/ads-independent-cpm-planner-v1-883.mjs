import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js');
const audit=read('supabase/migrations/20261013235900_ads_placement_gate_v1_236.sql');
const contract=read('supabase/migrations/20261016030000_ads_sales_planning_v1_309.sql');
const section=read('js/ads-planner.js');
assert.match(growth,/function tamaoAdsPlannerLoad\(\)/);
assert.match(growth,/globalThis\.tamaoAdsPlannerSection\?\.\(\)/);
assert.match(growth,/new URL\('ads-planner\.js'\+\(current\?new URL\(current\)\.search/);
assert.ok(!growth.includes('TAMAO_ADS_PROPOSED_CPM_CENTS'),
  'CPM planner must not increase initial customer JavaScript budget');
const sandbox={
  document:{getElementById:()=>null},
  openSponsorContact:()=>{throw Error('unmocked navigation')},
  console
};
vm.createContext(sandbox);
vm.runInContext(section+
 ';this.quote=tamaoAdsBudgetPreview;this.html=tamaoAdsPlannerSection;'+
 'this.update=tamaoAdsBudgetQuote;this.request=tamaoAdsBudgetRequest;',sandbox);
for(const [budget,impressions] of [[1990,1658],[4990,4158],[9990,8325],[19990,16658]]){
 const quote=sandbox.quote(budget);
 assert.equal(quote.maxViewableImpressions,impressions);
 assert.equal(quote.cpmCents,1200);
 assert.equal(quote.chargeEnabled,false);
 assert.equal(quote.inventoryVerified,false);
 assert.equal(quote.guaranteedViews,0);
}
for(const bad of [-1,0,1250,2000,Infinity,NaN,'19.90'])assert.equal(sandbox.quote(bad),null);
const html=sandbox.html();
for(const label of [
 'CPM em avaliação','Cobrança agora','R$ 12,00','R$ 0,00',
 'tamaoAdsBudgetQuote()','tamaoAdsBudgetRequest()',
 '50% do anúncio visível durante 1 segundo contínuo',
 'Sem garantia de entrega ou cobrança nesta etapa',
 'Publicidade regional é independente de cadastrar uma revenda'
])assert.ok(html.includes(label),'missing truthful planning terms: '+label);
assert.match(growth,/globalThis\.tamaoAdsPlannerSection\?\.\(\)/);
assert.ok(section.includes("openSponsorContact('visibility',detail)"));
assert.match(audit,/public_enabled boolean not null default false check\(public_enabled=false\)/);
assert.match(audit,/billing_enabled boolean not null default false check\(billing_enabled=false\)/);
assert.match(contract,/'noCharge',true,'adsLive',false/);
assert.doesNotMatch(section,/fetch\(|\.rpc\(|payment|Pix/i,'planner must not charge or manufacture impressions');

// Exercise the rendered live estimate and the existing sponsor-contact workflow.
const values={
 'sponsor-cpm-budget':{value:'4990'},
 'sponsor-cpm-city':{value:'São Gabriel'},
 'sponsor-cpm-state':{value:'RS'},
 'sponsor-cpm-days':{value:'30'},
 'sponsor-cpm-result':{textContent:''}
};
sandbox.document={getElementById:id=>values[id]||null};
sandbox.update();
assert.match(values['sponsor-cpm-result'].textContent,/4\.158 visualizações verificadas/);
values['sponsor-cpm-budget'].value='1990';
sandbox.update();
assert.match(values['sponsor-cpm-result'].textContent,/1\.658 visualizações verificadas/);
values['sponsor-cpm-budget'].value='4990';
let outbound=null;
sandbox.openSponsorContact=(kind,brief)=>{outbound={kind,brief}};
sandbox.request();
assert.equal(outbound.kind,'visibility');
assert.match(outbound.brief,/São Gabriel\/RS/);
assert.match(outbound.brief,/R\$ 49,90/);
assert.match(outbound.brief,/30 dias/);
assert.match(outbound.brief,/não vinculante/);
assert.match(outbound.brief,/sem promessa de entrega/);
values['sponsor-cpm-state'].value='NOT_A_STATE';
outbound=null;sandbox.request();assert.equal(outbound,null);
assert.match(values['sponsor-cpm-result'].textContent,/Revise o período e a UF/);
console.log('V1.883 PASS: advertiser independent quote, budget cap, client controls, no misleading delivery or charge.');
