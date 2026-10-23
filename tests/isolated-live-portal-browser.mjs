import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';

// Browser exercise of EXISTING frontend code, pointed to localhost ONLY.
// No production source, config, portal bundle or database is changed.
export async function verifyIsolatedLivePortals({api,anon,buyer,owner,adminActor,orderId,merchantId}){
 assert.equal(process.env.CI,'true');
 assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
 assert.match(api,/^http:\/\/127\.0\.0\.1:54321\/?$/);
 assert.ok(anon.length>20);
 for(const actor of [buyer,owner,adminActor]){
  assert.ok(actor.session?.access_token?.length>100);
  assert.ok(typeof actor.session?.refresh_token==='string'&&actor.session.refresh_token.length>0,'refresh token required');
  assert.equal(actor.session.user?.id,actor.id);
 }
 const root=path.resolve('.');
 const backend=fs.readFileSync('js/backend.js','utf8');
 const remoteUrl="url:'https://lgugwujpunhslavewffd.supabase.co'";
 const remoteKey="publishableKey:'sb_publishable_3FLGyrWHrUZ5vQc59Iowug_pekOZ9u_'";
 assert.equal(backend.split(remoteUrl).length,2);
 assert.equal(backend.split(remoteKey).length,2);
 const localBackend=backend.replace(remoteUrl,"url:"+JSON.stringify(api))
   .replace(remoteKey,"publishableKey:"+JSON.stringify(anon));
 const html=fs.readFileSync('index.html','utf8');
 const remoteCsp="https://lgugwujpunhslavewffd.supabase.co wss://lgugwujpunhslavewffd.supabase.co";
 assert.equal(html.split(remoteCsp).length,2);
 const localHtml=html.replace(remoteCsp,api);
 const origin='http://127.0.0.1:4179';
 const mime={'.js':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
 const server=http.createServer((req,res)=>{
  try{
   const u=new URL(req.url||'/',origin),urlPath=decodeURIComponent(u.pathname);
   const full=path.resolve(root,'.'+urlPath+(urlPath.endsWith('/')?'index.html':''));
   if(!full.startsWith(root+path.sep)||!fs.statSync(full).isFile())throw Error('Not a checked-in asset');
   const rel=path.relative(root,full).replaceAll(path.sep,'/');
   const body=rel==='index.html'?localHtml:rel==='js/backend.js'?localBackend:fs.readFileSync(full);
   res.writeHead(200,{'Content-Type':mime[path.extname(full)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);
  }catch{res.writeHead(404).end('Not found')}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4179,'127.0.0.1',resolve)});
 const which=execFileSync('sh',['-c','command -v google-chrome || command -v chromium || command -v chromium-browser'],{encoding:'utf8'}).trim();
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-real-ui-'));
 const chrome=spawn(which,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','--remote-debugging-port=9229','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let ws,seq=0;
 const pending=new Map(),violations=[],merchantAccessStatuses=[],adminReadStatuses=[];
 const sleep=ms=>new Promise(done=>setTimeout(done,ms));
 function send(method,params={}){
  const id=++seq;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);
   pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
 }
 async function evaluate(expression){
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result?.value;
 }
 async function wait(expression,label,limit=38000){
  const deadline=Date.now()+limit;
  while(Date.now()<deadline){
   try{if(await evaluate(expression))return}catch{}
   await sleep(250);
  }
  const info=await evaluate("JSON.stringify({text:document.body.innerText.slice(0,250),merchant:typeof merchantRuntime==='undefined'?null:{status:merchantRuntime.status,error:merchantRuntime.error},customer:typeof liveRuntime==='undefined'?null:{status:liveRuntime.status,error:liveRuntime.error}})").catch(e=>String(e));
  throw Error('Portal did not render real state '+label+': '+info);
 }
 try{
  let target;
  for(let n=0;n<90;n++){
   try{
    const pages=await(await fetch('http://127.0.0.1:9229/json/list')).json();
    target=pages.find(p=>p.type==='page'&&p.webSocketDebuggerUrl);
    if(target)break;
   }catch{}
   await sleep(250);
  }
  assert.ok(target,'Chrome CDP unavailable');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Chrome websocket refused')),10000);
   ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
   ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',ev=>{
   const msg=JSON.parse(String(ev.data));
   if(msg.method==='Network.requestWillBeSent'&&/\.supabase\.co/i.test(msg.params?.request?.url||'')){
    violations.push('Remote Supabase was requested');
   }
   if(msg.method==='Network.responseReceived'&&String(msg.params?.response?.url||'').startsWith(api+'/functions/v1/merchant-orders')){
    merchantAccessStatuses.push(msg.params.response.status);
   }
   if(msg.method==='Network.responseReceived'&&String(msg.params?.response?.url||'').startsWith(api+'/functions/v1/admin-ops')){
    adminReadStatuses.push(msg.params.response.status);
   }
   if(msg.id&&pending.has(msg.id)){
    const {resolve,reject,timer}=pending.get(msg.id);clearTimeout(timer);pending.delete(msg.id);
    if(msg.error)reject(Error(JSON.stringify(msg.error)));else resolve(msg.result);
   }
  });
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  const init="(()=>{if(location.origin!=="+JSON.stringify(origin)+")return;"+
   "localStorage.setItem('chama-sg-customer-auth-v2',"+JSON.stringify(JSON.stringify(buyer.session))+");"+
   "localStorage.setItem('chama-live-order-id-v1',"+JSON.stringify(orderId)+");"+
   "sessionStorage.setItem('chama-sg-merchant-auth-v1',"+JSON.stringify(JSON.stringify(owner.session))+");"+
   "})();";
  const {identifier:authFixture}=await send('Page.addScriptToEvaluateOnNewDocument',{source:init});
  const navigate=async url=>{
   await send('Page.navigate',{url});
   await wait("document.readyState==='complete'&&!!document.querySelector('#app')",'page load',16000);
  };
  await navigate(origin+'/?merchant=1#merchant');
  await wait("typeof merchantRuntime!=='undefined'&&merchantRuntime.status==='ready'&&merchantRuntime.orders.some(o=>o.orderId==="+JSON.stringify(orderId)+")",'merchant order');
  const merchant=JSON.parse(await evaluate("JSON.stringify({status:merchantRuntime.status,orders:merchantRuntime.orders.length,match:merchantRuntime.orders.some(o=>o.orderId==="+JSON.stringify(orderId)+"),visible:document.querySelector('#app')?.innerText.slice(0,4000)})"));
  assert.equal(merchant.status,'ready');assert.equal(merchant.match,true);
  assert.match(merchant.visible,/Revenda Simulada CI|Pedidos|Preparando|PREPARANDO/i);
  await navigate(origin+'/#tracking');
  await wait("typeof liveRuntime!=='undefined'&&liveRuntime.status==='ready'&&liveRuntime.order?.orderId==="+JSON.stringify(orderId),'buyer tracking');
  const buyerState=JSON.parse(await evaluate("JSON.stringify({status:liveRuntime.status,orderId:liveRuntime.order?.orderId,visible:document.querySelector('#app')?.innerText.slice(0,4000)})"));
  assert.equal(buyerState.status,'ready');assert.equal(buyerState.orderId,orderId);
  assert.ok(buyerState.visible.length>110,'buyer must see a useful rendered tracking screen');

  // Switch ONLY the disposable browser's merchant session to the actual
  // buyer's local Auth token. Without this gate the prior owner fixture
  // would silently grant access again after Page.navigate.
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:authFixture});
  const swapped=await evaluate("(()=>{sessionStorage.setItem('chama-sg-merchant-auth-v1',"+
    JSON.stringify(JSON.stringify(buyer.session))+
    ");localStorage.removeItem('chama-merchant-selected-v1');return true})()");
  assert.equal(swapped,true,'browser session fixture must switch to buyer');
  merchantAccessStatuses.length=0;
  await navigate(origin+'/?merchant=1#merchant');
  await wait("typeof merchantRuntime!=='undefined'&&merchantRuntime.status==='no-access'&&merchantRuntime.orders.length===0",
    'customer must not access the merchant order screen');
  const denied=JSON.parse(await evaluate("JSON.stringify({status:merchantRuntime.status,reason:merchantRuntime.accessReason,orders:merchantRuntime.orders.length,visible:document.querySelector('#app')?.innerText.slice(0,4000)})"));
  assert.equal(denied.reason,'NO_MERCHANT_ACCESS','merchant-orders must reject customer session');
  assert.equal(denied.orders,0,'denied buyer must not see merchant orders');
  assert.ok(merchantAccessStatuses.includes(403),'real merchant-orders response must be 403');
  assert.ok(!denied.visible.includes(orderId),'the merchant portal must not show the protected order ID');
  // Actual third portal: standard authenticated Admin session, canonical
  // admin-auth bootstrap check and admin-ops summary against localhost.
  await evaluate("(()=>{sessionStorage.setItem('chama-sg-admin-auth-v1',"+
    JSON.stringify(JSON.stringify(adminActor.session))+
    ");sessionStorage.setItem('tamao-admin-section','orders');return true})()");
  adminReadStatuses.length=0;
  await navigate(origin+'/?admin=1#admin');
  await wait("typeof adminRuntime!=='undefined'&&adminRuntime.status==='ready'&&Array.isArray(adminRuntime.data?.controlOrders)&&adminRuntime.data.controlOrders.some(o=>o.id==="+JSON.stringify(orderId)+")",
    'Admin Tower of Control must load the exact local order',55000);
  const adminView=JSON.parse(await evaluate("JSON.stringify({status:adminRuntime.status,role:adminRuntime.data?.currentAdmin?.admin_role,orders:adminRuntime.data?.controlOrders?.length,match:adminRuntime.data?.controlOrders?.some(o=>o.id==="+JSON.stringify(orderId)+"),visible:document.querySelector('#app')?.innerText.slice(0,5000)})"));
  assert.equal(adminView.role,'superadmin','Admin UI must use its real membership role');
  assert.equal(adminView.match,true);
  assert.ok(adminReadStatuses.includes(200),'Chrome must receive a successful canonical admin-ops summary');
  assert.ok(adminView.visible.length>110,'Admin portal must render useful content');
  assert.deepEqual(violations,[],'browser must never contact production Supabase');
  console.log('PASS: Chrome merchant+buyer render the same local order; authenticated buyer gets 403 and no merchant orders; zero remote backend requests.');
 }finally{
  if(ws){for(const [,p] of pending){clearTimeout(p.timer);p.reject(Error('Browser cleanup'))}ws.close()}
  chrome.kill('SIGTERM');
  await new Promise(done=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return done();chrome.once('exit',done);setTimeout(done,2000).unref()});
  await new Promise(done=>server.close(done));
  fs.rmSync(profile,{recursive:true,force:true});
 }
}
