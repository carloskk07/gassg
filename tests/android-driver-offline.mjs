import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createOfflineFixtureServer,ORDER} from './driver-offline-fixture.mjs';

// Runs only inside a disposable Android Emulator on GitHub Actions.
// Exercises real Android Chrome IndexedDB, AES-GCM and the repository's SW.
// The driver and API are SYNTHETIC; this cannot authorize commercial release.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
const runAdb=(...args)=>execFileSync('adb',args,{
 encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
}).trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const host='http://127.0.0.1:4178';
const server=createOfflineFixtureServer();
let ws=null,seq=0;
const pending=new Map();
function send(method,params={}){
 const id=++seq;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Android CDP timeout '+method))},22000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const result=await send('Runtime.evaluate',{
  expression,awaitPromise:true,returnByValue:true,userGesture:true
 });
 if(result.exceptionDetails)
  throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 return result.result?.value;
}
async function wait(expression,label,limit=35000){
 const deadline=Date.now()+limit;
 while(Date.now()<deadline){
  try{if(await evaluate(expression))return}catch{}
  await sleep(250);
 }
 const diag=await evaluate('JSON.stringify({url:location.href,text:document.body.innerText.slice(0,220),ready:document.readyState})').catch(e=>String(e));
 throw Error('Android Chrome condition failed '+label+': '+diag);
}
async function screenshot(name){
 assert.match(name,/^0[12]-[a-z0-9-]+$/);
 const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
 const image=Buffer.from(result.data||'','base64');
 assert.ok(image.length>6000&&image.subarray(0,8).toString('hex')==='89504e470d0a1a0a',
  'Android Chrome screenshot must be a PNG');
 const folder=path.resolve('test-results/android-driver-offline');
 fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,name+'.png'),image);
}
async function attachChrome(){
 let target=null,lastDevtoolsError='',lastTargets=[];
 for(let i=0;i<120;i++){
  try{
   const response=await fetch('http://127.0.0.1:9222/json/list',{
    signal:AbortSignal.timeout(1500)
   });
   if(response.ok){
    const list=await response.json();
    lastTargets=list.map(p=>({type:p.type,title:String(p.title||'').slice(0,80),
      url:String(p.url||'').slice(0,100)}));
    target=list.find(p=>p.type==='page'&&p.webSocketDebuggerUrl);
    if(target)break;
   }else lastDevtoolsError='HTTP '+response.status;
  }catch(error){lastDevtoolsError=String(error?.message||error)}
  await sleep(400);
 }
 if(!target){
  // Failure evidence is only from this disposable Android image. It never
  // captures customer data or calls a remote production service.
  const diagnostics={lastDevtoolsError,lastTargets,
    chromePid:runAdb('shell','pidof','com.android.chrome'),
    activity:runAdb('shell','dumpsys','activity','activities').slice(-5000),
    unixSockets:runAdb('shell','cat','/proc/net/unix').split('\\n')
      .filter(x=>/chrome_devtools|webview_devtools/.test(x)).slice(0,6)};
  const folder=path.resolve('test-results/android-driver-offline');
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'debug-failure.json'),
    JSON.stringify(diagnostics,null,2)+'\\n');
  try{fs.writeFileSync(path.join(folder,'debug-screen.png'),
    execFileSync('adb',['exec-out','screencap','-p'],{timeout:10000}))}catch{}
  console.error('Android Chrome startup diagnostic:',JSON.stringify(diagnostics));
 }
 assert.ok(target,'Android Chrome DevTools over ADB must expose a page target');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Android CDP WebSocket unavailable')),12000);
  ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
  ws.addEventListener('error',reject,{once:true});
 });
 ws.addEventListener('message',event=>{
  const message=JSON.parse(String(event.data));
  if(message.id&&pending.has(message.id)){
   const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);
   if(message.error)p.reject(Error(JSON.stringify(message.error)));
   else p.resolve(message.result);
  }
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');

}
try{
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(4178,'0.0.0.0',resolve);
 });
 assert.ok(runAdb('shell','pm','path','com.android.chrome').includes('package:'),
  'Android Play Store emulator must have real Google Chrome installed');
 // Play Store images may show Chrome's onboarding screen instead of the
 // requested test tab. Enable the documented emulator-only Chrome flags.
 runAdb('shell','am','set-debug-app','--persistent','com.android.chrome');
 const flagsFolder=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-android-flags-'));
 try{
  const flagsFile=path.join(flagsFolder,'chrome-command-line');
  fs.writeFileSync(flagsFile,'chrome --disable-fre --no-first-run --no-default-browser-check\n');
  // adb push avoids shell metacharacter/quote splitting on Android.
  runAdb('push',flagsFile,'/data/local/tmp/chrome-command-line');
 }finally{fs.rmSync(flagsFolder,{recursive:true,force:true})}
 runAdb('reverse','tcp:4178','tcp:4178');
 runAdb('forward','tcp:9222','localabstract:chrome_devtools_remote');
 runAdb('shell','am','start','-a','android.intent.action.VIEW','-d',
  host+'/?seed=1','com.android.chrome');
 await attachChrome();
 await send('Page.navigate',{url:host+'/?seed=1'});
 await wait('typeof merchantOfflineDeliverySaveFromUi==="function"&&!!crypto.subtle','real Android Chrome loads delivery module');
 assert.equal(await evaluate('location.hostname'),'127.0.0.1');
 await evaluate('(async()=>{await navigator.serviceWorker.register("/sw.js");await navigator.serviceWorker.ready;return true})()');
 if(!await evaluate('!!navigator.serviceWorker.controller'))
  await send('Page.reload',{ignoreCache:false});
 await wait('typeof merchantOfflineDeliveryCacheAssignments==="function"&&!!navigator.serviceWorker.controller',
  'actual Android Chrome SW controls the page');
 assert.equal(await evaluate('merchantOfflineDeliveryCacheAssignments()'),true);
 await send('Network.emulateNetworkConditions',{
  offline:true,latency:0,downloadThroughput:0,uploadThroughput:0
 });
 assert.equal(await evaluate('navigator.onLine'),false);
 await evaluate('merchantOfflineDeliverySaveFromUi(O)');
 await wait('document.getElementById("live-deliver-submit-"+O).textContent.includes("Comprovante guardado")',
  'Android Chrome encrypts offline proof');
 assert.equal(await evaluate('document.getElementById("live-pin-"+O).value'),'',
  'delivery PIN is cleared before screenshots');
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0,
  'offline Android Chrome must not call any server mutation');
 assert.equal(await evaluate('(async()=>{const db=await new Promise((ok,bad)=>{const r=indexedDB.open("tamao-driver-receipts-v1");r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const tx=db.transaction("receipts","readonly");const entries=await new Promise((ok,bad)=>{const r=tx.objectStore("receipts").getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});db.close();return entries.length===1&&!JSON.stringify(entries).includes("6789")})()'),true,
  'real Android IndexedDB holds one ciphertext, never clear PIN');
 await evaluate('merchantOfflineDeliveryShowPending()');
 await screenshot('01-android-chrome-pendente');
 await evaluate('sessionStorage.setItem("tamao-synthetic-auth",JSON.stringify(merchantRuntime.session));sessionStorage.setItem("tamao-synthetic-cold","1")');
 await send('Page.reload',{ignoreCache:false});
 await wait('typeof merchantOfflineDeliveryRestore==="function"&&merchantRuntime.status==="unavailable"',
  'Android Chrome loads offline page from real service worker');
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),true,'valid offline session restores encrypted assignment');
 await evaluate('merchantOfflineDeliveryShowPending()');
 await wait('document.getElementById("merchant-offline-receipts").textContent.includes("aguardando servidor")',
  'Android Chrome retains ciphertext across offline reload');
 assert.equal(await evaluate('events.filter(x=>x.type==="send").length'),0);
 // Android-specific gate: terminate the whole native Chrome application,
 // reopen the SAME on-device profile and keep a saved, encrypted proof.
 // Without an authenticated session, no address or pending PIN can be read.
 await evaluate('sessionStorage.removeItem("tamao-synthetic-auth")');
 try{ws.close()}catch{}
 ws=null;
 runAdb('shell','am','force-stop','com.android.chrome');
 await sleep(1000);
 runAdb('shell','am','start','-a','android.intent.action.VIEW','-d',
  host+'/','com.android.chrome');
 await attachChrome();
 await send('Network.emulateNetworkConditions',{
  offline:true,latency:0,downloadThroughput:0,uploadThroughput:0
 });
 await send('Page.navigate',{url:host+'/'});
 await wait('typeof merchantOfflineDeliveryRestore==="function"&&merchantRuntime.session===null',
  'Android app force-stop/restart has no available Auth session');
 assert.equal(await evaluate('navigator.onLine'),false);
 assert.equal(await evaluate('merchantOfflineDeliveryRestore()'),false,
  'same Android profile cannot unlock delivery details without Auth');
 assert.equal(await evaluate('merchantRuntime.orders.length'),0);
 assert.equal(await evaluate('merchantRuntime.merchant'),null);
 assert.equal(await evaluate('(async()=>{const db=await new Promise((ok,bad)=>{const r=indexedDB.open("tamao-driver-receipts-v1");r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const tx=db.transaction("receipts","readonly");const entries=await new Promise((ok,bad)=>{const r=tx.objectStore("receipts").getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});db.close();return entries.length===1&&!JSON.stringify(entries).includes("6789")})()'),true,
  'AES-GCM proof persists through Android app force-stop without becoming readable');
 assert.equal(await evaluate('events.filter(x=>x.type==="send"||x.type==="arrive").length'),0,
  'force-stopped Android app must not send or confirm anything while offline');
 await send('Network.emulateNetworkConditions',{
  offline:false,latency:0,downloadThroughput:1000000,uploadThroughput:1000000
 });
 // The test-only cold flag must be reset when deliberately simulating a
 // fresh authenticated online session. The actual Android SW and encrypted
 // receipts persist independently of this synthetic fixture switch.
 await evaluate('sessionStorage.removeItem("tamao-synthetic-cold")');
 await send('Page.navigate',{url:host+'/?seed=1'});
 await wait('merchantRuntime.status==="ready"&&typeof merchantOfflineDeliveryReconcile==="function"',
  'Android Chrome explicitly reauthenticates online before replay');
 await evaluate('merchantOfflineDeliveryReconcile('+JSON.stringify(ORDER)+')');
 await wait('document.getElementById("merchant-offline-receipts").textContent.includes("Nenhum comprovante local pendente")',
  'proof removed only after matching synthetic server ACK');
 assert.equal(await evaluate('events.filter(x=>x.type==="arrive").length'),1);
 assert.equal(await evaluate('events.filter(x=>x.type==="send"&&x.pinMatched).length'),1);
 await screenshot('02-android-chrome-conciliado');
 console.log('PASS: Android emulator Chrome app force-stop and offline restart preserve encrypted receipt without Auth; explicit synthetic reauth completes ACK, then deletes ciphertext. No external Supabase or physical device.');
}finally{
 try{ws?.close()}catch{}
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Android CDP closed'))}
 pending.clear();
 try{runAdb('forward','--remove','tcp:9222')}catch{}
 try{runAdb('reverse','--remove','tcp:4178')}catch{}
 await new Promise(ok=>server.close(ok));
}
