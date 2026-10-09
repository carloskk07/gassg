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

const problems=[];
let accessTokenConfigured=false;
let webhookSecretConfigured=false;

// merchant-billing-pix validates the active PSP presence before user auth.
// UNAUTHORIZED therefore proves the Mercado Pago Access Token presence gate
// was passed without exposing the token or making a real charge.
const pix=await jsonPost('/functions/v1/merchant-billing-pix',{
  origin:MERCHANT_ORIGIN,
  body:{}
});
if(pix.status===503&&pix.body?.error==='PIX_PROVIDER_NOT_CONFIGURED'){
  problems.push('MERCADOPAGO_ACCESS_TOKEN ausente/inválido');
}else{
  assert.equal(
    pix.status,
    401,
    'probe Pix precisa alcançar autenticação depois do gate Mercado Pago'
  );
  assert.equal(
    pix.body?.error,
    'UNAUTHORIZED',
    'probe Pix não confirmou o gate interno do provedor Mercado Pago'
  );
  accessTokenConfigured=true;
}

// The unified public webhook needs only its HMAC secret before signature
// verification. A syntactically valid fake order ID with no signature is a
// safe secret-presence probe and cannot reach provider lookup or the database.
const webhook=await jsonPost('/functions/v1/billing-payment-webhook-mercadopago',{
  body:{type:'order',data:{id:'readiness-probe-order'}}
});
if(webhook.status===503&&webhook.body?.error==='MERCADOPAGO_WEBHOOK_NOT_CONFIGURED'){
  problems.push('MERCADOPAGO_WEBHOOK_SECRET ausente/inválido');
}else{
  assert.equal(
    webhook.status,
    401,
    'webhook Mercado Pago precisa alcançar validação HMAC após gate do segredo'
  );
  assert.equal(
    webhook.body?.error,
    'INVALID_MERCADOPAGO_SIGNATURE',
    'webhook Mercado Pago não confirmou o gate interno de assinatura'
  );
  webhookSecretConfigured=true;
}

const report={
  ok:problems.length===0,
  provider:'mercadopago',
  accessTokenConfigured,
  webhookSecretConfigured,
  secretsExposed:false,
  problems
};
console.log(JSON.stringify(report,null,2));

assert.equal(
  problems.length,
  0,
  'Mercado Pago PSP runtime incompleto: '+problems.join('; ')
);
