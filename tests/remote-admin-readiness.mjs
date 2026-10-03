import assert from 'node:assert/strict';
import fs from 'node:fs';

const ADMIN_ORIGIN='https://chama-sg-admin.netlify.app';
const CUSTOMER_ORIGIN='https://chama-sg-cliente.netlify.app';
const MERCHANT_ORIGIN='https://chama-sg-revenda.netlify.app';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const backendUrl=/url:'([^']+)'/.exec(backend)?.[1]||'';
const publishableKey=/publishableKey:'([^']+)'/.exec(backend)?.[1]||'';

assert.match(backendUrl,/^https:\/\/[a-z0-9-]+\.supabase\.co$/,'URL pública do Supabase precisa estar disponível');
assert.match(publishableKey,/^sb_publishable_[A-Za-z0-9_-]+$/,'publishable key pública precisa estar disponível');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function resilientFetch(url,init={},label='request'){
  let lastError=null;
  for(let attempt=1;attempt<=4;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url,{
        ...init,
        headers:{'Cache-Control':'no-cache',...(init.headers||{})},
        signal:controller.signal
      });
      if(response.status>=500&&attempt<4){
        lastError=new Error(label+' HTTP '+response.status);
        await sleep(400*attempt);
        continue;
      }
      return response;
    }catch(error){
      lastError=error;
      if(attempt===4)throw error;
      await sleep(400*attempt);
    }finally{
      clearTimeout(timer);
    }
  }
  throw lastError||new Error(label+' failed');
}

async function jsonBody(response,label){
  const text=await response.text();
  try{return JSON.parse(text)}
  catch{throw new Error(label+' returned non-JSON HTTP '+response.status+': '+text.slice(0,240))}
}

// The first login request MUST reach the handler without a user JWT.
// A deliberately short captcha token must be rejected by our handler, not by the Edge gateway.
const loginProbe=await resilientFetch(backendUrl+'/functions/v1/admin-auth',{
  method:'POST',
  headers:{
    'Content-Type':'application/json',
    'apikey':publishableKey,
    'Origin':ADMIN_ORIGIN
  },
  body:JSON.stringify({
    action:'request-link',
    email:'admin-readiness-probe@example.invalid',
    captchaToken:'probe'
  })
},'admin-auth request-link');
const loginBody=await jsonBody(loginProbe,'admin-auth request-link');
assert.equal(loginProbe.status,400,'request-link sem JWT precisa alcançar o handler e falhar no CAPTCHA');
assert.equal(loginBody.error,'CAPTCHA_REQUIRED','gateway não pode bloquear o primeiro request por ausência de JWT');
assert.equal(loginProbe.headers.get('access-control-allow-origin'),ADMIN_ORIGIN,'CORS do admin-auth precisa permanecer preso à origem admin');

// Conversely, privileged claim MUST remain closed without a bearer user session.
const claimProbe=await resilientFetch(backendUrl+'/functions/v1/admin-auth',{
  method:'POST',
  headers:{
    'Content-Type':'application/json',
    'apikey':publishableKey,
    'Origin':ADMIN_ORIGIN
  },
  body:JSON.stringify({action:'claim'})
},'admin-auth claim');
const claimBody=await jsonBody(claimProbe,'admin-auth claim');
assert.equal(claimProbe.status,401,'claim sem bearer token deve permanecer fechado');
assert.equal(claimBody.error,'UNAUTHORIZED','claim precisa autenticar dentro do handler');

// The isolated admin portal must expose a coherent build manifest and runtime.
const buildResponse=await resilientFetch(ADMIN_ORIGIN+'/portal-build.json?probe='+Date.now(),{},'admin portal build metadata');
assert.equal(buildResponse.status,200,'portal-build.json do admin precisa estar online');
const build=await jsonBody(buildResponse,'admin portal build metadata');
assert.equal(build.schemaVersion,1);
assert.equal(build.portalRole,'admin');
assert.equal(build.customerOrigin,CUSTOMER_ORIGIN);
assert.equal(build.merchantOrigin,MERCHANT_ORIGIN);
assert.equal(build.adminOrigin,ADMIN_ORIGIN);
assert.match(String(build.sourceSha||''),/^[0-9a-f]{40}$/,'bundle admin precisa registrar o SHA fonte');

const runtimeResponse=await resilientFetch(ADMIN_ORIGIN+'/js/runtime-config.js?probe='+Date.now(),{},'admin runtime config');
assert.equal(runtimeResponse.status,200,'runtime-config do admin precisa estar online');
const runtime=await runtimeResponse.text();
assert.ok(runtime.includes('globalThis.CHAMA_PORTAL_ROLE="admin";'),'bundle remoto precisa assumir role admin');
for(const origin of [CUSTOMER_ORIGIN,MERCHANT_ORIGIN,ADMIN_ORIGIN]){
  assert.ok(runtime.includes(origin),'runtime remoto precisa conhecer '+origin);
}

const htmlResponse=await resilientFetch(ADMIN_ORIGIN+'/?admin=1&probe='+Date.now()+'#admin',{},'admin portal html');
assert.equal(htmlResponse.status,200,'HTML do portal admin precisa estar online');
const html=await htmlResponse.text();
assert.ok(html.includes('data-chama-portal="admin"'),'HTML remoto precisa ser bundle isolado de admin');
assert.ok(html.includes('TAMÃO Admin — Controle'),'HTML remoto precisa carregar título administrativo');

console.log(JSON.stringify({
  ok:true,
  adminAuthPublicEntry:'CAPTCHA_REQUIRED',
  adminClaimWithoutSession:'UNAUTHORIZED',
  portalRole:build.portalRole,
  portalSourceSha:build.sourceSha,
  adminOrigin:build.adminOrigin
},null,2));
