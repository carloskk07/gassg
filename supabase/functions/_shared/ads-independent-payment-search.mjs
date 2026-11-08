// TAMÃO Ads V1.891: only a uniquely paginated provider payment is reconcilable.
export function selectIndependentAdsPayment(listing,reference){
 const paging=listing?.paging;
 const results=listing?.results;
 if(!/^tamao-ads-ind-[0-9a-f]{32}$/.test(String(reference||""))||
    !Array.isArray(results)||!Number.isSafeInteger(paging?.total)||
    paging.total<0||!Number.isSafeInteger(paging?.offset)||paging.offset!==0)
  return {kind:"review"};
 if(paging.total===0)return results.length===0?{kind:"none"}:{kind:"review"};
 // A single match on page one is NOT unique if paging.total is greater.
 if(paging.total!==1||results.length!==1)return {kind:"review"};
 const paymentId=String(results[0]?.id??"");
 if(results[0]?.external_reference!==reference||!/^[0-9]{5,30}$/.test(paymentId))
  return {kind:"review"};
 return {kind:"single",paymentId};
}
