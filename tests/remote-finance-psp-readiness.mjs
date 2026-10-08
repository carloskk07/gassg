import assert from 'node:assert/strict';
import fs from 'node:fs';

const MERCHANT_ORIGIN='https://parceiro.tamao.com.br';
const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const backendUrl=/url:'([^']+)'/.exec(backend)?.[1]||'';
const publishableKey=/publishableKey:'([^']+)'/.exec(backend)?.[1]||'';

assert.match(
  backendUrl,
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/,
  'URL pública do Supabase precisa estar disponível'
);
assert.match(
  publishableKey,
  /^sb_publishable_[A-Za-z0-9_-]+$/,
  'publishable key pública precisa estar disponível'
);

async function jsonPost(path,{origin=null,headers={},body={}}={}){
  let lastError=null;
  for(let attempt=1;attempt<=4;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(backendUrl+path,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'apikey':publishableKey,
          ...(origin?{'Origin':origin}:{}),
          ...headers
        },
        body:JSON.stringify(body),
        signal:controller.signal
      });
      const text=await response.text();
      let json={};
      try{json=text?JSON.parse(text):{}}
      catch{
        throw new Error(
          path+' retornou corpo não JSON HTTP '+response.status+': '+text.slice(0,240)
        );
      }

      // 503 is meaningful for both PSP configuration probes and must not be
      // retried away. Retry only transient gateway/server failures.
      if([500,502,504].includes(response.status)&&attempt<4){
        lastError=new Error(path+' HTTP '+response.status);
        await new Promise(r=>setTimeout(r,400*attempt));
        continue;
      }
      return {status:response.status,body:json};
    }catch(error){
      lastError=error;
      if(attempt===4)throw error;
      await new Promise(r=>setTimeout(r,400*attempt));
    }finally{
      clearTimeout(timer);
    }
  }
  throw lastError||new Error(path+' probe failed');
}

// merchant-billing-pix checks WOOVI_APP_ID before user authentication.
// Therefore UNAUTHORIZED proves the App ID configuration gate was passed,
// while PIX_PROVIDER_NOT_CONFIGURED proves the secret is absent/invalid length.
const pix=await jsonPost('/functions/v1/merchant-billing-pix',{
  origin:MERCHANT_ORIGIN,
  body:{}
});
if(pix.status===503&&pix.body?.error==='PIX_PROVIDER_NOT_CONFIGURED'){
  assert.fail('WOOVI_APP_ID não está configurado no runtime de produção');
}
assert.equal(
  pix.status,
  401,
  'probe Pix precisa alcançar a autenticação depois do gate WOOVI_APP_ID'
);
assert.equal(
  pix.body?.error,
  'UNAUTHORIZED',
  'probe Pix não confirmou o gate interno de configuração Woovi'
);

// The Woovi webhook checks WOOVI_WEBHOOK_AUTHORIZATION + WOOVI_COMPANY_ID
// before comparing the incoming private Authorization value. Sending no
// private authorization therefore proves only secret presence, never value.
const webhook=await jsonPost('/functions/v1/billing-payment-webhook-woovi',{
  body:{}
});
if(webhook.status===503&&webhook.body?.error==='WOOVI_ADAPTER_NOT_CONFIGURED'){
  assert.fail(
    'WOOVI_COMPANY_ID e/ou WOOVI_WEBHOOK_AUTHORIZATION não estão configurados no runtime de produção'
  );
}
assert.equal(
  webhook.status,
  401,
  'webhook Woovi precisa alcançar a comparação da autorização privada'
);
assert.equal(
  webhook.body?.error,
  'INVALID_WOOVI_AUTHORIZATION',
  'webhook Woovi não confirmou o gate interno de Company ID/autorização privada'
);

console.log(JSON.stringify({
  ok:true,
  provider:'woovi',
  appIdConfigured:true,
  companyIdConfigured:true,
  webhookAuthorizationConfigured:true,
  secretsExposed:false
},null,2));
