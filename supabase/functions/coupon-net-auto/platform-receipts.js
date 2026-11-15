import {readPlatformNetEvidence} from '../_shared/platform-net-evidence.js';
// No arbitrary invoice/amount input: candidates are selected by the database.
// Only GET requests to the PSP; the sole writer records read evidence.
export async function reconcilePlatformReceipts({client,providerGet,getReports,getCsv,sha256,inspect=false}){
 const {data:receipts,error}=await client.rpc('platform_receipt_net_pending',{p_limit:2,p_inspect:inspect});
 if(error||!Array.isArray(receipts)||receipts.length>2)throw Error('PLATFORM_NET_PENDING_UNAVAILABLE');
 const summary={source:'platform_receipt_net_evidence',readOnly:inspect,checked:receipts.length,
  registered:0,review:0,waiting:0,newChargesCreated:0,moneyMoved:false,entitlementsChanged:false,results:[]};
 if(!receipts.length)return summary;
 let seller=null;
 try{
  const candidate=await providerGet('/users/me');
  if(/^[1-9][0-9]{2,19}$/.test(String(candidate?.id??'')))seller=candidate;
 }catch{/* Persist a retryable observation for each server-selected receipt. */}
 const csvCache=new Map();
 const cachedCsv=async name=>{
  if(!csvCache.has(name))csvCache.set(name,await getCsv(name));
  return csvCache.get(name);
 };
 for(const receipt of receipts){
  let result;
  try{
   if(!seller)throw Error('PLATFORM_NET_SELLER_UNAVAILABLE');
   result=await readPlatformNetEvidence(receipt,{providerGet,getReports,getCsv:cachedCsv,sellerId:String(seller.id),sha256});
  }
  catch{result={status:'provider_unavailable',reason:'RETRYABLE_PROVIDER_OR_REPORT_FAILURE',evidence:null};}
  if(!inspect){
   const e=result.evidence;
   const {data,error:writeError}=await client.rpc('platform_receipt_net_record',{
    p_kind:receipt.kind,p_resource_id:receipt.resource_id,p_status:result.status,p_reason:result.reason,
    p_evidence:e?{externalReference:receipt.external_reference,grossCents:receipt.gross_cents,
     netCents:e.netCents,sellerId:String(seller.id),providerOrderId:receipt.provider_order_id,
     providerPaymentId:e.providerPaymentId,releaseAt:e.releaseDate,
     reportSha256:await sha256(e.reportCsv),evidenceReference:e.evidenceReference}:null
   });
   if(writeError||data?.ok!==true||data.source!=='platform_receipt_net_evidence'||
    data.moneyMoved!==false||data.entitlementsChanged!==false)throw Error('PLATFORM_NET_REGISTER_UNAVAILABLE');
   result.status=data.status;
  }
  if(result.status==='net_verified')summary.registered++;
  else if(result.status==='requires_review')summary.review++;
  else summary.waiting++;
  // No PSP IDs, payer/receiver identity or CSV contents leave diagnostics.
  summary.results.push({kind:receipt.kind,status:result.status,reason:result.reason,
   grossCents:receipt.gross_cents,netCents:result.evidence?.netCents??null});
 }
 return summary;
}
