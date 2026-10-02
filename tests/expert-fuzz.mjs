import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {chooseOffers} from '../supabase/functions/_shared/offer-ranking.js';
import {effectiveUnitPrice} from '../supabase/functions/_shared/pricing-policy.js';

class StorageMock {
  constructor(){this.map=new Map()}
  getItem(k){return this.map.has(k)?this.map.get(k):null}
  setItem(k,v){this.map.set(k,String(v))}
  removeItem(k){this.map.delete(k)}
  clear(){this.map.clear()}
}

globalThis.localStorage=new StorageMock();
globalThis.location={hash:'',search:'',origin:'https://fuzz.test',pathname:'/gassg/',hostname:'fuzz.test'};
globalThis.document={querySelector:()=>null};
globalThis.render=()=>{};
globalThis.toast=()=>{};
globalThis.__CHAMA_TEST__=true;

vm.runInThisContext(fs.readFileSync(new URL('../js/core.js',import.meta.url),'utf8'),{filename:'js/core.js'});
vm.runInThisContext(fs.readFileSync(new URL('../js/growth.js',import.meta.url),'utf8'),{filename:'js/growth.js'});
const marginFn=vm.runInThisContext('merchantMarginExample');
const moneyRound=vm.runInThisContext('roundMoney');
assert.equal(typeof marginFn,'function');
assert.equal(typeof moneyRound,'function');

let seed=0xC1A031;
function rnd(){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/0x100000000;
}
function int(min,max){return Math.floor(rnd()*(max-min+1))+min}
function cents(min,max){return int(min,max)}

let pricingCases=0;
for(let k=0;k<5000;k++){
  const min=int(100,200000);
  const pref=int(min,min+200000);
  const max=int(pref,pref+200000);
  const qty=int(1,20);
  const stock=int(qty,Math.max(qty,qty*30));
  const active=int(0,20);
  const recent=int(0,300);
  const strategy=['volume','balanced','margin'][int(0,2)];
  const price=effectiveUnitPrice({
    pricingMode:'range',pricingStrategy:strategy,
    minPriceCents:min,preferredPriceCents:pref,maxPriceCents:max,
    availableStock:stock,requestedQuantity:qty,activeOrders:active,recentOrders7d:recent
  });
  assert.ok(Number.isInteger(price));
  assert.ok(price>=min&&price<=max);
  pricingCases++;
}

let rankingCases=0;
for(let k=0;k<5000;k++){
  const n=int(1,8);
  const candidates=[];
  for(let i=0;i<n;i++){
    candidates.push({
      merchantId:'m-'+k+'-'+i,
      totalCents:cents(5000,50000),
      etaMinMinutes:int(5,180),
      trustScore:int(0,100),
      activeOrders:int(0,100),
      recentOrders7d:int(0,1000)
    });
  }
  const selected=chooseOffers(candidates);
  assert.ok(selected.length>=1&&selected.length<=Math.min(3,n));
  assert.equal(new Set(selected.map(x=>x.candidate.merchantId)).size,selected.length);
  assert.ok(selected.every(x=>Number.isFinite(x.candidate.rankScore)&&Number.isFinite(x.candidate.recommendationScore)));

  if(n===1){
    assert.equal(selected.length,1);
    assert.equal(selected[0].label,'available');
    assert.equal(selected[0].candidate.merchantId,candidates[0].merchantId);
  }else{
    assert.equal(selected[0].label,'recommended');
    const ranked=selected[0].candidate;
    const bestBase=Math.min(...chooseOffers(candidates.map(c=>({...c,activeOrders:0,recentOrders7d:0}))).map(x=>x.candidate.rankScore));
    assert.ok(ranked.rankScore<=bestBase+0.100000001);

    const cheapest=[...candidates].sort((a,b)=>a.totalCents-b.totalCents||a.etaMinMinutes-b.etaMinMinutes)[0];
    assert.ok(selected.some(x=>x.candidate.merchantId===cheapest.merchantId));

    const fastest=[...candidates].sort((a,b)=>a.etaMinMinutes-b.etaMinMinutes||a.totalCents-b.totalCents)[0];
    assert.ok(selected.some(x=>x.candidate.merchantId===fastest.merchantId));
  }
  rankingCases++;
}

// Strong dominance must not be overturned by load balancing.
for(let k=0;k<1000;k++){
  const best={
    merchantId:'best-'+k,
    totalCents:int(8000,15000),
    etaMinMinutes:int(10,35),
    trustScore:int(90,100),
    activeOrders:100,
    recentOrders7d:1000
  };
  const worse={
    merchantId:'worse-'+k,
    totalCents:Math.round(best.totalCents*1.25),
    etaMinMinutes:best.etaMinMinutes+20,
    trustScore:Math.max(0,best.trustScore-10),
    activeOrders:0,
    recentOrders7d:0
  };
  const selected=chooseOffers([best,worse]);
  assert.equal(selected[0].candidate.merchantId,best.merchantId);
  rankingCases++;
}

const MAX_INT4=2147483647;
const maxSupportedCart=20*99*1000000+100000;
assert.ok(maxSupportedCart<MAX_INT4,'teto novo deve caber em int4 mesmo na cesta máxima');
assert.ok(20*99*100000000+100000>MAX_INT4,'teto antigo reproduz risco de overflow int4');

let marginCases=0;
for(let k=0;k<3000;k++){
  const orders=int(1,10000);
  const salePrice=Math.round((1+rnd()*9999)*100)/100;
  const productCost=Math.round(rnd()*salePrice*120)/100;
  const deliveryCost=Math.round(rnd()*10000)/100;
  const paymentCost=Math.round(rnd()*3000)/100;
  const taxRate=Math.round(rnd()*1000)/10;
  const e=marginFn({salePrice,orders,productCost,deliveryCost,paymentCost,taxRate});

  for(const value of Object.values(e))assert.ok(Number.isFinite(value));
  assert.ok(e.gross>=0);
  assert.ok(e.chamaFee>=0);
  assert.ok(e.knownCosts>=0);
  assert.equal(e.contribution,moneyRound(e.gross-e.chamaFee-e.knownCosts));
  assert.equal(e.chamaFee,moneyRound(e.gross*0.075));
  assert.equal(e.unitContribution,moneyRound(e.contribution/orders));
  marginCases++;
}

console.log(`Expert fuzz passou: ${pricingCases} preços automáticos + ${rankingCases} cenários de ranking + ${marginCases} cenários de margem + limites int4.`);
