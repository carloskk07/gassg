import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createOfflineFixtureServer,ORDER} from './driver-offline-fixture.mjs';

// Chromium uses the actual AES-GCM / IndexedDB browser implementations. There
// are no real Supabase credentials, calls, payments or merchant records.
const server=createOfflineFixtureServer();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-browser-offline-'));
const chromeBin=execFileSync('sh',['-c','command -v google-chrome || command -v chromium || command -v chromium-browser'],{encoding:'utf8'}).trim();
let chrome=null,ws=null,n=0;
const pending=new Map();
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++n,t=setTimeout(()=>{pending.delete(id);reject(Error('Chrome timeout '+method))},18000);
  pending.set(id,{resolve,reject,t});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return r.result?.value;
}
async function wait(expression,label){
 for(let i=0;i<100;i++){
  try{if(await evaluate(expression))return}catch{}
  await sleep(180);
 }
 throw Error('Browser condition failed: '+label);
}
try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const addr='http://127.0.0.1:'+server.address().port+'/';
 let debug=null,activeProfile='';
 const startupDiagnostics=[];
 for(let attempt=0;attempt<3&&!debug;attempt++){
  const attemptProfile=path.join(profile,'attempt-'+attempt);
  fs.mkdirSync(attemptProfile,{recursive:true});
  chrome=spawn(chromeBin,['--headless=new','--no-sandbox','--disable-gpu',
   '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-address=127.0.0.1',
   '--remote-debugging-port=0','--user-data-dir='+attemptProfile,'about:blank'],
  {stdio:['ignore','ignore','pipe']});
  let stderr='';
  chrome.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-1800)});
  chrome.on('error',err=>{stderr+=' '+String(err.message)});
  for(let i=0;i<55;i++){
   try{
    debug=Number(fs.readFileSync(path.join(attemptProfile,'DevToolsActivePort'),'utf8').split(/\s+/)[0]);
    if(debug>0){activeProfile=attemptProfile;break;}
   }catch{}
   if(chrome.exitCode!==null)break;
   await sleep(200);
  }
  if(!debug){
   startupDiagnostics.push({attempt,exitCode:chrome.exitCode,stderr:stderr.slice(-950)});
   chrome.kill('SIGKILL');
   await sleep(300);
  }
 }
 assert.ok(debug>0,'Chrome remote debugging unavailable: '+JSON.stringify(startupDiagnostics));
 const tabs=await (await fetch('http://127.0.0.1:'+debug+'/json/list')).json();
 const tab=tabs.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
 assert.ok(tab,'Chrome page unavailable');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,bad)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',bad,{once:true})});
 ws.addEventListener('message',event=>{
  const m=JSON.parse(String(event.data));
  if(m.id&&pending.has(m.id)){
   const x=pending.get(m.id);pending.delete(m.id);clearTimeout(x.t);
   if(m.error)x.reject(Error(JSON.stringify(m.error)));else x.resolve(m.result);
  }
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:addr+'?seed=1'});
 await wait('typeof merchantOfflineDeliverySaveFromUi==="function"&&!!crypto.subtle','page startup');
 // Install the repository's real service worker and its full asset list before
 // cutting network access. No special test-only offline worker is substituted.
 await evaluate('(async()=>{await navigator.serviceWorker.register("/sw.js");await navigator.serviceWorker.ready;return true})()');
 await wait('!!navigator.serviceWorker.controller','real service worker controls browser');
 assert.equal(await evaluate('merchantOfflineDeliveryCacheAssignments()'),true);
 assert.equal(await evaluate('merchantRuntime.offlineRestored===true'),false);
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 assert.equal(await evaluate('navigator.onLine'),false);
 // Two attempts racing for the same order must not overwrite the PIN.
 // The real IndexedDB readwrite transaction serializes competing saves.
 await evaluate('Promise.all([merchantOfflineDeliverySaveFromUi(O),merchantOfflineDeliverySaveFromUi(O)])');
 await wait('events.some(x=>x.type==="toast"&&x.text.includes("PENDENTE"))','offline staging');
 assert.equal(await evaluate('events.filter(x=>x.type==="toast"&&x.text.includes("PENDENTE")).length'),1,
  'only one racing save may persist as a pending receipt');
 assert.equal(await evaluate('events.filter(x=>x.type==="toast"&&x.text.includes("Já existe comprovante pendente")).length'),1,
  'the concurrent save must fail rather than replace the protected PIN');
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0);
 assert.equal(await evaluate('document.getElementById("live-pin-"+O).value'),'');
 assert.equal(await evaluate('document.getElementById("live-pin-"+O).disabled'),true);
 assert.equal(await evaluate('document.getElementById("live-paid-"+O).disabled'),true);
 assert.equal(await evaluate('document.getElementById("live-deliver-submit-"+O).textContent'),'Comprovante guardado (pendente)');
 assert.equal(await evaluate('document.getElementById("live-deliver-submit-"+O).disabled'),true);
 const proof=JSON.parse(await evaluate('(async()=>{const db=await new Promise((ok,bad)=>{const r=indexedDB.open("tamao-driver-receipts-v1");r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const all=t=>new Promise((ok,bad)=>{const r=db.transaction(t,"readonly").objectStore(t).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const receipts=await all("receipts"),keys=await all("keys");db.close();return JSON.stringify({count:receipts.length,plaintext:JSON.stringify(receipts).includes("6789")||JSON.stringify(receipts).includes("Rua Fictícia"),exportable:keys[0].key.extractable})})()'));
 assert.equal(proof.count,1);assert.equal(proof.plaintext,false);assert.equal(proof.exportable,false);
 await evaluate('merchantOfflineDeliveryReconcile(O)');
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0,'no server attempts offline');
 // Cold page initialization while truly offline: script and HTML must be
 // served by the actual service worker and authorized orders from ciphertext.
 await evaluate('sessionStorage.setItem("tamao-synthetic-auth",JSON.stringify(merchantRuntime.session));sessionStorage.setItem("tamao-synthetic-cold","1")');
 await send('Page.reload',{ignoreCache:false});
 await wait('typeof merchantOfflineDeliveryRestore==="function"&&merchantRuntime.status==="unavailable"','offline page reopened with real SW');
 assert.equal(await evaluate('navigator.onLine'),false);
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),true,'same-session encrypted assignment recovery');
 await evaluate('merchantRuntime.session.expires_at=Math.floor(Date.now()/1000)-1;merchantRuntime.merchant=null;merchantRuntime.orders=[]');
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),false,'expired session blocks offline restoration');
 await evaluate('merchantRuntime.session.expires_at=Math.floor(Date.now()/1000)+3600');
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),true);
 assert.equal(await evaluate('merchantRuntime.offlineRestored'),true);
 assert.equal(await evaluate('merchantRuntime.merchant.memberRole'),'driver');
 assert.equal(await evaluate('merchantRuntime.orders[0].address'),'Rua Fictícia, 123');
 assert.equal(await evaluate('merchantRuntime.orders[0].status'),'OUT_FOR_DELIVERY');
 assert.equal(await evaluate('merchantDriverOfflineQueue(merchantRuntime).includes("Rua Fictícia, 123")'),true);
 await evaluate('merchantOfflineDeliveryShowPending()');
 await wait('document.getElementById("merchant-offline-receipts").textContent.includes("aguardando servidor")','encrypted proof survives offline reopening');
 assert.equal(await evaluate('document.getElementById("live-pin-"+O).disabled'),true,'reopened browser locks saved PIN');
 assert.equal(await evaluate('document.getElementById("live-deliver-submit-"+O).textContent'),'Comprovante guardado (pendente)');
 // An offline restored address is not a license to send any API mutation.
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0);
 await evaluate('merchantRuntime.session.user.id=U2;merchantRuntime.merchant=null;merchantRuntime.orders=[]');
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),false,'other user cannot unlock old assignment');
 await evaluate('merchantRuntime.session.user.id=U1');
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),true);
 await evaluate('merchantRuntime.session=null;merchantRuntime.merchant=null;merchantRuntime.orders=[];sessionStorage.removeItem("tamao-synthetic-auth")');
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),false,'signed-out cold browser cannot recover address');
 await evaluate('sessionStorage.removeItem("tamao-synthetic-cold")');
 await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:1000000,uploadThroughput:1000000});
 await send('Page.reload',{ignoreCache:false});
 await wait('typeof merchantOfflineDeliveryShowPending==="function"','browser page reload');
 await evaluate('merchantOfflineDeliveryShowPending()');
 await wait('document.getElementById("merchant-offline-receipts").textContent.includes("aguardando servidor")','pending after reload');
 await evaluate('merchantRuntime.session.user.id=U2;merchantRuntime.orders[0].assignedDeliveryUserId=U2;merchantOfflineDeliveryShowPending()');
 await wait('document.getElementById("merchant-offline-receipts").textContent.includes("Nenhum comprovante")','different account isolated');
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0);
 await evaluate('merchantRuntime.session.user.id=U1;merchantRuntime.orders[0].assignedDeliveryUserId=U1;merchantOfflineDeliveryShowPending()');
 await wait('document.getElementById("merchant-offline-receipts").textContent.includes("aguardando servidor")','original account recovers');
 await evaluate('merchantRuntime.orders[0].status="CANCELLED";merchantOfflineDeliveryReconcile(O)');
 await wait('events.some(x=>x.type==="toast"&&x.text.includes("Permanece pendente"))','cancel rejection');
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0);
 await evaluate('merchantRuntime.orders[0].status="OUT_FOR_DELIVERY";merchantRuntime.orders[0].version=4;merchantOfflineDeliveryReconcile(O)');
 await wait('events.some(x=>x.type==="toast"&&x.text.includes("A chegada ou a versão do pedido não foi confirmada"))','version conflict before arrival');
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0);
 await evaluate('merchantRuntime.orders[0].version=3;failServer=true;merchantOfflineDeliveryReconcile(O)');
 await wait('events.some(x=>x.type==="toast"&&x.text.includes("Synthetic API 503"))','server error retained');
 assert.equal(await evaluate('document.getElementById("merchant-offline-receipts").querySelectorAll(".merchant-driver-local-receipt").length'),1);
 assert.equal(await evaluate('merchantRuntime.orders[0].status'),'ARRIVING');
 assert.equal(await evaluate('merchantRuntime.orders[0].version'),4);
 await evaluate('failServer=false;merchantOfflineDeliveryReconcile(O)');
 await wait('events.some(x=>x.type==="toast"&&x.text.includes("confirmada pelo servidor"))','real mock acknowledgement');
 await wait('document.getElementById("merchant-offline-receipts").textContent.includes("Nenhum comprovante")','receipt erased after ACK');
 assert.equal(await evaluate('document.getElementById("live-pin-"+O).disabled'),false,'server ACK unlocks staged input');
 assert.equal(await evaluate('document.getElementById("live-deliver-submit-"+O).textContent'),'Guardar comprovante (pendente)');
 assert.equal(await evaluate('merchantRuntime.orders[0].status'),'DELIVERED');
 assert.equal(await evaluate('events.filter(x=>x.type==="send"&&x.pinMatched).length'),2);
 assert.equal(await evaluate('events.filter(x=>x.type==="arrive").length'),1,'only one authorized arrival before delivery');
 const keys=JSON.parse(await evaluate('JSON.stringify(events.filter(x=>x.type==="send").map(x=>x.key))'));
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1],'same encrypted idempotency key reused after a lost ACK');
 assert.match(keys[0],/^complete-delivery:[A-Za-z0-9_-]{16,96}$/);

 // True process-level PWA restart: kill Chromium, relaunch the SAME user
 // profile while offline. A fresh app tab has no Supabase sessionStorage;
 // ciphertext may still be present, but NO delivery/address can be unlocked.
 assert.equal(await evaluate('(async()=>{merchantRuntime.orders[0].status="OUT_FOR_DELIVERY";merchantRuntime.orders[0].version=11;merchantRuntime.lastSyncAt=new Date(Date.now()-1000).toISOString();document.getElementById("live-pin-"+O).value="6789";document.getElementById("live-paid-"+O).checked=true;return merchantOfflineDeliveryCacheAssignments()})()'),true);
 await evaluate('merchantOfflineDeliverySaveFromUi(O)');
 await wait('events.some(x=>x.type==="toast"&&x.text.includes("PENDENTE"))','proof staged before browser process exit');
 const exitPromise=new Promise(resolve=>chrome.once('exit',resolve));
 try{ws.close()}catch{}
 chrome.kill('SIGKILL');
 await exitPromise;
 ws=null;
 try{fs.unlinkSync(path.join(activeProfile,'DevToolsActivePort'))}catch{}
 chrome=spawn(chromeBin,['--headless=new','--no-sandbox','--disable-gpu',
  '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
  '--remote-allow-origins=*','--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0','--user-data-dir='+activeProfile,'about:blank'],{stdio:'ignore'});
 let rebootPort=null;
 for(let i=0;i<100;i++){
  try{
   rebootPort=Number(fs.readFileSync(path.join(activeProfile,'DevToolsActivePort'),'utf8').split(/\s+/)[0]);
   if(rebootPort>0)break;
  }catch{}
  if(chrome.exitCode!==null)break;
  await sleep(200);
 }
 assert.ok(rebootPort>0,'same-profile Chrome process must start after closing browser');
 const rebootTabs=await (await fetch('http://127.0.0.1:'+rebootPort+'/json/list')).json();
 const rebootTab=rebootTabs.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
 assert.ok(rebootTab);
 ws=new WebSocket(rebootTab.webSocketDebuggerUrl);
 await new Promise((ok,bad)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',bad,{once:true})});
 ws.addEventListener('message',event=>{
  const m=JSON.parse(String(event.data));
  if(m.id&&pending.has(m.id)){
   const x=pending.get(m.id);pending.delete(m.id);clearTimeout(x.t);
   if(m.error)x.reject(Error(JSON.stringify(m.error)));else x.resolve(m.result);
  }
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await send('Page.navigate',{url:addr});
 await wait('typeof merchantOfflineDeliveryRestore==="function"','PWA offline shell after complete process restart');
 assert.equal(await evaluate('navigator.onLine'),false);
 assert.equal(await evaluate('merchantRuntime.session'),null,'a new tab must not invent stored Auth');
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),false,'no auth after process exit must remain fail closed');
 assert.equal(await evaluate('merchantRuntime.orders.length'),0);
 assert.equal(await evaluate('merchantRuntime.merchant'),null);
 assert.equal(await evaluate('events.filter(x=>x.type==="send"||x.type==="arrive").length'),0);
 console.log('PASS Chrome real process restart, same IndexedDB/PWA profile offline: no session means no address, PIN or unconfirmed server mutation.');

 console.log('PASS Chrome 390px: real SW, offline page reopen + AES-GCM assignments and receipt, reload, isolation, cancelled/version conflict, 503 pending, server ACK before deletion.');
}finally{
 try{ws?.close()}catch{}
 try{chrome?.kill('SIGKILL')}catch{}
 await new Promise(ok=>server.close(ok));
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:15,retryDelay:150})}
 catch(error){console.warn('Temporary Chrome profile cleanup was deferred:',error.code)}
}
