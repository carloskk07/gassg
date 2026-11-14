import {validatePixBrCode} from './pix-brcode.js';
import {moneyToCents} from './mercadopago.js';
import {selectIndependentAdsPayment} from './ads-independent-payment-search.mjs';

const fail=code=>{throw Error(code)};
export function adsPixProof(p,row,sellerId,now=Date.now()){
 const id=String(p?.id??''),collector=String(p?.collector_id??p?.collector?.id??'');
 const code=p?.point_of_interaction?.transaction_data?.qr_code;
 const expires=Date.parse(String(p?.date_of_expiration||''));
 if(!/^\d{5,30}$/.test(id)||p?.live_mode!==true||p?.external_reference!==row.external_reference||
   moneyToCents(p?.transaction_amount)!==row.amount_cents||p?.currency_id!=='BRL'||collector!==sellerId||
   p?.payment_method_id!=='pix'||p?.status!=='pending'||
   !Number.isFinite(expires)||expires<=now+60000||expires>now+3*86400000||
   !validatePixBrCode(code,{expectedAmountCents:row.amount_cents}).valid)
  fail('ADS_PIX_PROVIDER_PROOF_INVALID');
 return {id,collector,code,expiresAt:new Date(expires).toISOString()};
}
export function adsPreferenceIdentity(p,row,sellerId){
 const items=p?.items;
 return String(p?.id??'')===row.preference_id&&String(p?.collector_id??'')===sellerId&&
  p?.external_reference===row.external_reference&&Array.isArray(items)&&items.length===1&&
  items[0]?.id==='tamao-ads-independent-'+row.campaign_id&&items[0]?.currency_id==='BRL'&&
  Number(items[0]?.quantity)===1&&moneyToCents(items[0]?.unit_price)===row.amount_cents;
}
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

async function rpc(admin,name,args){
 const r=await admin.rpc(name,args);if(r.error)throw r.error;
 if(r.data?.source!==name)fail('ADS_PIX_DATABASE_READBACK_INVALID');
 return r.data;
}
async function lookup(deps,row,token){
 const listing=await deps.provider('/v1/payments/search?external_reference='+encodeURIComponent(row.external_reference)+'&limit=10',token);
 const choice=selectIndependentAdsPayment(listing,row.external_reference);
 if(choice.kind==='review')fail('ADS_MULTIPLE_PAYMENTS_REVIEW_REQUIRED');
 if(choice.kind!=='single')return null;
 const payment=await deps.provider('/v1/payments/'+choice.paymentId,token);
 if(String(payment?.id??'')!==choice.paymentId)fail('ADS_PIX_PROVIDER_PROOF_INVALID');
 return payment;
}
async function usePayment(deps,row,p,token,sellerId){
 // Even a settled payment must have the exact original obligation and seller.
 if(p?.live_mode!==true||p?.external_reference!==row.external_reference||
  moneyToCents(p?.transaction_amount)!==row.amount_cents||p?.currency_id!=='BRL'||
  String(p?.collector_id??p?.collector?.id??'')!==sellerId)fail('ADS_PIX_PROVIDER_PROOF_INVALID');
 if(['approved','refunded','charged_back'].includes(p.status))return deps.reconcile(row,token,sellerId);
 if(p.status!=='pending'||p.payment_method_id!=='pix')fail('ADS_PIX_PAYMENT_IN_PROCESS');
 const proof=adsPixProof(p,row,sellerId);
 const attached=await rpc(deps.admin,'ads_pix_attach',{
  p_owner:row.owner_user_id,p_campaign:row.campaign_id,p_payment:proof.id,p_collector:proof.collector,
  p_amount:row.amount_cents,p_code:proof.code,p_expires:proof.expiresAt});
 if(attached.status!=='checkout_ready'||attached.pixPayable!==true)
  return deps.reconcile(row,token,sellerId);
 return {source:'ads_independent_checkout_v1_886',status:'checkout_ready',paymentMethod:'pix',
  pixPayable:true,pixCode:proof.code,expiresAt:proof.expiresAt,amountCents:row.amount_cents,
  checkoutUrl:null,viewChargesCents:0,reused:true};
}

// Recovery is read-only at the provider: never issue another payment POST.
export async function recoverAdsPix(deps,row,token,sellerId){
 const p=await lookup(deps,row,token);
 if(!p)fail('ADS_PIX_PREPARING');
 return usePayment(deps,row,p,token,sellerId);
}

export async function prepareAdsPix(deps,{ownerId,campaignId,token,sellerId,payerEmail,origin='owner'}){
 if(typeof payerEmail!=='string'||!/^\S+@\S+\.\S+$/.test(payerEmail))fail('ADS_PIX_VERIFIED_EMAIL_REQUIRED');
 const begun=await rpc(deps.admin,'ads_pix_begin',{p_owner:ownerId,p_campaign:campaignId,p_origin:origin});
 let row=begun.checkout;
 if(row.owner_user_id!==ownerId||row.campaign_id!==campaignId)fail('ADS_PIX_OWNER_MISMATCH');
 if(['creating','ready'].includes(row.pix_stage))return recoverAdsPix(deps,row,token,sellerId);
 let existing=await lookup(deps,row,token);
 if(existing)return usePayment(deps,row,existing,token,sellerId);
 let closure=null;
 if(row.preference_id){
  const path='/checkout/preferences/'+encodeURIComponent(row.preference_id);
  let pref=await deps.provider(path,token);
  if(!adsPreferenceIdentity(pref,row,sellerId))fail('ADS_PIX_LEGACY_IDENTITY_MISMATCH');
  const closed=p=>p.expires===true&&Number.isFinite(Date.parse(p.expiration_date_to))&&
   Date.parse(p.expiration_date_to)<=Date.now()-500;
  if(!closed(pref)){
   await deps.provider(path,token,{method:'PUT',body:{expires:true,
    expiration_date_to:new Date(Date.parse(row.pix_started_at)-1000).toISOString()}});
   pref=await deps.provider(path,token);
  }
  if(!adsPreferenceIdentity(pref,row,sellerId)||!closed(pref))fail('ADS_PIX_LEGACY_STILL_PAYABLE');
  closure=await hash(JSON.stringify([pref.id,pref.collector_id,pref.external_reference,pref.expires,pref.expiration_date_to]));
  // A pending Pix chosen in a concurrently opened legacy checkout is reused.
  existing=await lookup(deps,row,token);
  if(existing)return usePayment(deps,row,existing,token,sellerId);
 }
 const claim=await rpc(deps.admin,'ads_pix_claim',{p_owner:ownerId,p_campaign:campaignId,
  p_preference:row.preference_id||null,p_closure_sha:closure});
 row=claim.checkout;
 if(claim.canCreate!==true)return recoverAdsPix(deps,row,token,sellerId);
 const expiresAt=new Date(Date.parse(row.pix_started_at)+86400000).toISOString();
 const created=await deps.provider('/v1/payments',token,{method:'POST',
  idempotencyKey:'tamao-ads-pix-'+row.request_id,body:{transaction_amount:row.amount_cents/100,
   description:'Publicidade TAMÃO — '+row.duration_days+' dias',payment_method_id:'pix',
   external_reference:row.external_reference,payer:{email:payerEmail},date_of_expiration:expiresAt,
   notification_url:deps.webhookUrl}});
 if(!/^\d{5,30}$/.test(String(created?.id??'')))fail('ADS_PIX_CREATE_UNCONFIRMED');
 // Only authoritative GET data may be presented or attached to the obligation.
 const verified=await deps.provider('/v1/payments/'+created.id,token);
 if(String(verified?.id??'')!==String(created.id))fail('ADS_PIX_PROVIDER_PROOF_INVALID');
 const result=await usePayment(deps,row,verified,token,sellerId);
 return {...result,reused:false};
}
