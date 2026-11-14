// A paid PSP charge is a receipt. Verify the original request AND its actual
// entitlement before announcing credit or closing automatic recovery.
export async function readBillingEntitlement(admin,charge){
 const out={entitlementApplied:false,requestStatus:null,requestKind:null,reviewRequired:false};
 if(!charge?.payment_request_id)return out;
 const r=await admin.from('merchant_billing_payment_requests')
  .select('id,merchant_id,request_kind,plan_key,status,expected_amount_cents,credit_grant_cents_snapshot,received_amount_cents,approval_source,provider_payment_event_id,reconciliation_key,statement_id')
  .eq('id',charge.payment_request_id).maybeSingle();
 if(r.error||!r.data)throw Error('BILLING_ENTITLEMENT_REQUEST_UNAVAILABLE');
 const request=r.data;
 if(request.merchant_id!==charge.merchant_id||Number(request.expected_amount_cents)!==Number(charge.amount_cents))
  throw Error('BILLING_ENTITLEMENT_BINDING_MISMATCH');
 out.requestStatus=request.status;out.requestKind=request.request_kind;
 if(request.status!=='approved'){
  out.reviewRequired=['rejected','cancelled'].includes(request.status);return out;
 }
 const e=await admin.from('merchant_billing_payment_events')
  .select('id,status,payment_request_id,merchant_id,amount_cents,reconciliation_key')
  .eq('id',request.provider_payment_event_id).maybeSingle();
 if(e.error)throw Error('BILLING_ENTITLEMENT_EVENT_UNAVAILABLE');
 const event=e.data;
 if(request.approval_source!=='provider_event'||!event||event.status!=='applied'
  ||event.payment_request_id!==request.id||event.merchant_id!==request.merchant_id
  ||Number(event.amount_cents)!==Number(charge.amount_cents)
  ||Number(request.received_amount_cents)!==Number(charge.amount_cents)
  ||event.reconciliation_key!==request.reconciliation_key){out.reviewRequired=true;return out;}
 if(request.request_kind==='package_purchase'){
  const ledger=await admin.from('merchant_fee_credit_ledger')
   .select('merchant_id,amount_cents,plan_key',{count:'exact'})
   .eq('payment_request_id',request.id).eq('entry_type','package_credit').limit(2);
  if(ledger.error)throw Error('BILLING_ENTITLEMENT_LEDGER_UNAVAILABLE');
  out.entitlementApplied=ledger.count===1&&ledger.data?.length===1
   &&ledger.data[0].merchant_id===request.merchant_id
   &&ledger.data[0].plan_key===request.plan_key
   &&Number(ledger.data[0].amount_cents)===Number(request.credit_grant_cents_snapshot)
   &&Number(request.credit_grant_cents_snapshot)>0;
 }else if(request.request_kind==='statement_payment'){
  const statement=await admin.from('merchant_daily_statements')
   .select('merchant_id,status,amount_due_cents').eq('id',request.statement_id).maybeSingle();
  if(statement.error)throw Error('BILLING_ENTITLEMENT_STATEMENT_UNAVAILABLE');
  out.entitlementApplied=statement.data?.status==='paid'
   &&statement.data.merchant_id===request.merchant_id
   &&Number(statement.data.amount_due_cents)===Number(request.expected_amount_cents);
 }
 out.reviewRequired=!out.entitlementApplied;
 return out;
}
