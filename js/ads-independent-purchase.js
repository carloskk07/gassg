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
 if(actor!==String(globalThis.liveRuntime?.session?.user?.id||'')||generation!==Number(globalThis.liveRuntime?.authGeneration||0))return false;
 if(result?.source==='ads_independent_reconcile_v1_886'&&result.status==='payment_approved'){
  await tamaoAdsMyRefresh({quiet:true});return true;
 }
 if(result?.source!=='ads_independent_checkout_v1_886'||result.status!=='checkout_ready'||
    result.viewChargesCents!==0||result.pixPayable!==true||typeof result.pixCode!=='string'||
    !Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()+60000)
  throw Error('O Pix original ainda não foi confirmado. Consulte a mesma campanha.');
 await tamaoAdsMyRefresh({quiet:true});
 if(actor!==String(globalThis.liveRuntime?.session?.user?.id||''))return false;
 toast('Pix disponível nesta tela. Escaneie o QR Code ou copie o código.');return true;
}
globalThis.tamaoAdsPurchaseCampaign=tamaoAdsPurchaseCampaign;

async function tamaoAdsReconcileCampaign(campaignId){
 if(!/^[0-9a-f-]{36}$/i.test(String(campaignId||'')))throw Error('Campanha inválida.');
 const r=await liveInvoke('ads-independent-checkout',{action:'reconcile',campaignId});
 if(r?.source!=='ads_independent_reconcile_v1_886')throw Error('Consulta do provedor não confirmada.');
 if(r.status==='payment_approved')toast('O provedor confirmou o pagamento. A campanha aguarda publicação.');
 else if(r.status==='payment_reversed')toast('Pagamento revertido. A campanha não pode continuar.');
 else toast('A confirmação do pagamento ainda não foi localizada no provedor.');
 return r;
}
globalThis.tamaoAdsReconcileCampaign=tamaoAdsReconcileCampaign;
