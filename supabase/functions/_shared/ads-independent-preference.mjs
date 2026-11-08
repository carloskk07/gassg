// TAMÃO Ads V1.890 — pure provider-return proof, reused for first checkout and recovery.
// A valid HTTPS destination alone is never a sufficient payment preference proof.
export function verifiedIndependentAdsPreference(p,{reference,campaignId,sellerId,amountCents,expiresAt,nowMs=Date.now()}={}){
 if(!p||typeof p!=="object"||typeof reference!=="string"||
   !/^tamao-ads-ind-[0-9a-f]{32}$/.test(reference)||
   !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(String(campaignId||""))||
   !/^[0-9]{4,20}$/.test(String(sellerId||""))||
   ![1990,4990,9990,19990].includes(amountCents))return null;
 const id=String(p.id||"").trim();
 if(!/^[a-zA-Z0-9-]{5,120}$/.test(id))return null;
 if(String(p.external_reference||"")!==reference||
   String(p.collector_id||"")!==sellerId||p.preference_expired===true)return null;
 const items=p.items;
 if(!Array.isArray(items)||items.length!==1)return null;
 const item=items[0];
 if(!item||item.id!=="tamao-ads-independent-"+campaignId||
   String(item.currency_id||"")!=="BRL"||Number(item.quantity)!==1)return null;
 const price=Number(item.unit_price);
 if(!Number.isFinite(price)||!Number.isSafeInteger(amountCents)||
   Math.abs(price*100-amountCents)>0.0001)return null;
 const planned=Date.parse(String(expiresAt||""));
 const actual=Date.parse(String(p.expiration_date_to||""));
 if(!Number.isFinite(nowMs)||!Number.isFinite(planned)||!Number.isFinite(actual)||
   actual<=nowMs+60000||Math.abs(actual-planned)>120000)return null;
 let url;
 try{
  url=new URL(String(p.init_point||""));
  const host=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||url.username||url.password||url.port||
    !["mercadopago.com","mercadopago.com.br"].includes(host)&&
    !host.endsWith(".mercadopago.com")&&!host.endsWith(".mercadopago.com.br"))
   return null;
 }catch{return null}
 return {id,checkoutUrl:url.href,expiresAt:new Date(actual).toISOString()};
}
