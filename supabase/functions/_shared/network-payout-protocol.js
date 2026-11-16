// Pure protocol checks shared by the Deno payout executor and isolated Node tests.
// No network calls, no credentials, no Pix side effects.
const pop=/^POP[A-Za-z0-9_-]{8,75}$/;
const top=/^TOP[A-Za-z0-9_-]{8,75}$/;
const external=/^TAMAONET[A-F0-9]{32}$/;
export function normalizePixCpf(value){
 const cpf=String(value??"").replace(/[.\s-]/g,"");
 if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))
   throw Error("PAYOUT_PIX_CPF_INVALID");
 for(let digit=9;digit<=10;digit++){
   let sum=0;
   for(let i=0;i<digit;i++)sum+=Number(cpf[i])*(digit+1-i);
   if((sum*10)%11%10!==Number(cpf[digit]))throw Error("PAYOUT_PIX_CPF_INVALID");
 }
 return cpf;
}
export function assertCents(value){
 if(!Number.isSafeInteger(value)||value<100||value>10000000)
  throw Error("PAYOUT_CENTS_OUT_OF_RANGE");
 return value;
}
export function serializePayoutBody({cpf,cents,reference}){
 const chave=normalizePixCpf(cpf);
 assertCents(cents);
 if(!external.test(String(reference)))throw Error("PAYOUT_EXTERNAL_REFERENCE_INVALID");
 return JSON.stringify({
   external_reference:reference,
   description:"TAMAO network commission verified",
   transactions:[{
    description:"TAMAO verified network commission",
    type:"pix",pix:{type:"CPF",chave},
    amount:{currency:"BRL",value:Number((cents/100).toFixed(2))},
    external_reference:reference
   }]
 });
}
function amountMatches(value,cents,currency){
 const parsed=Number(value);
 return currency==="BRL"&&Number.isFinite(parsed)&&
  Number.isSafeInteger(Math.round(parsed*100))&&Math.round(parsed*100)===cents;
}
export function assertCreatePayoutResponse(payload,reference,cents){
 assertCents(cents);
 const tx=Array.isArray(payload?.transactions)&&payload.transactions.length===1
  ?payload.transactions[0]:null;
 const payoutId=String(payload?.id??"").trim();
 const transactionId=String(tx?.id??"").trim();
 if(!pop.test(payoutId)||!top.test(transactionId)||
   tx?.external_reference!==reference||
   !amountMatches(tx?.amount?.value,cents,tx?.amount?.currency))
   throw Error("PAYOUT_CREATE_RESPONSE_MISMATCH");
 return {payoutId,transactionId};
}
export function assertGetPayoutTransaction(payload,job){
 const transactionId=String(payload?.id??"").trim();
 if(!top.test(transactionId)||transactionId!==job?.providerTransactionId||
   payload?.external_reference!==job?.externalReference||
   !amountMatches(payload?.amount?.value,assertCents(job?.amountCents),
    payload?.amount?.currency))
   throw Error("PAYOUT_GET_MISMATCH");
 const status=String(payload?.status??"").trim().toLowerCase();
 const detail=String(payload?.status_detail??"").trim().toLowerCase();
 if(!/^[a-z_]{3,40}$/.test(status)||detail.length>80||
   !/^[a-z_]*$/.test(detail))
   throw Error("PAYOUT_GET_STATUS_INVALID");
 return {status,detail};
}
export function creditCanBeAsserted({status,detail,receiptVerified}){
 return status==="success"&&detail==="accredited"&&receiptVerified===true;
}
