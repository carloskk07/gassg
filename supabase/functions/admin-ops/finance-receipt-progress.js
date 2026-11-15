// Read the SAME receipt, entitlement and NET proof. Global counts never bind
// unrelated payments/credits into a completed financial receiving cycle.
import {readPaymentEntitlement} from '../_shared/payment-entitlement.js';
const FAMILIES={coupons:{kind:'coupon',table:'clube_coupon_paid_invoices',id:'id',amount:'sale_price_cents'},
 mobility:{kind:'mobility',table:'mobility_fee_pix_invoices_v1_837',id:'id',amount:'amount_cents'},
 merchants:{kind:'billing',table:'merchant_billing_provider_charges',id:'id',amount:'amount_cents'},
 advertising:{kind:'advertising',table:'ads_independent_checkouts_v1_886',id:'campaign_id',amount:'amount_cents'}};
const BINDINGS={billing:{order:'provider_charge_id',reference:'correlation_id'},
 mobility:{order:'provider_order_id',reference:'external_reference'},
 advertising:{order:null,reference:'external_reference'}};
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v??''));
const amount=n=>Number.isSafeInteger(n)&&n>=0;
const dated=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const states=['net_verified','awaiting_report','coverage_incomplete','provider_unavailable','requires_review','reversed'];
export function validateFinanceReceiptSummary(summary){
 if(summary?.source!=='platform_receipt_net_summary'||summary.readOnly!==true||summary.moneyMoved!==false||
  summary.merchantFundsIncluded!==false||summary.accountBalanceVerified!==false||
  !amount(summary.totalCount)||!amount(summary.returnedCount)||summary.returnedCount!==Math.min(summary.totalCount,30)||
  summary.truncated!==(summary.totalCount>30)||!dated(summary.generatedAt)||
  !Array.isArray(summary.rows)||summary.rows.length!==summary.returnedCount||!summary.kindTotals)
  return false;
 let total=0;
 for(const {kind} of Object.values(FAMILIES)){
  const k=summary.kindTotals[kind];
  if(!k||!['count','grossCents','verifiedCount','verifiedNetCents','pendingCount','reversedCount'].every(f=>amount(k[f]))||
   k.verifiedCount+k.pendingCount+k.reversedCount!==k.count||k.verifiedNetCents>k.grossCents)return false;
  total+=k.count;
 }
 return total===summary.totalCount&&new Set(summary.rows.map(r=>r.kind+':'+r.resourceId)).size===summary.rows.length&&
  summary.rows.every(r=>Object.values(FAMILIES).some(s=>s.kind===r.kind)&&uuid(r.resourceId)&&
   states.includes(r.netStatus)&&amount(r.grossCents)&&r.grossCents>0&&dated(r.paidAt)&&
   (r.netCents===null||amount(r.netCents)&&r.netCents>0&&r.netCents<=r.grossCents)&&
   (r.netStatus!=='net_verified'||r.netCents!==null&&dated(r.verifiedAt)&&String(r.evidenceReference??'').startsWith('mp-release:')));
}
const progress=(state,extra={})=>({source:'canonical_receipt_progress',readOnly:true,moneyMoved:false,
 state,receivingCompleted:false,refundCompleted:false,paymentRecorded:false,entitlementVerified:false,
 netRecorded:false,netCents:null,historicalNet:false,reviewRequired:false,
 commercialCycleVerified:false,bankPayoutVerified:false,...extra});

export async function readFinanceReceiptProgress(admin,actorId){
 const response=await admin.rpc('admin_platform_receipt_net_summary',{p_actor_user_id:actorId});
 if(response.error||!validateFinanceReceiptSummary(response.data))throw Error('FINANCE_RECEIPT_SUMMARY_UNAVAILABLE');
 const summary=response.data,results={};
 await Promise.all(Object.entries(FAMILIES).map(async([key,spec])=>{
  const candidates=summary.rows.filter(r=>r.kind===spec.kind);
  // Prefer a presently verified receipt, then the most recent receipt. One
  // representative proof is NEVER a claim that all payments were inspected.
  const receipt=candidates.find(r=>r.netStatus==='net_verified')??candidates[0];
  if(!receipt){
   results[key]=progress(summary.kindTotals[spec.kind].count>0?'outside_recent_window':'no_receipt');return;
  }
  try{
   const {data:row,error}=await admin.from(spec.table).select('*').eq(spec.id,receipt.resourceId).maybeSingle();
   if(error||!row)throw Error('RECEIPT_READ_UNAVAILABLE');
   if(row[spec.id]!==receipt.resourceId||Number(row[spec.amount])!==receipt.grossCents||row.status!==receipt.businessStatus)
    throw Error('RECEIPT_CHANGED_DURING_READ');
   const refunded=spec.kind==='coupon'&&row.status==='refunded';
   const positive=spec.kind==='billing'?row.status==='completed':spec.kind==='advertising'?row.status==='payment_approved':row.status==='paid';
   const paidAt=spec.kind==='billing'?row.completed_at:spec.kind==='advertising'?row.approved_at:row.paid_at;
   if(!dated(paidAt)||!positive&&!refunded){results[key]=progress('requires_review',{reviewRequired:true});return;}
   const entitlement=await readPaymentEntitlement(spec.kind,admin,row);
   let net=receipt.netCents!==null&&dated(receipt.verifiedAt)&&String(receipt.evidenceReference??'').startsWith('mp-release:')&&
    (receipt.netStatus==='net_verified'||refunded&&receipt.netStatus==='reversed');
   if(net){
    if(spec.kind==='coupon'){
     net=Number(row.net_proceeds_cents)===receipt.netCents&&row.net_proceeds_reference===receipt.evidenceReference&&
      dated(row.net_proceeds_verified_at)&&Date.parse(row.net_proceeds_verified_at)===Date.parse(receipt.verifiedAt);
    }else{
     const audit=await admin.from('platform_receipt_net_audit')
      .select('resource_id,kind,gross_cents,net_cents,provider_order_id,provider_payment_id,external_reference,evidence_reference')
      .eq('kind',spec.kind).eq('resource_id',receipt.resourceId).maybeSingle();
     if(audit.error)throw Error('NET_AUDIT_READ_UNAVAILABLE');
     const a=audit.data,b=BINDINGS[spec.kind];
     net=!!a&&a.resource_id===row[spec.id]&&a.kind===spec.kind&&Number(a.gross_cents)===Number(row[spec.amount])&&
      Number(a.net_cents)===receipt.netCents&&a.evidence_reference===receipt.evidenceReference&&
      a.external_reference===row[b.reference]&&(b.order?a.provider_order_id===row[b.order]:a.provider_order_id===null)&&
      (spec.kind!=='advertising'||a.provider_payment_id===row.payment_id);
    }
    if(!net){results[key]=progress('requires_review',{reviewRequired:true,paymentRecorded:true});return;}
   }
   let refundCompleted=false;
   if(refunded){
    const refund=await admin.from('clube_coupon_refund_requests_v1_814')
     .select('invoice_id,customer_user_id,status').eq('invoice_id',row.id).maybeSingle();
    if(refund.error)throw Error('REFUND_READ_UNAVAILABLE');
    refundCompleted=entitlement.entitlementApplied===true&&refund.data?.invoice_id===row.id&&
     refund.data?.customer_user_id===row.customer_user_id&&refund.data?.status==='refunded';
   }
   const review=entitlement.reviewRequired===true||receipt.netStatus==='requires_review'||refunded&&!refundCompleted;
   const completed=positive&&entitlement.entitlementApplied===true&&net&&receipt.netStatus==='net_verified'&&!review;
   results[key]=progress(review?'requires_review':refunded?'refunded':completed?'receiving_completed':
    entitlement.entitlementApplied?'awaiting_net':'awaiting_entitlement',{
    paymentRecorded:true,entitlementVerified:entitlement.entitlementApplied===true,netRecorded:net&&!review,
    netCents:net&&!review?receipt.netCents:null,historicalNet:refunded&&net&&!review,
    receivingCompleted:completed,refundCompleted,reviewRequired:review});
  }catch{results[key]=progress('unavailable');}
 }));
 return {source:'canonical_receipt_progress',readOnly:true,moneyMoved:false,
  representativeReceipts:true,windowLimit:30,completeInventory:summary.truncated!==true,
  checkedAt:summary.generatedAt,modules:results};
}

export function applyFinanceReceiptProgress(modules,evidence){
 if(evidence?.source!=='canonical_receipt_progress'||evidence.readOnly!==true||evidence.moneyMoved!==false||
  !Array.isArray(modules)||!evidence.modules)throw Error('FINANCE_RECEIPT_PROGRESS_INVALID');
 return modules.map(mod=>{
  const receipt=evidence.modules[mod.key];
  if(!receipt)return mod;
  const diagnosis={...mod.diagnosis,receiptProgress:receipt};
  if(receipt.state==='receiving_completed'){
   diagnosis.progressLabel='Recebimento, benefício e líquido conferidos na mesma cobrança';
   diagnosis.nextAction=mod.key==='advertising'
    ?'O recebimento da campanha está concluído. Acompanhar a veiculação existente e eventuais cancelamentos autorizados.'
    :'O recebimento está concluído. Continuar o uso e a reversão dos benefícios existentes, sem repetir o Pix.';
  }else if(receipt.state==='refunded'&&receipt.refundCompleted){
   diagnosis.progressLabel='Devolução e cancelamento dos cupons conferidos';
   diagnosis.nextAction='A compra anterior foi encerrada. Preservar os cupons cancelados; o resgate comercial ainda exige uma compra elegível legítima.';
  }else if(receipt.state==='awaiting_net'){
   diagnosis.progressLabel='Pagamento e benefício conferidos; líquido em conciliação';
   diagnosis.nextAction='Aguardar a conferência automática do relatório do provedor para a cobrança existente.';
  }else if(['requires_review','awaiting_entitlement','unavailable','outside_recent_window'].includes(receipt.state)){
   diagnosis.progressLabel=receipt.state==='unavailable'?'Conferência da cobrança indisponível':
    receipt.state==='outside_recent_window'?'Há recebimentos fora da janela de conferência':'Cobrança exige conferência do benefício';
   diagnosis.nextAction='Consultar a cobrança original e o histórico de recebimentos antes de iniciar outra operação.';
  }
  return {...mod,diagnosis};
 });
}
