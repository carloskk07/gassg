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
 await wait("document.querySelector('#tamao-demo-progress')?.textContent.includes('2/4')",'progress indicator after checkout',4500);
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
 // The merchant demo must focus on the order, not display pricing inputs first.
 const simpleMerchant=await evaluate("(()=>{const settings=document.querySelector('.merchant-demo-settings');const order=Array.from(document.querySelectorAll('h2')).find(x=>x.textContent.includes('Pedidos que exigem ação'));const accept=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Aceitar pedido'));return {closed:!!settings&&!settings.open,orderFirst:!!order&&!!settings&&Boolean(order.compareDocumentPosition(settings)&Node.DOCUMENT_POSITION_FOLLOWING),acceptVisible:!!accept&&accept.getClientRects().length>0,pricingHidden:document.querySelector('#m-price')?.getClientRects().length===0}})()");
 assert.ok(simpleMerchant.closed,'demo pricing must start collapsed');
 assert.ok(simpleMerchant.orderFirst,'order queue must precede pricing fields');
 assert.ok(simpleMerchant.acceptVisible,'merchant can accept without expanding setup');
 assert.ok(simpleMerchant.pricingHidden,'price fields must be hidden until requested');
 await snapshot('03b-revenda-pedido-pendente-simples.png');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Aceitar pedido'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='PREPARING'",'merchant accept');
 await wait("document.querySelector('#tamao-demo-progress')?.textContent.includes('3/4')",'guidance advances immediately on merchant accept',2500);
 await wait("(()=>{const card=Array.from(document.querySelectorAll('.order-card')).find(el=>el.querySelector('.order-id')?.textContent.includes("+JSON.stringify(o.id)+"));const r=card?.getBoundingClientRect();return !!r&&r.top>=115&&r.top<710})()", 'accepted order must remain visible after merchant render',5000);
 await snapshot('04-revenda-pedido-aceito.png');
 // Regression: the original header 'Comprar' used to reset to home,
 // hiding the accepted order even though localStorage retained it.
 await click("(()=>{const b=Array.from(document.querySelectorAll('.mode-pill button')).find(x=>x.textContent.trim()==='Comprar');if(!b||!b.getClientRects().length)return false;b.click();return true})()");
 await wait("route()==='tracking'&&state.mode==='customer'&&document.querySelector('#tamao-main')?.innerText.includes("+JSON.stringify(o.id)+")&&document.querySelector('#tamao-main')?.innerText.includes('Acompanhe a entrega')",'header Comprar resumes accepted order');
 assert.equal((await demoState()).orders.at(-1).status,'PREPARING','switching customer must not mutate the accepted order');
 await snapshot('04b-cliente-acompanhamento-apos-aceite.png');
 // Bottom navigation must expose "Pedidos" without searching the home
 // or creating a duplicate checkout.
 await click("(()=>{const b=Array.from(document.querySelectorAll('.bottom-nav button')).find(x=>x.textContent.includes('Início'));if(!b||!b.getClientRects().length)return false;b.click();return true})()");
 await wait("route()==='home'",'customer returns home');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.bottom-nav button')).find(x=>x.textContent.includes('Pedidos'));if(!b||!b.getClientRects().length)return false;b.click();return true})()");
 await wait("route()==='tracking'&&document.querySelector('#tamao-main')?.innerText.includes("+JSON.stringify(o.id)+")",'buyer finds existing order via bottom nav');
 assert.equal((await demoState()).orders.length,1,'navigation must not duplicate the order');

 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Revenda (pedido)'));if(!b)return false;b.click();return true})()");
 await wait("route()==='merchant'&&document.querySelector('.order-id')?.textContent.includes("+JSON.stringify(o.id)+")",'back to merchant same order');
 // Repeat from the banner Cliente link, not only the original header.
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Cliente · acompanhar pedido'));if(!b)return false;b.click();return true})()");
 await wait("route()==='tracking'&&document.querySelector('#tamao-main')?.innerText.includes("+JSON.stringify(o.id)+")",'demo banner resumes accepted order');
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Revenda (pedido)'));if(!b)return false;b.click();return true})()");
 await wait("route()==='merchant'&&document.querySelector('.order-id')?.textContent.includes("+JSON.stringify(o.id)+")",'return merchant after customer check');

 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Confirmar saída'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='OUT_FOR_DELIVERY'",'merchant dispatch');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.mode-pill button')).find(x=>x.textContent.trim()==='Comprar');if(!b||!b.getClientRects().length)return false;b.click();return true})()");
 await wait("route()==='tracking'&&document.querySelector('#tamao-main')?.innerText.includes("+JSON.stringify(o.id)+")&&document.querySelector('#tamao-main')?.innerText.includes('Código de recebimento')",'customer sees dispatched order and PIN');
 await snapshot('04c-cliente-entrega-e-pin.png');
 // Owner can now operate the same order as a DRIVER, not return to the
 // merchant's settings. This is explicitly an online-only synthetic screen.
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Entregador (simulação)'));if(!b)return false;b.click();return true})()");
 await wait("document.querySelector('.tamao-demo-dialog[data-open=\"true\"]')?.innerText.includes('Entregador — uma entrega por vez')&&document.querySelector('.tamao-demo-panel')?.textContent.includes("+JSON.stringify(o.id)+")",'driver sees only its synthetic active order');
 assert.ok(!(await evaluate("document.querySelector('.tamao-demo-panel').textContent")).includes(o.pin),
  'driver must ask customer for PIN, never display it in driver panel');
 await snapshot('04d-entregador-entrega-atribuida.png');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.tamao-demo-panel button')).find(x=>x.textContent.includes('Cheguei ao endereço'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='ARRIVING'&&!!document.getElementById('tamao-demo-driver-pin')",'driver arrival uses same existing simulator order transition');
 await snapshot('04e-entregador-confirmar-pin.png');
 // Verify actual IndexedDB + non-extractable WebCrypto AES-GCM on a mobile
 // Chromium viewport with NETWORK DISABLED, without changing any order.
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await click("(()=>{const b=document.getElementById('tamao-demo-device-check');if(!b||!b.getClientRects().length)return false;b.click();return true})()");
 await wait("document.getElementById('tamao-demo-device-status')?.textContent.includes('Aprovado neste navegador')",
   'Chrome WebCrypto and IndexedDB while offline',12000);
 assert.equal((await demoState()).orders.at(-1).status,'ARRIVING','device check must never complete delivery');
 assert.equal(await evaluate("new Promise((resolve,reject)=>{const req=indexedDB.open('tamao-demo-device-crypto-check-v1',1);req.onsuccess=()=>{const db=req.result;const tx=db.transaction('checks','readonly');const check=tx.objectStore('checks').get('probe');check.onsuccess=()=>{resolve(check.result===undefined);db.close()};check.onerror=()=>reject(check.error)};req.onerror=()=>reject(req.error)})"),
   true,'device check must delete encrypted probe and its key');
 await snapshot('04f-entregador-criptografia-sem-internet.png');
 await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:1000000,uploadThroughput:1000000});
 await wait('navigator.onLine===true','browser must report online after device capability check',10000);
 assert.deepEqual(forbidden,[],'offline device check must never call commercial API or PSP');
 // Negative path: the real existing simulator refuses completion until both
 // customer PIN and an explicit synthetic cash receipt are present.
 await click("(()=>{const p=document.getElementById('tamao-demo-driver-pin'),b=Array.from(document.querySelectorAll('.tamao-demo-panel button')).find(x=>x.textContent.includes('Concluir entrega simulada'));if(!p||!b)return false;p.value="+JSON.stringify(o.pin)+";b.click();return true})()");
 await wait("document.getElementById('tamao-demo-driver-status')?.textContent.includes('Confirme o recebimento')",'driver cannot settle without fictitious cash confirmation');
 assert.equal((await demoState()).orders.at(-1).status,'ARRIVING','missing synthetic cash checkbox never settles');
 await click("(()=>{const p=document.getElementById('tamao-demo-driver-pin'),c=document.getElementById('tamao-demo-driver-paid'),b=Array.from(document.querySelectorAll('.tamao-demo-panel button')).find(x=>x.textContent.includes('Concluir entrega simulada'));if(!p||!c||!b)return false;p.value="+JSON.stringify(o.pin)+";c.checked=true;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='SETTLED'&&document.querySelector('.tamao-demo-panel')?.textContent.includes('Entrega fictícia concluída')",'driver delivers with same PIN and cash rules');
 assert.equal((await demoState()).orders.at(-1).rewardsGranted,true,'same canonical simulator grants fictional benefits once');
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Admin (resumo)'));if(!b)return false;b.click();return true})()");
 await wait("document.querySelector('.tamao-demo-dialog[data-open=\"true\"]')?.innerText.includes('Concluídos: 1')&&document.querySelector('.tamao-demo-dialog')?.textContent.includes("+JSON.stringify(o.id)+")",'Admin completed order');
 await snapshot('05-admin-pedido-concluido.png');
 // Settled orders must remain available from the Admin's customer perspective.
 await click("(()=>{const b=Array.from(document.querySelectorAll('.tamao-demo-panel button')).find(x=>x.textContent.includes('Ver pedido como Cliente'));if(!b)return false;b.click();return true})()");
 await wait("route()==='tracking'&&document.querySelector('#tamao-main')?.innerText.includes("+JSON.stringify(o.id)+")&&document.querySelector('#tamao-main')?.innerText.includes('CONCLUÍDO')",'completed order available to customer');
 assert.equal((await demoState()).orders.filter(x=>x.id===o.id).length,1);

 await send('Page.navigate',{url:base+'#home'});
 await wait("window.ChamaTest?.getState?.()?.orders?.at(-1)?.status==='SETTLED'",'same order persists on refresh');
 assert.equal((await demoState()).orders.filter(x=>x.id===o.id).length,1);
 assert.deepEqual(forbidden,[],'browser-only demo must never contact commercial backend or PSP');

 // Main product on the SAME hosted UI: start P13 without Docker or any server API.
 // Keep the completed water order for a shared two-order Admin history.
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Começar com gás P13'));if(!b)return false;b.click();return true})()");
 await wait("route()==='order'&&state.cart?.P13===1&&Object.entries(state.cart).filter(([,qty])=>qty>0).length===1",'guided P13 product and clean cart');
 await click("(()=>{const a=document.querySelector('#address'),p=document.querySelector('#postal-code'),b=Array.from(document.querySelectorAll('button')).find(x=>x.getAttribute('onclick')==='setAddress()');if(!a||!p||!b)return false;a.value='Rua Teste P13, 20';p.value='97300-000';b.click();return true})()");
 await wait("state.address==='Rua Teste P13, 20'&&document.querySelector('.offer-submit:not(:disabled)')",'P13 quote');
 await click("(()=>{const s=document.querySelector('#payment-method');if(!s)return false;s.value='cash';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
 await wait("state.checkout.paymentMethod==='cash'&&document.querySelector('.offer-submit:not(:disabled)')",'P13 cash');
 await click("(()=>{const b=document.querySelector('.offer-submit:not(:disabled)');if(!b)return false;b.click();return true})()");
 await wait("route()==='tracking'&&window.ChamaTest.getState().orders.at(-1)?.status==='OFFERED_TO_MERCHANT'",'P13 checkout');
 const gas=(await demoState()).orders.at(-1);
 assert.notEqual(gas.id,o.id,'P13 must have a new order ID');
 assert.equal(gas.cart.P13,1);
 assert.ok(gas.items.some(i=>i.key==='P13'&&i.qty===1),'P13 must be present in the locked order items');
 assert.equal(gas.paymentMethod,'cash');
 assert.equal((await demoState()).orders.length,2,'one water and one P13 order only');
 await snapshot('06-cliente-gas-p13-aguardando.png');
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Revenda (pedido)'));if(!b)return false;b.click();return true})()");
 await wait("route()==='merchant'&&state.selectedMerchant==="+JSON.stringify(gas.merchantId)+"&&document.querySelector('.order-id')?.textContent.includes("+JSON.stringify(gas.id)+")",'assigned P13 merchant');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Aceitar pedido'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='PREPARING'",'P13 accepted');
 await snapshot('07-revenda-gas-p13-aceito.png');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Confirmar saída'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='OUT_FOR_DELIVERY'",'P13 dispatched');
 await click("(()=>{const b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Estou chegando'));if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='ARRIVING'",'P13 arriving');
 // Negative UI: even the correct PIN without payment confirmation must not settle.
 await click("(()=>{const p=document.querySelector('.pin-input'),b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Confirmar entrega'));if(!p||!b)return false;p.value="+JSON.stringify(gas.pin)+";b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='ARRIVING'",'cash confirmation required');
 assert.equal((await demoState()).orders.at(-1).paymentConfirmedAt,undefined);
 // Negative UI: payment checkbox does not authorize delivery with a wrong PIN.
 const invalidPin=gas.pin==='0000'?'0001':'0000';
 await click("(()=>{const p=document.querySelector('.pin-input'),paid=document.querySelector('.order-card input[type=\"checkbox\"]'),b=Array.from(document.querySelectorAll('.order-card button')).find(x=>x.textContent.includes('Confirmar entrega'));if(!p||!paid||!b)return false;p.value="+JSON.stringify(invalidPin)+";paid.checked=true;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.pinFailures===1",'bad P13 PIN recorded');
 assert.equal((await demoState()).orders.at(-1).status,'ARRIVING','bad PIN must leave P13 undelivered');
 // Exercise a synthetic encrypted receipt on the SAME P13 order and mobile UI,
 // first with the network truly offline; never call a commercial backend.
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Entregador (simulação)'));if(!b)return false;b.click();return true})()");
 await wait("document.querySelector('.tamao-demo-dialog[data-open=\"true\"]')?.textContent.includes("+JSON.stringify(gas.id)+")",'P13 driver panel');
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await wait("document.getElementById('tamao-demo-offline-save')&&!document.querySelector('.tamao-demo-panel button')?.textContent.includes('Concluir entrega simulada')",'driver offline-only save action',5500);
 await click("(()=>{const p=document.getElementById('tamao-demo-driver-pin'),paid=document.getElementById('tamao-demo-driver-paid'),b=document.getElementById('tamao-demo-offline-save');if(!p||!paid||!b)return false;p.value="+JSON.stringify(gas.pin)+";paid.checked=true;b.click();return true})()");
 await wait("document.getElementById('tamao-demo-offline-status')?.textContent.includes('criptografado neste aparelho')",'encrypted local receipt',12000);
 assert.equal((await demoState()).orders.at(-1).status,'ARRIVING','offline receipt must not settle order');
 assert.equal(await evaluate("(async()=>{const db=await new Promise((ok,bad)=>{const r=indexedDB.open('tamao-demo-local-delivery-v1');r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const proof=await new Promise((ok,bad)=>{const r=db.transaction('proofs','readonly').objectStore('proofs').get("+JSON.stringify(gas.id)+");r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});db.close();return !!proof&&proof.key?.extractable===false&&proof.ciphertext.length>20&&!JSON.stringify(proof).includes("+JSON.stringify(gas.pin)+")})()"),
   true,'IndexedDB must store opaque ciphertext and nonextractable key, not a plaintext PIN');
 await snapshot('09-entregador-gas-comprovante-pendente-offline.png');
 assert.deepEqual(forbidden,[],'offline receipt must never contact PSP or commercial API');
 await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:1000000,uploadThroughput:1000000});
 // Reload on a networked connection verifies actual durable IndexedDB storage,
 // not merely a JS variable in the same renderer.
 await send('Page.navigate',{url:base+'#home'});
 await wait("window.ChamaTest?.getState?.()?.orders?.at(-1)?.status==='ARRIVING'",'P13 order still pending after reload');
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Entregador (simulação)'));if(!b)return false;b.click();return true})()");
 await wait("!!document.getElementById('tamao-demo-offline-replay')",'local receipt survives reload',12000);
 assert.equal((await demoState()).orders.at(-1).status,'ARRIVING','proof not applied automatically on reload');
 await click("(()=>{const b=document.getElementById('tamao-demo-offline-replay');if(!b)return false;b.click();return true})()");
 await wait("window.ChamaTest.getState().orders.at(-1)?.status==='SETTLED'&&document.getElementById('tamao-demo-offline-status')?.textContent.includes('Concluído apenas no simulador')",'P13 delivery simulated after explicit manual replay',12000);
 assert.equal(await evaluate("new Promise((ok,bad)=>{const r=indexedDB.open('tamao-demo-local-delivery-v1');r.onsuccess=()=>{const db=r.result;const q=db.transaction('proofs','readonly').objectStore('proofs').get("+JSON.stringify(gas.id)+");q.onsuccess=()=>{ok(q.result===undefined);db.close()};q.onerror=()=>bad(q.error)};r.onerror=()=>bad(r.error)})"),
   true,'receipt must be removed only after simulated completion');
 await click("(()=>{const b=Array.from(document.querySelectorAll('#tamao-demo-browser-banner button')).find(x=>x.textContent.includes('Admin (resumo)'));if(!b)return false;b.click();return true})()");
 await wait("document.querySelector('.tamao-demo-dialog[data-open=\"true\"]')?.innerText.includes('Concluídos: 2')&&document.querySelector('.tamao-demo-dialog')?.textContent.includes("+JSON.stringify(gas.id)+")&&document.querySelector('.tamao-demo-dialog')?.textContent.includes("+JSON.stringify(o.id)+")",'Admin compares settled water and P13 orders');
 await snapshot('08-admin-gas-p13-e-agua-concluidos.png');
 await send('Page.navigate',{url:base+'#home'});
 await wait("window.ChamaTest?.getState?.()?.orders?.at(-1)?.status==='SETTLED'",'P13 survives reload');
 assert.equal((await demoState()).orders.length,2);
 assert.deepEqual(forbidden,[],'P13 demo must never contact the production backend or PSP');
 console.log('PASS: hosted demo mobile Chrome WATER20 + P13 synthetic orders, two completed Admin entries, incorrect PIN and unpaid delivery rejected, reload persisted, zero production API/PSP.');
}finally{
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closing'))}
 ws?.close();
 try{if(chrome.pid)process.kill(-chrome.pid,'SIGTERM')}catch{chrome.kill('SIGTERM')}
 await delay(500);
 try{if(chrome.pid)process.kill(-chrome.pid,'SIGKILL')}catch{}
 fs.rmSync(profile,{recursive:true,force:true,maxRetries:6,retryDelay:120});
}
