import assert from 'node:assert/strict';

// Deterministic property-style audit of the exact integer-cent reward formula
// used by public.grant_order_rewards. No network and no production writes.
let seed=0x17020001;
function rnd(){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/0x100000000;
}
function int(min,max){return Math.floor(rnd()*(max-min+1))+min}

function economics({gross,feeBps,variableBps,minimumBps,cashbackBps,referralBps,hasReferral}){
  const platformFee=Math.floor((gross*feeBps)/10000);
  const variableReserve=Math.min(platformFee,Math.ceil((gross*variableBps)/10000));
  const minimumContribution=Math.min(
    Math.max(0,platformFee-variableReserve),
    Math.ceil((gross*minimumBps)/10000)
  );
  const rewardBudget=Math.max(0,platformFee-variableReserve-minimumContribution);
  const cashbackTarget=Math.floor((gross*cashbackBps)/10000);
  const referralTarget=Math.floor((gross*referralBps)/10000);
  const cashback=Math.min(cashbackTarget,rewardBudget);
  const referral=hasReferral
    ? Math.min(referralTarget,Math.max(0,rewardBudget-cashback))
    : 0;
  const platformContribution=platformFee-variableReserve-cashback-referral;
  return {
    platformFee,variableReserve,minimumContribution,rewardBudget,
    cashback,referral,platformContribution
  };
}

let rewardCases=0;
for(let i=0;i<50000;i++){
  // orders.gross_total_cents is int4; production policy snapshots are capped at 5000 bps.
  const gross=int(0,2147483647);
  const feeBps=int(0,5000);
  const variableBps=int(0,5000);
  const minimumBps=int(0,5000);
  const cashbackBps=int(0,5000);
  const referralBps=int(0,5000);
  const hasReferral=int(0,1)===1;
  const e=economics({gross,feeBps,variableBps,minimumBps,cashbackBps,referralBps,hasReferral});

  for(const [name,value] of Object.entries(e)){
    assert.ok(Number.isSafeInteger(value),name+' precisa permanecer inteiro seguro');
    assert.ok(value>=0,name+' não pode ser negativo');
    assert.ok(value<=2147483647,name+' precisa caber em int4');
  }
  assert.ok(e.variableReserve<=e.platformFee);
  assert.ok(e.minimumContribution<=e.platformFee-e.variableReserve);
  assert.ok(e.cashback+e.referral<=e.rewardBudget);
  assert.ok(e.platformContribution>=e.minimumContribution);
  assert.equal(
    e.platformFee,
    e.variableReserve+e.cashback+e.referral+e.platformContribution,
    'identidade financeira precisa fechar exatamente em centavos'
  );
  rewardCases++;
}

// Boundary matrix: tiny totals, max total and extreme policy combinations.
for(const gross of [0,1,2,3,99,100,101,9999,10000,2147483647]){
  for(const feeBps of [0,1,75,100,250,750,5000]){
    for(const variableBps of [0,1,75,5000]){
      for(const minimumBps of [0,1,250,5000]){
        const e=economics({
          gross,feeBps,variableBps,minimumBps,
          cashbackBps:5000,referralBps:5000,hasReferral:true
        });
        assert.equal(e.platformFee,e.variableReserve+e.cashback+e.referral+e.platformContribution);
        assert.ok(e.platformContribution>=e.minimumContribution);
        assert.ok(e.cashback+e.referral<=e.rewardBudget);
        rewardCases++;
      }
    }
  }
}

// Model the live cashback_position semantics:
// raw cashback ledger - cashback from reversed reward grants.
// Negative effective balance is debt, never spendable cashback.
let positionCases=0;
for(let i=0;i<20000;i++){
  const ledger=int(-1000000000,1000000000);
  const reversed=int(0,1000000000);
  const net=ledger-reversed;
  const spendable=Math.max(0,net);
  const debt=Math.max(0,-net);
  assert.ok(spendable>=0&&debt>=0);
  assert.ok(!(spendable>0&&debt>0));
  assert.equal(spendable-debt,net);
  positionCases++;
}

console.log(`Financial invariant fuzz passou: ${rewardCases} cenários de unit economics + ${positionCases} posições de cashback.`);
