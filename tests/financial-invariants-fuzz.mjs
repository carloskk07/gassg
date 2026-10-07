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


function prepaidFeeAllocation(packageFee,flexFee,availableCredit){
  const discountedFee=Math.max(0,Math.trunc(packageFee));
  const fallbackFee=Math.max(0,Math.trunc(flexFee));
  const available=Math.max(0,Math.trunc(availableCredit));
  if(discountedFee>0&&available>=discountedFee){
    return {
      rateMode:'package',
      totalFee:discountedFee,
      reserved:discountedFee,
      postpaidDue:0
    };
  }
  const reserved=fallbackFee>0?Math.min(fallbackFee,available):0;
  return {
    rateMode:'flex',
    totalFee:fallbackFee,
    reserved,
    postpaidDue:fallbackFee-reserved
  };
}

let prepaidCases=0;
for(let i=0;i<25000;i++){
  const gross=int(1,100000000);
  const packageBps=int(1,849);
  const flexBps=int(packageBps+1,1000);
  const packageFee=Math.floor((gross*packageBps)/10000);
  const flexFee=Math.floor((gross*flexBps)/10000);
  const availableCredit=int(0,Math.max(1,packageFee+10000));
  const a=prepaidFeeAllocation(packageFee,flexFee,availableCredit);

  assert.ok(a.reserved>=0);
  assert.ok(a.reserved<=a.totalFee);
  assert.ok(a.reserved<=availableCredit);
  assert.equal(a.reserved+a.postpaidDue,a.totalFee);

  if(packageFee>0&&availableCredit>=packageFee){
    assert.equal(a.rateMode,'package');
    assert.equal(a.totalFee,packageFee);
    assert.equal(a.reserved,packageFee);
    assert.equal(a.postpaidDue,0);
  }else{
    assert.equal(a.rateMode,'flex');
    assert.equal(a.totalFee,flexFee);
    assert.equal(a.reserved,Math.min(flexFee,availableCredit));
    if(packageFee>0&&availableCredit>0&&availableCredit<packageFee){
      assert.equal(a.reserved,availableCredit,'saldo residual precisa ser totalmente abatido da taxa Flex');
      assert.ok(a.postpaidDue>=0);
      assert.equal(a.rateMode,'flex','saldo residual não pode manter desconto do pacote');
    }
  }
  prepaidCases++;
}

for(const [packageFee,flexFee,availableCredit,expectedMode,expectedReserved,expectedDue] of [
  [500,650,300,'flex',300,350],
  [500,650,499,'flex',499,151],
  [500,650,500,'package',500,0],
  [500,650,700,'package',500,0],
  [1,2,1,'package',1,0],
  [1,2,0,'flex',0,2],
  [0,1,1,'flex',1,0],
  [0,0,300,'flex',0,0]
]){
  const a=prepaidFeeAllocation(packageFee,flexFee,availableCredit);
  assert.equal(a.rateMode,expectedMode);
  assert.equal(a.reserved,expectedReserved);
  assert.equal(a.postpaidDue,expectedDue);
  prepaidCases++;
}


function prepaidTransitionAllowed({
  currentMode,currentBps,targetMode,targetBps,balance,reserved,newBalance,newReserved
}){
  if(targetMode==='postpaid_daily'){
    return newBalance===0&&newReserved===0;
  }
  if(
    currentMode==='prepaid_credit'
    && targetMode==='prepaid_credit'
    && (balance>0||reserved>0)
    && targetBps>currentBps
  ) return false;
  return true;
}

let transitionCases=0;
for(let i=0;i<25000;i++){
  const currentBps=int(1,1000);
  const targetBps=int(1,1000);
  const balance=int(0,1000000);
  const reserved=int(0,balance);
  const allowed=prepaidTransitionAllowed({
    currentMode:'prepaid_credit',
    currentBps,
    targetMode:'prepaid_credit',
    targetBps,
    balance,
    reserved,
    newBalance:balance+int(0,100000),
    newReserved:reserved
  });
  if(balance>0||reserved>0){
    assert.equal(
      allowed,
      targetBps<=currentBps,
      'com crédito ativo só recarga/upgrade de taxa pode ocorrer'
    );
  }else{
    assert.equal(allowed,true,'sem crédito ativo qualquer novo pacote pode iniciar');
  }
  transitionCases++;
}

assert.equal(prepaidTransitionAllowed({
  currentMode:'prepaid_credit',currentBps:650,targetMode:'prepaid_credit',targetBps:700,
  balance:300000,reserved:0,newBalance:400000,newReserved:0
}),false,'não pode piorar 6,50% para 7,00% com saldo ativo');
assert.equal(prepaidTransitionAllowed({
  currentMode:'prepaid_credit',currentBps:750,targetMode:'prepaid_credit',targetBps:650,
  balance:10000,reserved:5000,newBalance:310000,newReserved:5000
}),true,'upgrade para taxa menor deve continuar permitido');
assert.equal(prepaidTransitionAllowed({
  currentMode:'prepaid_credit',currentBps:700,targetMode:'prepaid_credit',targetBps:700,
  balance:10000,reserved:0,newBalance:110000,newReserved:0
}),true,'recarga do mesmo pacote deve continuar permitida');
assert.equal(prepaidTransitionAllowed({
  currentMode:'prepaid_credit',currentBps:650,targetMode:'postpaid_daily',targetBps:850,
  balance:1,reserved:0,newBalance:1,newReserved:0
}),false,'Flex não pode receber conta com crédito remanescente');
assert.equal(prepaidTransitionAllowed({
  currentMode:'prepaid_credit',currentBps:650,targetMode:'postpaid_daily',targetBps:850,
  balance:1,reserved:1,newBalance:0,newReserved:0
}),true,'exaustão atômica pode retornar ao Flex');
transitionCases+=5;


function billingReconciliationFlags({
  accountBalance,ledgerBalance,accountReserved,orderReserved,
  billingMode,approvedPackage,packageLedgerOk,
  approvedStatement,statementPaid,pendingStatement,statementTermsOk
}){
  return {
    balanceMismatch:accountBalance!==ledgerBalance,
    reservationMismatch:accountReserved!==orderReserved,
    flexWithCredit:billingMode==='postpaid_daily'&&(accountBalance>0||accountReserved>0),
    approvedPackageWithoutLedger:approvedPackage&&!packageLedgerOk,
    approvedStatementNotPaid:approvedStatement&&!statementPaid,
    pendingStatementTermsChanged:pendingStatement&&!statementTermsOk
  };
}

let reconciliationCases=0;
for(let i=0;i<20000;i++){
  const ledgerBalance=int(0,1000000);
  const accountBalance=rnd()<0.92?ledgerBalance:int(0,1000000);
  const orderReserved=int(0,accountBalance);
  const accountReserved=rnd()<0.92?orderReserved:int(0,accountBalance);
  const billingMode=rnd()<0.7?'prepaid_credit':'postpaid_daily';
  const approvedPackage=rnd()<0.2;
  const packageLedgerOk=rnd()<0.95;
  const approvedStatement=rnd()<0.2;
  const statementPaid=rnd()<0.95;
  const pendingStatement=rnd()<0.2;
  const statementTermsOk=rnd()<0.95;
  const flags=billingReconciliationFlags({
    accountBalance,ledgerBalance,accountReserved,orderReserved,billingMode,
    approvedPackage,packageLedgerOk,approvedStatement,statementPaid,
    pendingStatement,statementTermsOk
  });

  assert.equal(flags.balanceMismatch,accountBalance!==ledgerBalance);
  assert.equal(flags.reservationMismatch,accountReserved!==orderReserved);
  assert.equal(flags.flexWithCredit,billingMode==='postpaid_daily'&&(accountBalance>0||accountReserved>0));
  assert.equal(flags.approvedPackageWithoutLedger,approvedPackage&&!packageLedgerOk);
  assert.equal(flags.approvedStatementNotPaid,approvedStatement&&!statementPaid);
  assert.equal(flags.pendingStatementTermsChanged,pendingStatement&&!statementTermsOk);
  reconciliationCases++;
}



function exactPaymentConfirmationAllowed(expectedCents,receivedCents,paymentMethod){
  return Number.isSafeInteger(expectedCents)
    && expectedCents>0
    && Number.isSafeInteger(receivedCents)
    && receivedCents===expectedCents
    && ['pix','bank_transfer','cash','card','other'].includes(paymentMethod);
}

let exactPaymentCases=0;
for(let i=0;i<20000;i++){
  const expected=int(1,100000000);
  const received=rnd()<0.8?expected:int(1,100000000);
  const methods=['pix','bank_transfer','cash','card','other','invalid',''];
  const method=methods[int(0,methods.length-1)];
  const allowed=exactPaymentConfirmationAllowed(expected,received,method);
  assert.equal(
    allowed,
    received===expected&&['pix','bank_transfer','cash','card','other'].includes(method),
    'aprovação financeira só pode ocorrer com valor exato e meio permitido'
  );
  exactPaymentCases++;
}

assert.equal(exactPaymentConfirmationAllowed(30000,29999,'pix'),false);
assert.equal(exactPaymentConfirmationAllowed(30000,30000,'pix'),true);
assert.equal(exactPaymentConfirmationAllowed(30000,30000,'invalid'),false);
exactPaymentCases+=3;

console.log(`Financial invariant fuzz passou: ${rewardCases} cenários de unit economics + ${positionCases} posições de cashback + ${prepaidCases} cenários de consumo de crédito de taxa + ${transitionCases} transições de pacote + ${reconciliationCases} cenários de reconciliação + ${exactPaymentCases} confirmações exatas de pagamento.`);
