// Read-only proof of money released in the PLATFORM's Mercado Pago account.
// Reuses the strict CSV parser; never credits a wallet or proves merchant payout.
import {parseReleasedMoneyCsv,releasedMoneyCents} from '../admin-ops/coupon-release-evidence.js';
const numericId=v=>/^[1-9][0-9]{2,19}$/.test(String(v??''));
const cents=v=>{
 const raw=String(v??'');
 if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw))return null;
 return releasedMoneyCents(Number(raw).toFixed(2));
};
const validDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const empty=reason=>({eligible:false,reason,netCents:null,readOnly:true,moneyMoved:false,merchantPayoutVerified:false});

export function platformReleasedNetEvidence({receipt,sellerId,order=null,payments,reports,nowMs=Date.now()}){
 if(!['billing','advertising','mobility'].includes(receipt?.kind)||receipt?.reversed!==false||
   !Number.isSafeInteger(receipt?.gross_cents)||receipt.gross_cents<=0||
   !validDate(receipt?.paid_at)||Date.parse(receipt.paid_at)>nowMs||
   typeof receipt?.external_reference!=='string'||!receipt.external_reference||
   !numericId(sellerId)||!Array.isArray(payments)||payments.length<1||payments.length>3||
   !Array.isArray(reports)||reports.length<1||reports.length>10)
  return empty('PLATFORM_RELEASE_LOCAL_PROOF_INCOMPLETE');
 const hasOrder=receipt.kind!=='advertising';
 let pix=null;
 if(hasOrder){
  const ps=order?.transactions?.payments;
  pix=Array.isArray(ps)&&ps.length===1?ps[0]:null;
  if(!receipt.provider_order_id||!receipt.provider_payment_id||!pix||
    String(order?.id??'')!==receipt.provider_order_id||
    String(order?.user_id??'')!==String(sellerId)||
    order?.external_reference!==receipt.external_reference||
    order?.live_mode===false||pix.live_mode===false||
    order?.status!=='processed'||!['','accredited'].includes(String(order?.status_detail??''))||
    !['processed','approved','accredited'].includes(String(pix.status??''))||
    !['','accredited'].includes(String(pix.status_detail??''))||
    String(pix.id??'')!==receipt.provider_payment_id||
    pix?.payment_method?.id!=='pix'||pix?.payment_method?.type!=='bank_transfer'||
    cents(order.total_amount)!==receipt.gross_cents||cents(pix.amount)!==receipt.gross_cents||
    [order?.currency,order?.currency_id,pix.currency,pix.currency_id].some(x=>x!=null&&x!=='BRL')||
    ['refunds','chargebacks'].some(k=>Array.isArray(order?.transactions?.[k])&&order.transactions[k].length))
   return empty('PLATFORM_RELEASE_ORDER_BINDING_UNVERIFIED');
 }
 const verified=new Map(),approvedAt=new Map();
 for(const p of payments){
  const id=String(p?.id??''),net=cents(p?.transaction_details?.net_received_amount);
  const refs=p?.point_of_interaction?.references;
  if(!numericId(id)||verified.has(id)||p?.live_mode!==true||
    String(p?.collector_id??'')!==String(sellerId)||p?.external_reference!==receipt.external_reference||
    p?.currency_id!=='BRL'||p?.payment_method_id!=='pix'||p?.payment_type_id!=='bank_transfer'||
    p?.status!=='approved'||p?.status_detail!=='accredited'||p?.money_release_status!=='released'||
    !validDate(p?.money_release_date)||Date.parse(p.money_release_date)>nowMs+300000||
    !validDate(p?.date_approved)||Date.parse(p.date_approved)>nowMs+300000||
    cents(p?.transaction_amount)!==receipt.gross_cents||
    cents(p?.transaction_details?.total_paid_amount)!==receipt.gross_cents||
    cents(p?.transaction_amount_refunded)!==0||!Array.isArray(p?.refunds)||p.refunds.length||
    Array.isArray(p?.chargebacks)&&p.chargebacks.length||net===null||net<=0||net>receipt.gross_cents||
    (hasOrder? !Array.isArray(refs)||refs.filter(r=>String(r?.id??'')===receipt.provider_order_id).length!==1:
      id!==receipt.provider_payment_id)||
    hasOrder&&pix?.payment_method?.e2e_id&&p?.point_of_interaction?.transaction_data?.e2e_id&&
      pix.payment_method.e2e_id!==p.point_of_interaction.transaction_data.e2e_id)
   return empty('PLATFORM_RELEASE_PAYMENT_BINDING_UNVERIFIED');
  verified.set(id,net);approvedAt.set(id,Date.parse(p.date_approved));
 }
 // At most one payment may settle a local receipt. Native PAY... aliases do
 // not bypass the independently fetched numeric payment and its released NET.
 if(verified.size!==1)return empty('PLATFORM_RELEASE_PAYMENT_AMBIGUOUS');
 const accepted=[];
 for(const report of reports){
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{7,140}\.csv$/.test(report?.fileName??''))
   return empty('PLATFORM_RELEASE_FILE_INVALID');
  const {rows}=parseReleasedMoneyCsv(report.csv);
  const correlated=rows.filter(r=>verified.has(r.SOURCE_ID)||r.EXTERNAL_REFERENCE===receipt.external_reference);
  const movements=correlated.filter(r=>!(['available_balance','balance','summary','opening_balance','closing_balance','total']
   .includes(r.RECORD_TYPE.toLowerCase())&&[r.GROSS_AMOUNT,r.NET_CREDIT_AMOUNT,r.NET_DEBIT_AMOUNT].every(v=>releasedMoneyCents(v)===0)));
  if(!movements.length)continue;
  if(movements.length!==1)return empty('PLATFORM_RELEASE_CONFLICTING_MOVEMENT');
  const r=movements[0],net=releasedMoneyCents(r.NET_CREDIT_AMOUNT);
  if(r.RECORD_TYPE.toLowerCase()!=='release'||r.DESCRIPTION.toLowerCase()!=='payment'||
   !verified.has(r.SOURCE_ID)||r.EXTERNAL_REFERENCE!==receipt.external_reference||
   r.CURRENCY&&r.CURRENCY!=='BRL'||releasedMoneyCents(r.GROSS_AMOUNT)!==receipt.gross_cents||
   releasedMoneyCents(r.NET_DEBIT_AMOUNT)!==0||net!==verified.get(r.SOURCE_ID)||
   !validDate(r.DATE)||Date.parse(r.DATE)>nowMs+300000||Date.parse(r.DATE)<approvedAt.get(r.SOURCE_ID)-300000)
   return empty('PLATFORM_RELEASE_VALUES_UNVERIFIED');
  const reference='mp-release:'+report.fileName+':'+r.SOURCE_ID;
  if(reference.length>240)return empty('PLATFORM_RELEASE_REFERENCE_TOO_LONG');
  accepted.push({netCents:net,providerPaymentId:r.SOURCE_ID,releaseDate:new Date(r.DATE).toISOString(),
   evidenceReference:reference,reportCsv:report.csv});
 }
 if(!accepted.length)return empty('PLATFORM_RELEASE_NOT_FOUND');
 if(accepted.some(x=>x.netCents!==accepted[0].netCents||x.providerPaymentId!==accepted[0].providerPaymentId||x.releaseDate!==accepted[0].releaseDate))
  return empty('PLATFORM_RELEASE_REPORTS_CONFLICT');
 return {...empty('PLATFORM_RELEASE_MATCHED'),...accepted[0],eligible:true};
}

// Provider requests supplied by the authenticated machine worker are GET-only.
// Report IDs nominate candidates, they never authorize the evidence by themselves.
export async function readPlatformNetEvidence(receipt,{providerGet,getReports,getCsv,sellerId,sha256}){
 if(receipt.reversed)return {status:'reversed',reason:'LOCAL_REVERSAL_RECORDED',evidence:null};
 const reports=[];
 if(receipt.recorded_evidence_reference){
  // A recorded immutable report is re-read by its original name and hash,
  // together with FRESH PSP facts. Growing daily account history must not
  // make a previously proved receipt impossible to recheck after ten days.
  const match=String(receipt.recorded_evidence_reference).match(/^mp-release:([A-Za-z0-9][A-Za-z0-9._-]{7,140}\.csv):([1-9][0-9]{2,19})$/);
  if(!match||!/^[0-9a-f]{64}$/.test(receipt.recorded_report_sha256??''))
   return {status:'requires_review',reason:'PLATFORM_RELEASE_STORED_PROOF_INVALID',evidence:null};
  const csv=await getCsv(match[1]);
  if(await sha256(csv)!==receipt.recorded_report_sha256)
   return {status:'requires_review',reason:'PLATFORM_RELEASE_STORED_REPORT_CHANGED',evidence:null};
  reports.push({fileName:match[1],csv});
 }else{
  const discovery=await getReports({status:'paid',paid_at:receipt.paid_at});
  if(!discovery.complete)return {status:'coverage_incomplete',reason:discovery.reason,evidence:null};
  if(!Array.isArray(discovery.files)||discovery.files.length>10)throw Error('PLATFORM_NET_REPORT_LIMIT');
  if(!discovery.files.length)return {status:'awaiting_report',reason:'MP_RELEASE_NOT_FOUND',evidence:null};
  for(const fileName of discovery.files)reports.push({fileName,csv:await getCsv(fileName)});
 }
 const ids=[...new Set(reports.flatMap(r=>parseReleasedMoneyCsv(r.csv).rows
  .filter(row=>row.EXTERNAL_REFERENCE===receipt.external_reference&&numericId(row.SOURCE_ID)).map(row=>row.SOURCE_ID)))];
 if(receipt.kind==='advertising'&&numericId(receipt.provider_payment_id)&&!ids.includes(receipt.provider_payment_id))
  ids.push(receipt.provider_payment_id);
 if(!ids.length)return {status:'awaiting_report',reason:'MP_RELEASE_NOT_FOUND',evidence:null};
 if(ids.length>3)return {status:'requires_review',reason:'MP_RELEASE_PAYMENT_IDS_AMBIGUOUS',evidence:null};
 const order=receipt.kind==='advertising'?null:await providerGet('/v1/orders/'+encodeURIComponent(receipt.provider_order_id));
 const payments=[];
 for(const id of ids){
  const p=await providerGet('/v1/payments/'+encodeURIComponent(id));
  if(String(p?.id??'')!==id)throw Error('MP_RELEASE_PAYMENT_ID_MISMATCH');
  payments.push(p);
 }
 const evidence=platformReleasedNetEvidence({receipt,sellerId,order,payments,reports});
 return {status:evidence.eligible?'net_verified':evidence.reason==='PLATFORM_RELEASE_NOT_FOUND'?'awaiting_report':'requires_review',
  reason:evidence.reason,evidence:evidence.eligible?evidence:null};
}
