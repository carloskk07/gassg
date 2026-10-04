import assert from 'node:assert/strict';
import fs from 'node:fs';

const ADMIN_ORIGIN='https://tamao-sg-admin.pages.dev';
const CUSTOMER_ORIGIN='https://tamao-sg-cliente.pages.dev';
const MERCHANT_ORIGIN='https://tamao-sg-revenda.pages.dev';
const REQUIRE_ADMIN_PORTAL=process.env.TAMAO_REQUIRE_ADMIN_PORTAL==='1';

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

// Hard contract: first login must reach our handler without a user JWT.
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

// Hard contract: privileged claim remains closed without a bearer user session.
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

const portal={
  ready:true,
  reasons:[],
  sourceSha:null,
  buildStatus:null,
  runtimeStatus:null,
  htmlStatus:null,
  role:null
};

async function portalCheck(condition,reason){
  if(condition)return;
  portal.ready=false;
  portal.reasons.push(reason);
}

try{
  const buildResponse=await resilientFetch(ADMIN_ORIGIN+'/portal-build.json?probe='+Date.now(),{},'admin portal build metadata');
  portal.buildStatus=buildResponse.status;
  if(buildResponse.status===200){
    const build=await jsonBody(buildResponse,'admin portal build metadata');
    portal.role=build.portalRole??null;
    portal.sourceSha=String(build.sourceSha??'')||null;
    await portalCheck(build.schemaVersion===1,'portal-build schema inválido');
    await portalCheck(build.portalRole==='admin','portal-build não declara role admin');
    await portalCheck(build.customerOrigin===CUSTOMER_ORIGIN,'portal-build customerOrigin divergente');
    await portalCheck(build.merchantOrigin===MERCHANT_ORIGIN,'portal-build merchantOrigin divergente');
    await portalCheck(build.adminOrigin===ADMIN_ORIGIN,'portal-build adminOrigin divergente');
    await portalCheck(/^[0-9a-f]{40}$/.test(String(build.sourceSha||'')),'portal-build sem SHA fonte válido');
  }else{
    await portalCheck(false,'portal-build.json HTTP '+buildResponse.status);
  }

  const runtimeResponse=await resilientFetch(ADMIN_ORIGIN+'/js/runtime-config.js?probe='+Date.now(),{},'admin runtime config');
  portal.runtimeStatus=runtimeResponse.status;
  if(runtimeResponse.status===200){
    const runtime=await runtimeResponse.text();
    await portalCheck(runtime.includes('globalThis.CHAMA_PORTAL_ROLE="admin";'),'runtime remoto não assume role admin');
    for(const origin of [CUSTOMER_ORIGIN,MERCHANT_ORIGIN,ADMIN_ORIGIN]){
      await portalCheck(runtime.includes(origin),'runtime remoto não conhece '+origin);
    }
  }else{
    await portalCheck(false,'runtime-config HTTP '+runtimeResponse.status);
  }

  const htmlResponse=await resilientFetch(ADMIN_ORIGIN+'/?admin=1&probe='+Date.now()+'#admin',{},'admin portal html');
  portal.htmlStatus=htmlResponse.status;
  if(htmlResponse.status===200){
    const html=await htmlResponse.text();
    await portalCheck(html.includes('data-chama-portal="admin"'),'HTML remoto não é bundle isolado de admin');
    await portalCheck(html.includes('TAMÃO Admin — Controle'),'HTML remoto não carrega título administrativo');
  }else{
    await portalCheck(false,'HTML admin HTTP '+htmlResponse.status);
  }
}catch(error){
  portal.ready=false;
  portal.reasons.push(String(error?.message||error));
}

if(!portal.ready){
  const message='Portal admin remoto ainda não está pronto: '+portal.reasons.join('; ');
  if(REQUIRE_ADMIN_PORTAL)assert.fail(message);
  console.warn('::warning title=TAMÃO admin portal pendente::'+message);
}

console.log(JSON.stringify({
  ok:true,
  adminAuthPublicEntry:'CAPTCHA_REQUIRED',
  adminClaimWithoutSession:'UNAUTHORIZED',
  adminPortal:portal,
  strictPortalGate:REQUIRE_ADMIN_PORTAL
},null,2));
