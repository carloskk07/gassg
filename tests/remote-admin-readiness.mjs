import assert from 'node:assert/strict';
import fs from 'node:fs';

const PORTALS={
  customer:{origin:'https://tamao.com.br',title:'TAMÃO — Pediu? Tá na mão.'},
  merchant:{origin:'https://parceiro.tamao.com.br',title:'TAMÃO Revenda — Operação'},
  admin:{origin:'https://admin.tamao.com.br',title:'TAMÃO Admin — Controle'}
};
const CUSTOMER_ORIGIN=PORTALS.customer.origin;
const MERCHANT_ORIGIN=PORTALS.merchant.origin;
const ADMIN_ORIGIN=PORTALS.admin.origin;
const REQUIRE_LIVE_PORTALS=
  process.env.TAMAO_REQUIRE_LIVE_PORTALS==='1'
  ||process.env.TAMAO_REQUIRE_ADMIN_PORTAL==='1';
const EXPECTED_SOURCE_SHA=String(process.env.TAMAO_EXPECTED_SOURCE_SHA||'').trim().toLowerCase();
if(EXPECTED_SOURCE_SHA){
  assert.match(EXPECTED_SOURCE_SHA,/^[0-9a-f]{40}$/,'TAMAO_EXPECTED_SOURCE_SHA precisa ser SHA git completo');
}
const TEST_TURNSTILE_KEYS=new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '3x00000000000000000000FF',
  '0x4AAAAAAAAAA-demo-site-key'
]);

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

async function verifyPortal(role,cfg){
  const portal={
    role,
    origin:cfg.origin,
    ready:true,
    reasons:[],
    sourceSha:null,
    buildStatus:null,
    runtimeStatus:null,
    htmlStatus:null,
    turnstileKey:null
  };
  const check=(condition,reason)=>{
    if(condition)return;
    portal.ready=false;
    portal.reasons.push(reason);
  };

  try{
    const nonce=Date.now()+'-'+role;
    const buildResponse=await resilientFetch(
      cfg.origin+'/portal-build.json?probe='+nonce,
      {},
      role+' portal build metadata'
    );
    portal.buildStatus=buildResponse.status;
    if(buildResponse.status===200){
      const build=await jsonBody(buildResponse,role+' portal build metadata');
      portal.sourceSha=String(build.sourceSha??'')||null;
      check(build.schemaVersion===1,'portal-build schema inválido');
      check(build.portalRole===role,'portal-build role divergente');
      check(build.customerOrigin===CUSTOMER_ORIGIN,'portal-build customerOrigin divergente');
      check(build.merchantOrigin===MERCHANT_ORIGIN,'portal-build merchantOrigin divergente');
      check(build.adminOrigin===ADMIN_ORIGIN,'portal-build adminOrigin divergente');
      check(/^[0-9a-f]{40}$/.test(String(build.sourceSha||'')),'portal-build sem SHA fonte válido');
    }else{
      check(false,'portal-build.json HTTP '+buildResponse.status);
    }

    const runtimeResponse=await resilientFetch(
      cfg.origin+'/js/runtime-config.js?probe='+nonce,
      {},
      role+' runtime config'
    );
    portal.runtimeStatus=runtimeResponse.status;
    if(runtimeResponse.status===200){
      const runtime=await runtimeResponse.text();
      check(runtime.includes('globalThis.CHAMA_PORTAL_ROLE='+JSON.stringify(role)+';'),'runtime remoto não assume role '+role);
      for(const origin of [CUSTOMER_ORIGIN,MERCHANT_ORIGIN,ADMIN_ORIGIN]){
        check(runtime.includes(origin),'runtime remoto não conhece '+origin);
      }
      const turnstile=/globalThis\.CHAMA_TURNSTILE_SITE_KEY=("[^"]*"|'[^']*');/.exec(runtime)?.[1]||'';
      let turnstileKey='';
      try{turnstileKey=JSON.parse(turnstile)}catch{turnstileKey=turnstile.replace(/^['"]|['"]$/g,'')}
      portal.turnstileKey=turnstileKey||null;
      check(turnstileKey.length>=6,'runtime remoto sem site key Turnstile');
      check(!TEST_TURNSTILE_KEYS.has(turnstileKey),'runtime remoto usa chave Turnstile de teste/demo');
    }else{
      check(false,'runtime-config HTTP '+runtimeResponse.status);
    }

    const htmlResponse=await resilientFetch(
      cfg.origin+'/?probe='+nonce,
      {},
      role+' portal html'
    );
    portal.htmlStatus=htmlResponse.status;
    if(htmlResponse.status===200){
      const html=await htmlResponse.text();
      check(html.includes('data-chama-portal="'+role+'"'),'HTML remoto não é bundle isolado de '+role);
      check(html.includes(cfg.title),'HTML remoto não carrega título esperado de '+role);
    }else{
      check(false,'HTML HTTP '+htmlResponse.status);
    }
  }catch(error){
    portal.ready=false;
    portal.reasons.push(String(error?.message||error));
  }
  return portal;
}

async function probePortals(){
  return Promise.all(
    Object.entries(PORTALS).map(([role,cfg])=>verifyPortal(role,cfg))
  );
}

let portalResults=await probePortals();

// Cloudflare Pages publishes asynchronously after a GitHub push. In strict
// release mode, wait for the exact expected SHA instead of turning normal
// deployment propagation into a false-negative readiness failure.
if(REQUIRE_LIVE_PORTALS&&EXPECTED_SOURCE_SHA){
  for(let attempt=1;attempt<=7;attempt++){
    const expectedReady=portalResults.every(
      portal=>portal.ready&&portal.sourceSha===EXPECTED_SOURCE_SHA
    );
    if(expectedReady)break;
    if(attempt===7)break;
    console.log(
      'Aguardando propagação dos portais live para '+EXPECTED_SOURCE_SHA+
      ' (tentativa '+attempt+'/7)'
    );
    await sleep(10000);
    portalResults=await probePortals();
  }
}

const portalByRole=Object.fromEntries(portalResults.map(x=>[x.role,x]));
const readyPortals=portalResults.filter(x=>x.ready);
const sourceShas=new Set(readyPortals.map(x=>x.sourceSha).filter(Boolean));
const commonSourceSha=sourceShas.size===1?[...sourceShas][0]:null;
const expectedSourceMatches=!EXPECTED_SOURCE_SHA||commonSourceSha===EXPECTED_SOURCE_SHA;
const allReady=portalResults.every(x=>x.ready)&&sourceShas.size===1&&expectedSourceMatches;

if(!allReady){
  const problems=portalResults
    .filter(x=>!x.ready)
    .map(x=>x.role+': '+x.reasons.join('; '));
  if(readyPortals.length>1&&sourceShas.size!==1){
    problems.push('source SHA divergente entre portais: '+[...sourceShas].join(', '));
  }
  if(EXPECTED_SOURCE_SHA&&commonSourceSha!==EXPECTED_SOURCE_SHA){
    problems.push('source SHA remoto '+String(commonSourceSha||'ausente')+' difere do esperado '+EXPECTED_SOURCE_SHA);
  }
  const message='Portais live ainda não estão prontos: '+problems.join(' | ');
  if(REQUIRE_LIVE_PORTALS)assert.fail(message);
  console.warn('::warning title=TAMÃO live portals pendentes::'+message);
}

console.log(JSON.stringify({
  ok:true,
  adminAuthPublicEntry:'CAPTCHA_REQUIRED',
  adminClaimWithoutSession:'UNAUTHORIZED',
  allPortalsReady:allReady,
  commonSourceSha,
  expectedSourceSha:EXPECTED_SOURCE_SHA||null,
  expectedSourceMatches,
  portals:portalByRole,
  strictPortalGate:REQUIRE_LIVE_PORTALS
},null,2));
