import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';

const base=process.env.TAMAO_DEMO_URL||'http://127.0.0.1:4185/';
const url=new URL(base);
assert.ok(url.hostname==='127.0.0.1'&&url.protocol==='http:','Chrome test must be local');
const chromeBin=execFileSync('sh',['-c','command -v google-chrome || command -v chromium || command -v chromium-browser'],{encoding:'utf8'}).trim();
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-browser-demo-'));
const chrome=spawn(chromeBin,[
 '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
 '--no-first-run','--no-default-browser-check','--remote-allow-origins=*',
 '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
 '--user-data-dir='+profile,'about:blank'
],{stdio:'ignore',detached:true});
const delay=ms=>new Promise(done=>setTimeout(done,ms));
let ws,tab;
const pending=new Map();
let id=0;
const forbidden=[];
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const request=++id;
  const timer=setTimeout(()=>{pending.delete(request);reject(Error('Chrome command timeout: '+method))},16000);
  pending.set(request,{resolve,reject,timer});
  ws.send(JSON.stringify({id:request,method,params}));
 });
}
async function evaluate(expression){
 const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return r.result?.value;
}
async function wait(expression,label,timeout=20000){
 const until=Date.now()+timeout;
 while(Date.now()<until){
  try{if(await evaluate(expression))return}catch{}
  await delay(160);
 }
 const diagnostic=await evaluate("JSON.stringify({href:location.href,route:typeof route==='function'?route():'none',body:document.body?.innerText?.slice(0,520),demo:!!window.ChamaTest,orders:window.ChamaTest?.getState?.()?.orders?.map(o=>({id:o.id,status:o.status})),error:window.__lastRenderError||''})").catch(()=>'?');
 throw Error(label+' failed: '+diagnostic);
}
const click=async expression=>{
 const ok=await evaluate(expression);
 assert.equal(ok,true,'Expected a VISIBLE DOM control: '+expression.slice(0,140));
};
const demoState=()=>evaluate('JSON.stringify(window.ChamaTest.getState())').then(x=>JSON.parse(x));
async function snapshot(filename){
 const dir=path.resolve('test-results/browser-demo-evidence');
 fs.mkdirSync(dir,{recursive:true});
 const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 const content=Buffer.from(result.data||'','base64');
 assert.ok(content.length>6000,'screen capture incomplete');
 fs.writeFileSync(path.join(dir,filename),content);
}
try{
 let port=null;
 for(let i=0;i<70;i++){
  try{
   const raw=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8');
   const n=Number(raw.split(/\s+/)[0]);
   if(Number.isInteger(n)&&n>0){port=n;break;}
  }catch{}
  await delay(200);
 }
 assert.ok(port,'Headless Chrome did not expose localhost debugger');
 let entry;
 for(let i=0;i<60;i++){
  try{
   const list=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
   entry=list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
   if(entry)break;
  }catch{}
  await delay(200);
 }
 assert.ok(entry,'Chrome did not open its initial tab');
 ws=new WebSocket(entry.webSocketDebuggerUrl);
 await new Promise((ok,bad)=>{
  const timer=setTimeout(()=>bad(Error('DevTools websocket unavailable')),8000);
  ws.addEventListener('open',()=>{clearTimeout(timer);ok()},{once:true});
  ws.addEventListener('error',bad,{once:true});
 });
 ws.addEventListener('message',event=>{
  const m=JSON.parse(String(event.data));
  if(m.method==='Network.requestWillBeSent'){
   const target=m.params?.request?.url||'';
   if(/lgugwujpunhslavewffd\.supabase\.co|mercadopago\.com|\.woovi\.com/.test(target))forbidden.push(target);
  }
  if(m.id&&pending.has(m.id)){
   const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);
   if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);
  }
 });
 await send('Page.enable');
 await send('Runtime.enable');
 await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:840,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:base+'#home'});
 await wait("document.readyState==='complete'&&window.TAMAO_BROWSER_DEMO===true&&window.ChamaTest?.getState?.()?.merchants?.length===3&&!!document.querySelector('#tamao-demo-progress')",'home + 3 synthetic merchants');
 assert.equal(await evaluate('window.CHAMA_INTERNAL_PILOT'),false);
 assert.equal(await evaluate('window.__CHAMA_TEST__'),true);
 assert.ok((await evaluate("document.getElementById('tamao-demo-browser-banner').innerText")).includes('Pedidos e valores fictícios'));
 assert.equal((await demoState()).orders.length,0,'fresh Chrome profile must start with no orders');
 await snapshot('01-cliente-home-demo.png');
 await click("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.getAttribute('onclick')?.includes(\"homeChooseProduct('WATER20')\"));if(!b)return false;b.click();return true})()");
 await wait("route()==='order'&&state.cart?.WATER20>0",'water product click');
 await click("(()=>{const a=document.querySelector('#address'),p=document.querySelector('#postal-code'),b=Array.from(document.querySelectorAll('button')).find(x=>x.getAttribute('onclick')==='setAddress()');if(!a||!p||!b)return false;a.value='Rua Teste, 10';p.value='97300-000';b.click();return true})()");
 await wait("state.address==='Rua Teste, 10'&&document.querySelector('.offer-submit:not(:disabled)')",'simulated quote',16000);
 await click("(()=>{const s=document.querySelector('#payment-method');if(!s)return false;s.value='cash';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
 await wait("state.checkout.paymentMethod==='cash'&&document.querySelector('.offer-submit:not(:disabled)')",'cash selection');
 // Use the actual offer button, not a direct call to createOrderForMerchant.
 await click("(()=>{const b=document.querySelector('.offer-submit:not(:disabled)');if(!b)return false;b.click();return true})()");
 await wait("route()==='tracking'&&window.ChamaTest.getState().orders.at(-1)?.status==='OFFERED_TO_MERCHANT'",'actual buyer checkout');
 const o=(await demoState()).orders.at(-1);
 assert.match(o.id,/^SG-[A-Z0-9-]+$/);
 assert.ok(o.total>0,'quote must lock a positive total');
 assert.ok(o.pin?.length===4,'synthetic proof-of-delivery PIN');
 assert.ok((await evaluate("document.querySelector('#tamao-demo-progress').textContent")).includes('2/4'));
 await snapshot('02-cliente-pedido-aguardando.png');
 // Admin must show this exact ID and never require real login.
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Admin (resumo)'));if(!b)return false;b.click();return true})()");
 await wait("document.querySelector('.tamao-demo-dialog[data-open=\"true\"]')?.textContent.includes("+JSON.stringify(o.id)+")",'Admin reads real in-browser synthetic order');
 assert.ok((await evaluate("document.querySelector('.tamao-demo-dialog').innerText")).includes('Não é o Admin autenticado'));
 await snapshot('03-admin-pedido-aguardando.png');
 // Selecting Revenda must automatically switch to the assigned merchant:
 // the chosen offer need not correspond to the previously selected A.
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Revenda (pedido)'));if(!b)return false;b.click();return true})()");
 await wait("route()==='merchant'&&state.selectedMerchant==="+JSON.stringify(o.merchantId)+"&&document.querySelector('.order-id')?.textContent.includes("+JSON.stringify(o.id)+")",'open matching merchant and rendered order');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Aceitar pedido'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='PREPARING'",'merchant accept');
 await snapshot('04-revenda-pedido-aceito.png');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Confirmar saída'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='OUT_FOR_DELIVERY'",'merchant dispatch');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Estou chegando'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='ARRIVING'",'merchant arriving');
 await click("(()=>{const pin=document.querySelector('.pin-input'),paid=document.querySelector('.order-card input[type=\"checkbox\"]'),b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Confirmar entrega'));if(!pin||!paid||!b)return false;pin.value="+JSON.stringify(o.pin)+";paid.checked=true;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='SETTLED'",'merchant delivery with PIN and cash confirmation');
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Admin (resumo)'));if(!b)return false;b.click();return true})()");
 await wait("document.querySelector('.tamao-demo-dialog[data-open=\"true\"]')?.innerText.includes('Concluídos: 1')&&document.querySelector('.tamao-demo-dialog')?.textContent.includes("+JSON.stringify(o.id)+")",'Admin completed order');
 await snapshot('05-admin-pedido-concluido.png');
 await send('Page.navigate',{url:base+'#home'});
 await wait("window.ChamaTest?.getState?.()?.orders?.at(-1)?.status==='SETTLED'",'same order persists on refresh');
 assert.equal((await demoState()).orders.filter(x=>x.id===o.id).length,1);
 assert.deepEqual(forbidden,[],'browser-only demo must never contact commercial backend or PSP');
 console.log('PASS: hosted demo mobile Chrome CLIENT WATER20 -> ADDRESS -> CASH -> ORDER -> ADMIN -> ASSIGNED MERCHANT ACCEPT/DISPATCH/ARRIVING/PIN/SETTLE -> ADMIN RECEIPT -> RELOAD. No commercial API/PSP.');
}finally{
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closing'))}
 ws?.close();
 try{if(chrome.pid)process.kill(-chrome.pid,'SIGTERM')}catch{chrome.kill('SIGTERM')}
 await delay(500);
 try{if(chrome.pid)process.kill(-chrome.pid,'SIGKILL')}catch{}
 fs.rmSync(profile,{recursive:true,force:true,maxRetries:6,retryDelay:120});
}
