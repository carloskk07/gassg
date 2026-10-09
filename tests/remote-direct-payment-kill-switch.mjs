import assert from 'node:assert/strict';
import fs from 'node:fs';

const CUSTOMER_ORIGIN='https://tamao.com.br';
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

const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),12000);
try{
  const response=await fetch(
    backendUrl+'/functions/v1/order-payment-checkout',
    {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':publishableKey,
        'Origin':CUSTOMER_ORIGIN,
        'Idempotency-Key':'kill-switch-readiness-probe'
      },
      body:'{}',
      signal:controller.signal
    }
  );
  const text=await response.text();
  let body={};
  try{body=text?JSON.parse(text):{}}
  catch{
    throw new Error(
      'order-payment-checkout retornou corpo não JSON HTTP '
      +response.status+': '+text.slice(0,240)
    );
  }

  const report={
    ok:
      response.status===503
      &&body?.error==='MERCHANT_DIRECT_PAYMENTS_NOT_LAUNCHED',
    globalDirectPaymentsEnabled:
      response.status===401&&body?.error==='UNAUTHORIZED',
    failClosed:
      response.status===503
      &&body?.error==='MERCHANT_DIRECT_PAYMENTS_NOT_LAUNCHED',
    financialMutationAttempted:false,
    status:response.status,
    error:body?.error??null
  };
  console.log(JSON.stringify(report,null,2));

  assert.equal(
    report.globalDirectPaymentsEnabled,
    false,
    'Pagamento direto da revenda foi habilitado antes da homologação de lançamento'
  );
  assert.equal(
    report.failClosed,
    true,
    'Kill switch de pagamento direto precisa falhar fechado antes de autenticação/checkout'
  );
}finally{
  clearTimeout(timer);
}
