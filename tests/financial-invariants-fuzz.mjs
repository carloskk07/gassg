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


function d1StatementPaidAllowed({amountDueCents,approvedExactPaymentRequest}){
  if(amountDueCents<=0)return true;
  return approvedExactPaymentRequest===true;
}

let d1AuthorityCases=0;
for(let i=0;i<20000;i++){
  const amountDue=int(0,100000000);
  const hasApprovedExact=rnd()<0.75;
  const allowed=d1StatementPaidAllowed({
    amountDueCents:amountDue,
    approvedExactPaymentRequest:hasApprovedExact
  });
  assert.equal(
    allowed,
    amountDue<=0||hasApprovedExact,
    'fechamento D+1 positivo só pode ficar pago com solicitação exata aprovada'
  );
  d1AuthorityCases++;
}
assert.equal(d1StatementPaidAllowed({amountDueCents:1,approvedExactPaymentRequest:false}),false);
assert.equal(d1StatementPaidAllowed({amountDueCents:1,approvedExactPaymentRequest:true}),true);
assert.equal(d1StatementPaidAllowed({amountDueCents:0,approvedExactPaymentRequest:false}),true);
d1AuthorityCases+=3;


function reconciliationKeyCanApprove(approvedKeys,key){
  const normalized=String(key||'').trim().toLowerCase();
  if(normalized.length<6||normalized.length>160)return false;
  return !approvedKeys.has(normalized);
}

let reconciliationKeyCases=0;
const approvedKeys=new Set();
for(let i=0;i<20000;i++){
  const unique='tx-'+i.toString(36).padStart(6,'0');
  assert.equal(reconciliationKeyCanApprove(approvedKeys,unique),true);
  approvedKeys.add(unique.toLowerCase());
  assert.equal(reconciliationKeyCanApprove(approvedKeys,unique.toUpperCase()),false,'mesmo ID com caixa diferente não pode ser reutilizado');
  reconciliationKeyCases+=2;
}
assert.equal(reconciliationKeyCanApprove(new Set(),'abc'),false);
assert.equal(reconciliationKeyCanApprove(new Set(['pix-e2e-123456']),' PIX-E2E-123456 '),false);
reconciliationKeyCases+=2;


function matchProviderPaymentEvent({key,amount,pending,approved}){
  const normalized=String(key||'').trim().toLowerCase();
  const already=approved.find(x=>String(x.reconciliationKey||'').trim().toLowerCase()===normalized);
  if(already){
    return already.receivedAmountCents===amount
      ?{status:'already_applied',requestId:already.id}
      :{status:'review_required',reason:'transaction_key_already_used_with_other_amount'};
  }
  const exact=pending.filter(x=>
    x.expectedAmountCents===amount
    &&String(x.merchantReference||'').trim().toLowerCase()===normalized
  );
  if(exact.length===1)return {status:'matched_exact',requestId:exact[0].id};
  if(exact.length>1)return {status:'review_required',reason:'multiple_exact_candidates'};
  const sameReference=pending.some(x=>String(x.merchantReference||'').trim().toLowerCase()===normalized);
  return {
    status:'review_required',
    reason:sameReference?'reference_found_but_amount_differs':'no_exact_pending_request'
  };
}

let providerEventCases=0;
for(let i=0;i<20000;i++){
  const key='e2e-'+i.toString(36).padStart(8,'0');
  const amount=int(1,10000000);
  const exact={id:'r-'+i,expectedAmountCents:amount,merchantReference:key};
  const result=matchProviderPaymentEvent({
    key,
    amount,
    pending:[exact],
    approved:[]
  });
  assert.equal(result.status,'matched_exact');
  assert.equal(result.requestId,exact.id);

  const mismatch=matchProviderPaymentEvent({
    key,
    amount:amount+1,
    pending:[exact],
    approved:[]
  });
  assert.equal(mismatch.status,'review_required');
  assert.equal(mismatch.reason,'reference_found_but_amount_differs');

  const duplicate=matchProviderPaymentEvent({
    key,
    amount,
    pending:[exact,{...exact,id:'r2-'+i}],
    approved:[]
  });
  assert.equal(duplicate.status,'review_required');
  assert.equal(duplicate.reason,'multiple_exact_candidates');

  const applied=matchProviderPaymentEvent({
    key:key.toUpperCase(),
    amount,
    pending:[],
    approved:[{id:'a-'+i,reconciliationKey:key,receivedAmountCents:amount}]
  });
  assert.equal(applied.status,'already_applied');
  providerEventCases+=4;
}

assert.equal(matchProviderPaymentEvent({
  key:'unknown-123456',amount:100,pending:[],approved:[]
}).reason,'no_exact_pending_request');
providerEventCases++;


function reactiveProviderEventState({event,requests}){
  if(['applied','already_applied','ignored'].includes(event.status))return {...event};
  const key=String(event.reconciliationKey||'').trim().toLowerCase();
  const approved=requests.find(x=>
    x.status==='approved'
    &&String(x.reconciliationKey||'').trim().toLowerCase()===key
  );
  if(approved){
    return approved.receivedAmountCents===event.amountCents
      ?{...event,status:'already_applied',requestId:approved.id,reason:'approved_payment_already_uses_transaction'}
      :{...event,status:'review_required',requestId:null,reason:'transaction_key_already_used_with_other_amount'};
  }
  const exact=requests.filter(x=>
    x.status==='pending'
    &&x.expectedAmountCents===event.amountCents
    &&String(x.merchantReference||'').trim().toLowerCase()===key
  );
  if(exact.length===1)return {...event,status:'matched_exact',requestId:exact[0].id,reason:'exact_reference_and_amount'};
  if(exact.length>1)return {...event,status:'review_required',requestId:null,reason:'multiple_exact_candidates'};
  const sameRef=requests.some(x=>
    x.status==='pending'
    &&String(x.merchantReference||'').trim().toLowerCase()===key
  );
  return {...event,status:'review_required',requestId:null,reason:sameRef?'reference_found_but_amount_differs':'no_exact_pending_request'};
}

let reactiveProviderCases=0;
for(let i=0;i<20000;i++){
  const key='reactive-'+i.toString(36).padStart(7,'0');
  const amount=int(1,10000000);
  const event={status:'review_required',reconciliationKey:key,amountCents:amount,requestId:null};

  const before=reactiveProviderEventState({event,requests:[]});
  assert.equal(before.status,'review_required');
  assert.equal(before.reason,'no_exact_pending_request');

  const r1={id:'r1-'+i,status:'pending',merchantReference:key,expectedAmountCents:amount};
  const one=reactiveProviderEventState({event:before,requests:[r1]});
  assert.equal(one.status,'matched_exact');
  assert.equal(one.requestId,r1.id);

  const r2={id:'r2-'+i,status:'pending',merchantReference:key.toUpperCase(),expectedAmountCents:amount};
  const ambiguous=reactiveProviderEventState({event:one,requests:[r1,r2]});
  assert.equal(ambiguous.status,'review_required');
  assert.equal(ambiguous.reason,'multiple_exact_candidates');
  assert.equal(ambiguous.requestId,null);

  r1.status='cancelled';
  const rematched=reactiveProviderEventState({event:ambiguous,requests:[r1,r2]});
  assert.equal(rematched.status,'matched_exact');
  assert.equal(rematched.requestId,r2.id);

  r2.status='rejected';
  const released=reactiveProviderEventState({event:rematched,requests:[r1,r2]});
  assert.equal(released.status,'review_required');
  assert.equal(released.reason,'no_exact_pending_request');
  assert.equal(released.requestId,null);

  reactiveProviderCases+=5;
}


function providerApprovalProvenanceAllowed({
  requestId,merchantId,expectedAmountCents,
  receivedAmountCents,paymentMethod,reconciliationKey,event
}){
  if(receivedAmountCents!==expectedAmountCents)return false;
  if(!event)return true;
  return event.status==='matched_exact'
    &&event.paymentRequestId===requestId
    &&event.merchantId===merchantId
    &&event.amountCents===receivedAmountCents
    &&event.paymentMethod===paymentMethod
    &&String(event.reconciliationKey||'').trim().toLowerCase()
      ===String(reconciliationKey||'').trim().toLowerCase();
}

let provenanceCases=0;
for(let i=0;i<20000;i++){
  const requestId='req-'+i;
  const merchantId='m-'+i;
  const amount=int(1,10000000);
  const key='e2e-prov-'+i.toString(36).padStart(7,'0');
  const method=['pix','bank_transfer','cash','card','other'][int(0,4)];
  const event={
    status:'matched_exact',
    paymentRequestId:requestId,
    merchantId,
    amountCents:amount,
    paymentMethod:method,
    reconciliationKey:key
  };

  assert.equal(providerApprovalProvenanceAllowed({
    requestId,merchantId,expectedAmountCents:amount,
    receivedAmountCents:amount,paymentMethod:method,
    reconciliationKey:key.toUpperCase(),event
  }),true);

  assert.equal(providerApprovalProvenanceAllowed({
    requestId,merchantId,expectedAmountCents:amount,
    receivedAmountCents:amount+1,paymentMethod:method,
    reconciliationKey:key,event
  }),false);

  assert.equal(providerApprovalProvenanceAllowed({
    requestId,merchantId,expectedAmountCents:amount,
    receivedAmountCents:amount,paymentMethod:method,
    reconciliationKey:key,event:{...event,paymentRequestId:'other'}
  }),false);

  assert.equal(providerApprovalProvenanceAllowed({
    requestId,merchantId,expectedAmountCents:amount,
    receivedAmountCents:amount,paymentMethod:method,
    reconciliationKey:key,event:{...event,status:'review_required'}
  }),false);

  assert.equal(providerApprovalProvenanceAllowed({
    requestId,merchantId,expectedAmountCents:amount,
    receivedAmountCents:amount,paymentMethod:method,
    reconciliationKey:key,event:null
  }),true,'aprovação manual continua permitida com confirmação financeira exata');

  provenanceCases+=5;
}


function paymentEventReviewActionAllowed(status,action,reason=''){
  if(action==='recheck')return ['received','review_required','matched_exact'].includes(status)||['applied','already_applied','ignored'].includes(status);
  if(action==='ignore')return status==='review_required'&&String(reason).trim().length>=3;
  return false;
}

let paymentEventReviewCases=0;
for(let i=0;i<20000;i++){
  const reason='motivo-'+i;
  assert.equal(paymentEventReviewActionAllowed('review_required','ignore',reason),true);
  assert.equal(paymentEventReviewActionAllowed('matched_exact','ignore',reason),false);
  assert.equal(paymentEventReviewActionAllowed('applied','ignore',reason),false);
  assert.equal(paymentEventReviewActionAllowed('review_required','ignore','x'),false);
  assert.equal(paymentEventReviewActionAllowed('review_required','recheck'),true);
  assert.equal(paymentEventReviewActionAllowed('ignored','recheck'),true,'recheck terminal deve ser replay seguro sem reabrir o evento');
  paymentEventReviewCases+=6;
}


function financeQueueSlaClass({kind,status,ageHours,matchedExact=false}){
  if(kind==='provider_event'&&status==='matched_exact'){
    return ageHours>=2?'matched_breach':'matched_ok';
  }
  if(kind==='provider_event'&&status==='review_required'){
    return ageHours>=4?'review_breach':'review_ok';
  }
  if(kind==='payment_request'&&status==='pending'&&!matchedExact){
    return ageHours>=24?'pending_breach':'pending_ok';
  }
  return 'not_actionable';
}

let financeSlaCases=0;
for(let i=0;i<20000;i++){
  const matchedAge=(i%4===0)?1.99:2+(i%72)/10;
  const reviewAge=(i%5===0)?3.99:4+(i%120)/10;
  const pendingAge=(i%6===0)?23.99:24+(i%240)/10;

  assert.equal(
    financeQueueSlaClass({kind:'provider_event',status:'matched_exact',ageHours:matchedAge}),
    matchedAge>=2?'matched_breach':'matched_ok'
  );
  assert.equal(
    financeQueueSlaClass({kind:'provider_event',status:'review_required',ageHours:reviewAge}),
    reviewAge>=4?'review_breach':'review_ok'
  );
  assert.equal(
    financeQueueSlaClass({kind:'payment_request',status:'pending',ageHours:pendingAge,matchedExact:false}),
    pendingAge>=24?'pending_breach':'pending_ok'
  );
  assert.equal(
    financeQueueSlaClass({kind:'payment_request',status:'pending',ageHours:48,matchedExact:true}),
    'not_actionable',
    'solicitação já conciliada deve seguir SLA de 2h do evento, não duplicar alerta >24h'
  );
  financeSlaCases+=4;
}


function canonicalProviderEventDecision({existingMatched,eventKey,eventStatus}){
  if(['applied','already_applied','ignored'].includes(eventStatus))return eventStatus;
  const duplicate=existingMatched.some(x=>
    String(x.key||'').trim().toLowerCase()===String(eventKey||'').trim().toLowerCase()
  );
  return duplicate?'duplicate_transaction_event':'eligible_for_matching';
}

function approvalEventTerminalStatus({approvalSource,eventSelected}){
  if(approvalSource==='provider_event'&&eventSelected)return 'applied';
  if(approvalSource==='manual')return 'already_applied';
  return 'unchanged';
}

let canonicalEventCases=0;
for(let i=0;i<20000;i++){
  const key='canon-'+i.toString(36).padStart(8,'0');
  assert.equal(
    canonicalProviderEventDecision({
      existingMatched:[{key}],
      eventKey:key.toUpperCase(),
      eventStatus:'review_required'
    }),
    'duplicate_transaction_event'
  );
  assert.equal(
    canonicalProviderEventDecision({
      existingMatched:[{key:'other-'+key}],
      eventKey:key,
      eventStatus:'review_required'
    }),
    'eligible_for_matching'
  );
  assert.equal(
    canonicalProviderEventDecision({
      existingMatched:[{key}],
      eventKey:key,
      eventStatus:'already_applied'
    }),
    'already_applied'
  );
  assert.equal(approvalEventTerminalStatus({approvalSource:'provider_event',eventSelected:true}),'applied');
  assert.equal(approvalEventTerminalStatus({approvalSource:'manual',eventSelected:false}),'already_applied');
  canonicalEventCases+=5;
}


function normalizeWooviReceivedPix(body){
  if(!body||body.event!=='OPENPIX:TRANSACTION_RECEIVED')return null;
  const pix=body.pix;
  if(!pix||pix.status!=='CONFIRMED')return null;
  const key=String(pix.endToEndId||'').trim();
  const amount=Number(pix.value);
  const occurredAt=Date.parse(String(pix.time||pix.createdAt||''));
  if(!/^[A-Za-z0-9]{20,80}$/.test(key))return null;
  if(!Number.isSafeInteger(amount)||amount<=0)return null;
  if(!Number.isFinite(occurredAt))return null;
  return {
    provider:'woovi',
    providerEventId:'OPENPIX:TRANSACTION_RECEIVED:'+key,
    reconciliationKey:key,
    paymentMethod:'pix',
    amountCents:amount
  };
}

let wooviAdapterCases=0;
for(let i=0;i<20000;i++){
  const suffix=i.toString(36).padStart(11,'0');
  const e2e='E12345678202610071234'+suffix;
  const amount=int(1,10000000);
  const payload={
    event:'OPENPIX:TRANSACTION_RECEIVED',
    pix:{
      endToEndId:e2e,
      value:amount,
      time:'2026-10-07T20:10:56.000Z',
      status:'CONFIRMED'
    }
  };
  const normalized=normalizeWooviReceivedPix(payload);
  assert.equal(normalized?.provider,'woovi');
  assert.equal(normalized?.reconciliationKey,e2e);
  assert.equal(normalized?.amountCents,amount);
  assert.equal(normalized?.paymentMethod,'pix');
  assert.equal(normalizeWooviReceivedPix({...payload,event:'OPENPIX:CHARGE_EXPIRED'}),null);
  assert.equal(normalizeWooviReceivedPix({...payload,pix:{...payload.pix,status:'PENDING'}}),null);
  wooviAdapterCases+=6;
}


function normalizeWooviChargeCompleted(body){
  if(!body||body.event!=='OPENPIX:CHARGE_COMPLETED')return null;
  const charge=body.charge;
  const pix=body.pix;
  if(!charge||!pix||charge.status!=='COMPLETED'||pix.status!=='CONFIRMED')return null;
  const correlationId=String(charge.correlationID||'').trim();
  const endToEndId=String(pix.endToEndId||'').trim();
  const chargeAmount=Number(charge.value);
  const pixAmount=Number(pix.value);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationId))return null;
  if(!/^[A-Za-z0-9]{20,80}$/.test(endToEndId))return null;
  if(!Number.isSafeInteger(chargeAmount)||chargeAmount<=0||chargeAmount!==pixAmount)return null;
  return {correlationId,endToEndId,amountCents:chargeAmount};
}

function generatedPixMatchDecision({
  requestId,chargeRequestId,requestStatus,requestAmount,chargeAmount,eventAmount,
  correlationId,eventCorrelationId
}){
  if(String(correlationId).toLowerCase()!==String(eventCorrelationId).toLowerCase())return 'no_charge_correlation';
  if(requestId!==chargeRequestId)return 'provider_charge_request_mismatch';
  if(requestStatus!=='pending')return 'provider_charge_request_not_pending';
  if(requestAmount!==chargeAmount||requestAmount!==eventAmount)return 'provider_charge_amount_mismatch';
  return 'provider_charge_correlation_and_amount';
}

let generatedPixCases=0;
for(let i=0;i<20000;i++){
  const suffix=i.toString(16).padStart(12,'0');
  const correlationId='12345678-1234-4abc-8def-'+suffix;
  const e2e='E1234567820261007'+i.toString(36).padStart(20,'0');
  const amount=int(1,10000000);
  const body={
    event:'OPENPIX:CHARGE_COMPLETED',
    charge:{correlationID:correlationId,value:amount,status:'COMPLETED'},
    pix:{endToEndId:e2e,value:amount,status:'CONFIRMED'}
  };
  const normalized=normalizeWooviChargeCompleted(body);
  assert.equal(normalized?.correlationId,correlationId);
  assert.equal(normalized?.endToEndId,e2e);
  assert.equal(normalized?.amountCents,amount);
  assert.equal(normalizeWooviChargeCompleted({...body,pix:{...body.pix,value:amount+1}}),null);
  assert.equal(normalizeWooviChargeCompleted({...body,charge:{...body.charge,status:'ACTIVE'}}),null);

  const args={
    requestId:'req-'+i,
    chargeRequestId:'req-'+i,
    requestStatus:'pending',
    requestAmount:amount,
    chargeAmount:amount,
    eventAmount:amount,
    correlationId,
    eventCorrelationId:correlationId.toUpperCase()
  };
  assert.equal(generatedPixMatchDecision(args),'provider_charge_correlation_and_amount');
  assert.equal(generatedPixMatchDecision({...args,eventAmount:amount+1}),'provider_charge_amount_mismatch');
  assert.equal(generatedPixMatchDecision({...args,requestStatus:'cancelled'}),'provider_charge_request_not_pending');
  assert.equal(generatedPixMatchDecision({...args,eventCorrelationId:'22345678-1234-4abc-8def-'+suffix}),'no_charge_correlation');
  generatedPixCases+=9;
}


function siblingProviderEventDecision({
  canonicalStatus='matched_exact',
  canonicalProvider,canonicalKey,canonicalAmount,canonicalMethod,canonicalCurrency='BRL',
  incomingProvider,incomingKey,incomingAmount,incomingMethod,incomingCurrency='BRL',
  incomingCorrelation=null
}){
  if(canonicalStatus!=='matched_exact')return 'no_canonical_match';
  const same=
    String(canonicalProvider).toLowerCase()===String(incomingProvider).toLowerCase()
    &&String(canonicalKey).toLowerCase()===String(incomingKey).toLowerCase()
    &&canonicalAmount===incomingAmount
    &&canonicalMethod===incomingMethod
    &&canonicalCurrency===incomingCurrency;
  if(same&&incomingCorrelation==null)return 'superseded';
  return 'review_required';
}

function unresolvedSiblingResolution({
  status,matchReason,providerCorrelationId,provider,key,amount,method,currency='BRL',
  chargeProvider,chargeKey,chargeAmount,chargeMethod,chargeCurrency='BRL'
}){
  const same=
    provider===chargeProvider
    &&String(key).toLowerCase()===String(chargeKey).toLowerCase()
    &&amount===chargeAmount
    &&method===chargeMethod
    &&currency===chargeCurrency;
  return status==='review_required'
    &&matchReason==='no_exact_pending_request'
    &&providerCorrelationId==null
    &&same
      ?'superseded'
      :'preserve';
}

let siblingProviderCases=0;
for(let i=0;i<20000;i++){
  const key='E1234567820261007'+i.toString(36).padStart(20,'0');
  const amount=int(1,10000000);
  const base={
    canonicalProvider:'woovi',
    canonicalKey:key,
    canonicalAmount:amount,
    canonicalMethod:'pix',
    incomingProvider:'woovi',
    incomingKey:key.toLowerCase(),
    incomingAmount:amount,
    incomingMethod:'pix'
  };
  assert.equal(siblingProviderEventDecision(base),'superseded');
  assert.equal(siblingProviderEventDecision({...base,incomingAmount:amount+1}),'review_required');
  assert.equal(siblingProviderEventDecision({...base,incomingProvider:'other'}),'review_required');
  assert.equal(siblingProviderEventDecision({...base,incomingMethod:'bank_transfer'}),'review_required');
  assert.equal(siblingProviderEventDecision({...base,incomingCorrelation:'12345678-1234-4abc-8def-'+i.toString(16).padStart(12,'0')}),'review_required');

  const review={
    status:'review_required',
    matchReason:'no_exact_pending_request',
    providerCorrelationId:null,
    provider:'woovi',key,amount,method:'pix',
    chargeProvider:'woovi',chargeKey:key,chargeAmount:amount,chargeMethod:'pix'
  };
  assert.equal(unresolvedSiblingResolution(review),'superseded');
  assert.equal(unresolvedSiblingResolution({...review,matchReason:'reference_found_but_amount_differs'}),'preserve');
  assert.equal(unresolvedSiblingResolution({...review,chargeAmount:amount+1}),'preserve');
  assert.equal(unresolvedSiblingResolution({...review,providerCorrelationId:'some-correlation'}),'preserve');
  siblingProviderCases+=9;
}

console.log(`Financial invariant fuzz passou: ${rewardCases} cenários de unit economics + ${positionCases} posições de cashback + ${prepaidCases} cenários de consumo de crédito de taxa + ${transitionCases} transições de pacote + ${reconciliationCases} cenários de reconciliação + ${exactPaymentCases} confirmações exatas de pagamento + ${d1AuthorityCases} cenários de autoridade D+1 + ${reconciliationKeyCases} cenários de unicidade de conciliação + ${providerEventCases} cenários de eventos de provedor + ${reactiveProviderCases} transições reativas de conciliação + ${provenanceCases} provas de proveniência de aprovação + ${paymentEventReviewCases} decisões de lifecycle de eventos + ${financeSlaCases} classificações de SLA financeiro + ${canonicalEventCases} decisões de evento canônico + ${wooviAdapterCases} normalizações Woovi/OpenPix + ${generatedPixCases} decisões de cobrança Pix correlacionada + ${siblingProviderCases} decisões de evento irmão do PSP.`);
