// TAMÃO V1.886 — deferred secure purchase; loaded only after explicit customer consent.
const tamaoAdsCheckoutRequests=new Map();
function tamaoAdsVerifiedCheckoutUrl(raw){
 try{
  const u=new URL(String(raw||''));
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||
     !(['mercadopago.com','mercadopago.com.br'].includes(host)||
       host.endsWith('.mercadopago.com')||host.endsWith('.mercadopago.com.br')))
    return null;
  return u.href;
 }catch{return null}
}
async function tamaoAdsPurchaseCampaign(campaignId){
 if(!/^[0-9a-f-]{36}$/i.test(String(campaignId||'')))throw Error('Campanha inválida.');
 if(!tamaoAdsCheckoutRequests.has(campaignId))
  tamaoAdsCheckoutRequests.set(campaignId,crypto.randomUUID());
 const result=await liveInvoke('ads-independent-checkout',{
  action:'purchase',campaignId,requestId:tamaoAdsCheckoutRequests.get(campaignId),
  acceptFixedFee:true
 });
 if(result?.source!=='ads_independent_checkout_v1_886'||
    result?.status!=='checkout_ready'||result?.viewChargesCents!==0)
  throw Error('O pagamento não foi confirmado pelo TAMÃO.');
 const url=tamaoAdsVerifiedCheckoutUrl(result.checkoutUrl);
 if(!url)throw Error('Link de pagamento inválido.');
 // Customer leaves the TAMÃO portal only after their own click, never on mount.
 location.assign(url);
}
globalThis.tamaoAdsPurchaseCampaign=tamaoAdsPurchaseCampaign;
