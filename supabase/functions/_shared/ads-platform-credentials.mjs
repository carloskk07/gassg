// Server-only platform account selection. Never use merchant OAuth credentials.
// A partial dedicated Ads connection must not silently switch its recipient.
export function independentAdsCredentialConfig(getEnv){
 const read=name=>String(getEnv(name)??'').trim();
 const dedicated=['ADS_MP_ACCESS_TOKEN','ADS_MP_SELLER_ID','ADS_MP_WEBHOOK_SECRET'].map(read);
 const mode=dedicated.some(Boolean)?'dedicated':'platform';
 const token=mode==='dedicated'?dedicated[0]:read('MERCADOPAGO_ACCESS_TOKEN');
 const sellerId=mode==='dedicated'?dedicated[1]:'';
 const signatureSecret=mode==='dedicated'?dedicated[2]:read('MERCADOPAGO_WEBHOOK_SECRET');
 const enabled=name=>mode==='dedicated'?read(name)==='true':
  (read(name)===''||read(name)==='true');
 return {mode,token,sellerId,signatureSecret,
  tokenConfigured:/^APP_USR-\S{20,}$/.test(token),
  sellerConfigured:mode==='platform'||/^\d{4,20}$/.test(sellerId),
  signedWebhookConfigured:signatureSecret.length>=16,
  checkoutConfigured:enabled('ADS_MP_CHECKOUT_ENABLED'),
  webhookConfigured:enabled('ADS_MP_WEBHOOK_ENABLED')};
}

export async function verifyIndependentAdsSeller(config,{fetchImpl=fetch}={}){
 if(!config.tokenConfigured||!config.sellerConfigured)throw Error('ADS_CREDENTIAL_UNAVAILABLE');
 const response=await fetchImpl('https://api.mercadolibre.com/users/me',{
  headers:{Authorization:'Bearer '+config.token,Accept:'application/json'},
  signal:AbortSignal.timeout(7000)
 });
 if(!response.ok)throw Error('ADS_SELLER_LOOKUP_FAILED');
 const raw=await response.text();
 if(raw.length>20000)throw Error('ADS_SELLER_RESPONSE_TOO_LARGE');
 const who=JSON.parse(raw),sellerId=String(who?.id??'');
 if(!/^\d{4,20}$/.test(sellerId)||
  config.mode==='dedicated'&&sellerId!==config.sellerId||
  Array.isArray(who?.tags)&&who.tags.includes('test_user'))throw Error('ADS_SELLER_MISMATCH');
 return {token:config.token,sellerId,credentialMode:config.mode};
}

export async function independentAdsProviderReadiness(getEnv,options={}){
 const config=independentAdsCredentialConfig(getEnv);
 let sellerVerified=false;
 try{await verifyIndependentAdsSeller(config,options);sellerVerified=true}catch{/* no authorization on failure */}
 return {credentialMode:config.mode,tokenConfigured:config.tokenConfigured,
  sellerConfigured:config.sellerConfigured,sellerVerified,
  checkoutConfigured:config.checkoutConfigured,webhookConfigured:config.webhookConfigured,
  signedWebhookConfigured:config.signedWebhookConfigured,
  readyForFinancialHomologation:config.tokenConfigured&&sellerVerified&&
   config.checkoutConfigured&&config.webhookConfigured&&config.signedWebhookConfigured};
}
