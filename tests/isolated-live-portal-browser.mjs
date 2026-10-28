import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';

// Browser exercise of EXISTING frontend code, pointed to localhost ONLY.
// No production source, config, portal bundle or database is changed.
export async function verifyIsolatedLivePortals({api,anon,buyer,owner,adminActor,orderId,merchantId,captureEvidence=false,recentClosedOrderId=null,exerciseCrossSessionDispatch=false,browserCheckoutBuyer=null}){
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
 const chrome=spawn(which,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',detached:true});
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
  let target,browserDebugPort;
  // Chrome allocates its own localhost CDP port. A fixed port can collide
  // with another browser and creates intermittent CI startup failures.
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let n=0;n<160;n++){
   try{
    const port=Number(fs.readFileSync(portFile,'utf8').trim().split(/\s+/)[0]);
    if(Number.isSafeInteger(port)&&port>0&&port<65536){
     const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list',
       {signal:AbortSignal.timeout(1100)})).json();
     target=pages.find(p=>p.type==='page'&&p.webSocketDebuggerUrl);
     if(target){browserDebugPort=port;break;}
    }
   }catch{}
   if(chrome.exitCode!==null||chrome.signalCode!==null)break;
   await sleep(250);
  }
  assert.ok(target,'Chrome CDP unavailable; browser exit='+chrome.exitCode+' signal='+chrome.signalCode);
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
  const desktopViewport={width:1280,height:960,deviceScaleFactor:1,mobile:false};
  await send('Emulation.setDeviceMetricsOverride',desktopViewport);
  const evidenceDir=path.resolve('test-results/isolated-order-evidence');
  async function saveEvidence(name){
    if(!captureEvidence)return;
    assert.match(name,/^[a-z0-9-]+$/,'evidence name must be static and safe');
    const result=await send('Page.captureScreenshot',{
      format:'png',fromSurface:true,captureBeyondViewport:false
    });
    const png=Buffer.from(result.data||'','base64');
    assert.ok(png.length>6000,'real Chrome screenshot should not be blank');
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a','evidence must be PNG');
    fs.mkdirSync(evidenceDir,{recursive:true});
    fs.writeFileSync(path.join(evidenceDir,name+'.png'),png);
  }

  // Chrome's separate off-the-record BrowserContexts are genuinely isolated
  // (cookies, localStorage and sessionStorage). Unlike changing credentials in
  // a single tab, these can stay open simultaneously against ONE real local DB.
  async function verifyIndependentContexts(){
    assert.ok(Number.isInteger(browserDebugPort)&&browserDebugPort>0);
    const browserInfo=await(await fetch('http://127.0.0.1:'+browserDebugPort+'/json/version',
      {signal:AbortSignal.timeout(5000)})).json();
    assert.ok(browserInfo.webSocketDebuggerUrl,'Chrome browser endpoint missing');
    const contexts=[],pages=[];
    async function connect(url){
      const socket=new WebSocket(url),waiting=new Map();let counter=0;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Isolated CDP socket timeout')),10000);
        socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
        socket.addEventListener('error',reject,{once:true});
      });
      socket.addEventListener('message',event=>{
        const msg=JSON.parse(String(event.data));
        if(msg.method==='Network.requestWillBeSent'&&/\.supabase\.co/i.test(msg.params?.request?.url||''))
          violations.push('Independent Chrome context attempted commercial Supabase');
        if(msg.id&&waiting.has(msg.id)){
          const p=waiting.get(msg.id);clearTimeout(p.timer);waiting.delete(msg.id);
          if(msg.error)p.reject(Error(JSON.stringify(msg.error)));else p.resolve(msg.result);
        }
      });
      const sendIsolated=(method,params={})=>new Promise((resolve,reject)=>{
        const id=++counter;
        const timer=setTimeout(()=>{waiting.delete(id);reject(Error('Isolated CDP timeout '+method))},15000);
        waiting.set(id,{resolve,reject,timer});
        socket.send(JSON.stringify({id,method,params}));
      });
      const evaluateIsolated=async expression=>{
        const r=await sendIsolated('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
        if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
        return r.result?.value;
      };
      const waitIsolated=async(expression,label,limit=48000)=>{
        const until=Date.now()+limit;
        while(Date.now()<until){
          try{if(await evaluateIsolated(expression))return}catch{}
          await sleep(250);
        }
        const diag=await evaluateIsolated("JSON.stringify({text:document.body.innerText.slice(0,180),status:typeof merchantRuntime==='undefined'?null:merchantRuntime.status,customer:typeof liveRuntime==='undefined'?null:liveRuntime.status,admin:typeof adminRuntime==='undefined'?null:adminRuntime.status})").catch(e=>String(e));
        throw Error('Independent browser failed '+label+': '+diag);
      };
      return {socket,send:sendIsolated,evaluate:evaluateIsolated,wait:waitIsolated,
        navigate:async url=>{
          await sendIsolated('Page.navigate',{url});
          await waitIsolated("document.readyState==='complete'&&!!document.querySelector('#app')",'page loaded',20000);
        },close:()=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(Error('CDP cleanup'))}waiting.clear();socket.close()}};
    }
    const browser=await connect(browserInfo.webSocketDebuggerUrl);
    try{
      async function openRole(role,session,url,{trackExisting=true}={}){
        const {browserContextId}=await browser.send('Target.createBrowserContext',{disposeOnDetach:true});
        assert.ok(browserContextId);
        contexts.push(browserContextId);
        const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
        let endpoint;
        for(let n=0;n<80;n++){
          const list=await(await fetch('http://127.0.0.1:'+browserDebugPort+'/json/list',
            {signal:AbortSignal.timeout(3000)})).json();
          endpoint=list.find(x=>x.id===targetId&&x.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
          if(endpoint)break;
          await sleep(150);
        }
        assert.ok(endpoint,'Independent Chrome target missing for '+role);
        const page=await connect(endpoint);pages.push(page);
        await page.send('Page.enable');
        await page.send('Runtime.enable');
        await page.send('Network.enable');
        await page.send('Emulation.setDeviceMetricsOverride',desktopViewport);
        const parts=["(()=>{if(location.origin!=="+JSON.stringify(origin)+")return;"];
        if(role==='customer'){
          parts.push("localStorage.setItem('chama-sg-customer-auth-v2',"+JSON.stringify(JSON.stringify(session))+");");
          if(trackExisting)parts.push("localStorage.setItem('chama-live-order-id-v1',"+JSON.stringify(orderId)+");");
        }else{
          const key=role==='merchant'?'chama-sg-merchant-auth-v1':'chama-sg-admin-auth-v1';
          parts.push("sessionStorage.setItem("+JSON.stringify(key)+","+JSON.stringify(JSON.stringify(session))+");");
          if(role==='admin')parts.push("sessionStorage.setItem('tamao-admin-section','orders');");
        }
        parts.push("})();");
        await page.send('Page.addScriptToEvaluateOnNewDocument',{source:parts.join('')});
        await page.navigate(origin+url);
        // Only this role's authentication exists in its isolated context.
        const auth=JSON.parse(await page.evaluate("JSON.stringify({customer:!!localStorage.getItem('chama-sg-customer-auth-v2'),merchant:!!sessionStorage.getItem('chama-sg-merchant-auth-v1'),admin:!!sessionStorage.getItem('chama-sg-admin-auth-v1')})"));
        assert.deepEqual(auth,{customer:role==='customer',merchant:role==='merchant',admin:role==='admin'},
          'Credential leakage across independent '+role+' browser context');
        return page;
      }
      const merchantPage=await openRole('merchant',owner.session,'/?merchant=1#merchant');
      await merchantPage.wait("typeof merchantRuntime!=='undefined'&&merchantRuntime.status==='ready'&&merchantRuntime.orders.some(o=>o.orderId==="+JSON.stringify(orderId)+")",'merchant sees canonical order');
      const buyerPage=await openRole('customer',buyer.session,'/#tracking');
      await buyerPage.wait("typeof liveRuntime!=='undefined'&&liveRuntime.status==='ready'&&liveRuntime.order?.orderId==="+JSON.stringify(orderId),'buyer sees canonical order');
      const adminPage=await openRole('admin',adminActor.session,'/?admin=1#admin');
      await adminPage.wait("typeof adminRuntime!=='undefined'&&adminRuntime.status==='ready'&&adminRuntime.data?.controlOrders?.some(o=>o.id==="+JSON.stringify(orderId)+")",'Admin sees canonical order',55000);
      const code=await merchantPage.evaluate("merchantRuntime.orders.find(o=>o.orderId==="+JSON.stringify(orderId)+")?.publicCode");
      assert.ok(typeof code==='string'&&code.length>3);
      assert.equal(await adminPage.evaluate("adminRuntime.data.controlOrders.find(o=>o.id==="+JSON.stringify(orderId)+")?.public_code"),code,
        'separate Admin browser must show merchant order public code');
      assert.ok((await buyerPage.evaluate("document.querySelector('#app')?.innerText||''")).length>110);
      if(captureEvidence){
        for(const [page,name] of [[merchantPage,'06-parceiro-sessao-independente'],
          [buyerPage,'07-cliente-sessao-independente'],
          [adminPage,'08-admin-sessao-independente']]){
          const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          const png=Buffer.from(shot.data||'','base64');
          assert.ok(png.length>6000&&png.subarray(0,8).toString('hex')==='89504e470d0a1a0a');
          fs.writeFileSync(path.join(evidenceDir,name+'.png'),png);
        }
        fs.appendFileSync(path.join(evidenceDir,'LEIA-ME.txt'),
          '\\n06-08: Tres contextos Chrome incognitos independentes; Auth isolado, mesmo pedido SQL temporario.\\n'+
          'NAO sao tres dominios publicos nem uma demonstracao com backend persistente.\\n');
      }
      if(exerciseCrossSessionDispatch){
        const didClick=await merchantPage.evaluate("(()=>{const card=document.getElementById('merchant-order-card-'+"
          +JSON.stringify(orderId)+");const button=Array.from(card?.querySelectorAll('button')||[]).find(b=>b.textContent.includes('Confirmar saída')&&!b.disabled);if(!button)return false;button.click();return true})()");
        assert.equal(didClick,true,'independent partner must click real dispatch button');
        await merchantPage.wait("merchantRuntime.status==='ready'&&merchantRuntime.orders.some(o=>o.orderId==="
          +JSON.stringify(orderId)+"&&o.status==='OUT_FOR_DELIVERY')",'real merchant dispatch confirmed',50000);
        await buyerPage.navigate(origin+'/#tracking');
        await buyerPage.wait("liveRuntime.status==='ready'&&liveRuntime.order?.orderId==="
          +JSON.stringify(orderId)+"&&liveRuntime.order.status==='OUT_FOR_DELIVERY'",
          'separate buyer sees merchant dispatch',45000);
        await adminPage.navigate(origin+'/?admin=1#admin');
        await adminPage.wait("adminRuntime.status==='ready'&&adminRuntime.data?.controlOrders?.some(o=>o.id==="
          +JSON.stringify(orderId)+"&&o.status==='OUT_FOR_DELIVERY')",
          'separate Admin sees merchant dispatch',50000);
        assert.ok(await merchantPage.evaluate("!!document.querySelector('#merchant-order-card-'+"
          +JSON.stringify(orderId)+")?.innerText.includes('A caminho')||merchantRuntime.orders.some(o=>o.orderId==="
          +JSON.stringify(orderId)+"&&o.status==='OUT_FOR_DELIVERY')"),
          'partner must have the updated delivery state');
      }

      if(browserCheckoutBuyer){
        assert.equal(exerciseCrossSessionDispatch,true,'run browser checkout after independent dispatch');
        const ui=await openRole('customer',browserCheckoutBuyer.session,'/#home',{trackExisting:false});
        await ui.wait("liveRuntime.status==='ready'&&liveRuntime.session?.user?.id==="+JSON.stringify(browserCheckoutBuyer.id),'synthetic buyer ready');
        assert.equal(await ui.evaluate("!localStorage.getItem('chama-live-order-id-v1')"),true,'browser buyer must have a clean cart/order');
        // The real public product-first home uses an explicit Água tile;
        // do not assert an optional secondary browse CTA from another layout.
        const selectedWater=await ui.evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.getAttribute('onclick')?.includes(\"homeChooseProduct('WATER20')\")&&!x.hidden&&!x.closest('[hidden]'));if(!b)return false;b.click();return true})()");
        assert.equal(selectedWater,true,'public home must show Água 20 L product-first CTA');
        await ui.wait("route()==='order'&&state.cart?.WATER20===1&&!!document.getElementById('buyer-cart-catalog')",
          'home Água product tile must open the water-only checkout');
        const addressEntered=await ui.evaluate("(()=>{const p=document.getElementById('postal-code'),n=document.getElementById('address-number');if(!p||!n)return false;p.value='97300-000';p.dispatchEvent(new Event('input',{bubbles:true}));n.value='10';n.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
        assert.equal(addressEntered,true,'CEP and number input fields must be rendered');
        await ui.wait("state.postalCode==='97300000'&&state.addressNumber==='10'",'address input handlers');
        await ui.wait("!!state.address&&!!document.getElementById('payment-method')",
          'canonical postal validation provides real address',55000);
        const choseCash=await ui.evaluate("(()=>{const s=document.getElementById('payment-method');if(!s)return false;s.value='cash';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
        assert.equal(choseCash,true,'cash on delivery form must exist');
        await ui.wait("state.checkout.paymentMethod==='cash'&&liveRuntime.offers?.length>0&&!!document.querySelector('.offer-submit:not([disabled])')",
          'real get-offers quote must be actionable',55000);
        const offer=JSON.parse(await ui.evaluate("JSON.stringify({offers:liveRuntime.offers,visible:document.querySelector('#customer-offers')?.innerText.slice(0,1200)})"));
        assert.ok(offer.offers?.[0]?.quoteId,'UI must use a real SQL quote ID');
        assert.match(offer.visible,/TOTAL COM ENTREGA/i,'offer must display total plus delivery');
        if(browserCheckoutBuyer){
          fs.mkdirSync(evidenceDir,{recursive:true});
          await ui.evaluate("document.querySelector('#customer-offers')?.scrollIntoView({block:'start'});true");
          const shot=await ui.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          const png=Buffer.from(shot.data||'','base64');assert.ok(png.length>6000);
          fs.writeFileSync(path.join(evidenceDir,'09-cliente-cotacao-real-ui.png'),png);
        }
        const phone=await ui.evaluate("(()=>{const i=document.getElementById('delivery-phone');if(!i)return false;i.value='11999999999';i.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
        assert.equal(phone,true,'customer contact must be shown after address');
        const submit=await ui.evaluate("(()=>{const b=document.querySelector('.offer-submit:not([disabled])');if(!b)return false;b.click();return true})()");
        assert.equal(submit,true,'visible checkout submit must be active');
        await ui.wait("route()==='tracking'&&liveRuntime.order?.status==='OFFERED_TO_MERCHANT'",
          'browser checkout submitted through actual UI',55000);
        const created=JSON.parse(await ui.evaluate("JSON.stringify({id:liveRuntime.order?.orderId,status:liveRuntime.order?.status,cart:state.cart,visible:document.querySelector('#app')?.innerText.slice(0,900)})"));
        assert.match(created.id,/^[a-f0-9]{8}-[a-f0-9-]{27}$/i);
        assert.equal(created.status,'OFFERED_TO_MERCHANT');
        assert.equal(Number(created.cart?.WATER20||0),0,'basket cleared only after confirmed checkout');
        assert.match(created.visible,/pedido/i);
        if(browserCheckoutBuyer){
          const shot=await ui.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          const png=Buffer.from(shot.data||'','base64');assert.ok(png.length>6000);
          fs.writeFileSync(path.join(evidenceDir,'10-cliente-pedido-enviado-ui.png'),png);
          fs.appendFileSync(path.join(evidenceDir,'LEIA-ME.txt'),
            '\n09-10: Comprador sintetico faz Home -> Agua -> CEP -> Cotacao -> Pedido -> Rastreio; localhost descartavel.\n');
        }
        await merchantPage.navigate(origin+'/?merchant=1#merchant');
        await merchantPage.wait("merchantRuntime.status==='ready'&&merchantRuntime.orders.some(o=>o.orderId==="+JSON.stringify(created.id)+")",'partner sees new UI order',50000);
        await adminPage.navigate(origin+'/?admin=1#admin');
        await adminPage.wait("adminRuntime.status==='ready'&&adminRuntime.data?.controlOrders?.some(o=>o.id==="+JSON.stringify(created.id)+")",'Admin sees new UI order',50000);
        console.log('PASS: real home CTA -> water cart -> address -> cash quote -> order submitted -> tracking; partner/Admin share new SQL ID.');
      }
      assert.deepEqual(violations,[],'no independent tab may call commercial Supabase');
      console.log('PASS: three simultaneously isolated Chrome Auth contexts share one disposable SQL order'
        +(exerciseCrossSessionDispatch?' and observe a real partner DOM dispatch in buyer/Admin':'')+'.');
    }finally{
      for(const page of pages)page.close();
      for(const context of contexts.reverse()){
        try{await browser.send('Target.disposeBrowserContext',{browserContextId:context})}catch{}
      }
      browser.close();
    }
  }

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
  if(recentClosedOrderId){
    const closed=JSON.parse(await evaluate("JSON.stringify({rows:merchantRuntime.merchant?.recentClosedOrders,visible:document.querySelector('.merchant-recent-closed-orders')?.innerText||''})"));
    const match=closed.rows?.find(o=>o.orderId===recentClosedOrderId);
    assert.equal(match?.status,'SETTLED','partner history must retain the completed P13');
    assert.match(closed.visible,/Últimos pedidos encerrados/);
    assert.ok(closed.visible.includes(match.publicCode),'closed order must be visible in partner UI');
    assert.ok(!Object.hasOwn(match,'customerPhone')&&!Object.hasOwn(match,'address'),
      'closed history must exclude buyer contact fields');
  }
  if(captureEvidence)await evaluate("document.querySelector('#merchant-live-orders')?.scrollIntoView({block:'start'});true");
  await saveEvidence('01-parceiro-p13-em-preparo');
  await navigate(origin+'/#tracking');
  await wait("typeof liveRuntime!=='undefined'&&liveRuntime.status==='ready'&&liveRuntime.order?.orderId==="+JSON.stringify(orderId),'buyer tracking');
  const buyerState=JSON.parse(await evaluate("JSON.stringify({status:liveRuntime.status,orderId:liveRuntime.order?.orderId,visible:document.querySelector('#app')?.innerText.slice(0,4000)})"));
  assert.equal(buyerState.status,'ready');assert.equal(buyerState.orderId,orderId);
  assert.ok(buyerState.visible.length>110,'buyer must see a useful rendered tracking screen');
  await saveEvidence('02-cliente-p13-rastreamento-desktop');
  if(captureEvidence){
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('window.scrollTo(0,0);true');
    await saveEvidence('03-cliente-p13-rastreamento-celular');
    await send('Emulation.setDeviceMetricsOverride',desktopViewport);
  }

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
  const orderCardVisible=await evaluate("Array.from(document.querySelectorAll('.order-card .order-id')).some(el=>el.textContent.trim()===(adminRuntime.data?.controlOrders?.find(o=>o.id==="+JSON.stringify(orderId)+")?.public_code||''))");
  assert.equal(orderCardVisible,true,'the actual Admin orders UI must render this local order card');
  assert.ok(adminReadStatuses.includes(200),'Chrome must receive a successful canonical admin-ops summary');
  assert.ok(adminView.visible.length>110,'Admin portal must render useful content');
  if(captureEvidence)await evaluate("(()=>{const id=adminRuntime.data?.controlOrders?.find(o=>o.id==="+JSON.stringify(orderId)+")?.public_code;Array.from(document.querySelectorAll('.order-card')).find(el=>el.querySelector('.order-id')?.textContent.trim()===id)?.scrollIntoView({block:'start'});return true})()");
  await saveEvidence('04-admin-p13-torre-de-controle');
  // Exercise the real Admin Chrome DOM across all three synthetic
  // perspectives. This remains localhost-only and cannot create a real order.
  const createDemo=await evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Criar 3 pedidos fictícios'));if(!b)return false;b.click();return true})()");
  assert.equal(createDemo,true,'superadmin must see the safe test-order action');
  await wait("document.querySelectorAll('[data-demo-only=\"true\"]').length===3",'three demonstration order cards',15000);
  const clickDemoRole=label=>evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==="+JSON.stringify(label)+");if(!b)return false;b.click();return true})()");
  const demoCardExpression=id=>"Array.from(document.querySelectorAll('[data-demo-only=\"true\"]')).find(x=>x.querySelector('.order-id')?.textContent.includes("+JSON.stringify(id)+"))";
  const demoStatus=id=>evaluate("(()=>{const c="+demoCardExpression(id)+";return c?.getAttribute('data-demo-status')||null})()");
  const demoText=id=>evaluate("(()=>{const c="+demoCardExpression(id)+";return c?.innerText||''})()");
  const clickDemoAction=(id,label)=>evaluate("(()=>{const c="+demoCardExpression(id)+";const b=Array.from(c?.querySelectorAll('button')||[]).find(x=>x.textContent.includes("+JSON.stringify(label)+"));if(!b)return false;b.click();return true})()");
  assert.equal(await demoStatus('DEMO-001'),'OFFERED_TO_MERCHANT');
  assert.equal(await clickDemoRole('Revenda fictícia'),true);
  assert.equal(await clickDemoAction('DEMO-001','Aceitar pedido'),true);
  assert.equal(await demoStatus('DEMO-001'),'PREPARING');
  assert.equal(await clickDemoAction('DEMO-001','Saiu para entrega'),true);
  assert.equal(await demoStatus('DEMO-001'),'OUT_FOR_DELIVERY');
  assert.equal(await clickDemoAction('DEMO-001','Chegando ao cliente'),true);
  assert.equal(await demoStatus('DEMO-001'),'ARRIVING');
  assert.doesNotMatch(await demoText('DEMO-001'),/Código de entrega fictício \(só na visão Cliente\)/,
    'merchant perspective must not reveal the customer PIN');
  assert.equal(await clickDemoRole('Cliente fictício'),true);
  const customerPin=await evaluate("(()=>{const c="+demoCardExpression('DEMO-001')+";return c?.innerText.match(/Código de entrega fictício[^\\n]*?(\\d{4})/)?.[1]||''})()");
  assert.match(customerPin,/^\d{4}$/,'the real Chrome customer perspective must show a 4-digit demo PIN');
  assert.equal(await clickDemoRole('Revenda fictícia'),true);
  const setDemoPayment=pin=>evaluate("(()=>{const p=document.getElementById('admin-order-demo-pin-DEMO-001');const paid=document.getElementById('admin-order-demo-paid-DEMO-001');if(!p||!paid)return false;p.value="+JSON.stringify(pin)+";paid.checked=true;return true})()");
  assert.equal(await setDemoPayment('0000'),true);
  assert.equal(await clickDemoAction('DEMO-001','Confirmar entrega fictícia'),true);
  assert.equal(await demoStatus('DEMO-001'),'ARRIVING','wrong PIN must never settle the simulated order');
  assert.match(await demoText('DEMO-001'),/PIN fictício incorreto/);
  assert.equal(await setDemoPayment(customerPin),true);
  assert.equal(await clickDemoAction('DEMO-001','Confirmar entrega fictícia'),true);
  assert.equal(await demoStatus('DEMO-001'),'SETTLED');
  assert.match(await demoText('DEMO-001'),/Demonstração concluída/);

  // Reload the EXISTING Admin, not a parallel demo page; session-scoped
  // synthetic state must survive, without creating a commercial DB row.
  await navigate(origin+'/?admin=1#admin');
  await wait("typeof adminRuntime!=='undefined'&&adminRuntime.status==='ready'&&document.querySelectorAll('[data-demo-only=\"true\"]').length===3",
    'demo restored after Admin reload',40000);
  assert.equal(await demoStatus('DEMO-001'),'SETTLED','the same fictitious order must remain settled after reload');
  assert.equal(await clickDemoRole('Cliente fictício'),true);
  assert.equal(await clickDemoAction('DEMO-002','Cancelar pedido fictício'),true);
  assert.equal(await demoStatus('DEMO-002'),'CANCELLED');
  assert.equal(await clickDemoRole('Revenda fictícia'),true);
  assert.equal(await clickDemoAction('DEMO-002','Aceitar pedido'),false,
    'revenda cannot accept an order cancelled by the fictitious customer');
  assert.equal(await demoStatus('DEMO-002'),'CANCELLED');
  assert.equal(await clickDemoRole('Admin — acompanhamento'),true);
  assert.equal(await demoStatus('DEMO-001'),'SETTLED');
  assert.equal(await demoStatus('DEMO-002'),'CANCELLED');
  if(captureEvidence){
    await evaluate("document.querySelector('[aria-label=\"Pedidos de demonstração sem operações reais\"]')?.scrollIntoView({block:'start'});true");
    await saveEvidence('05-admin-simulacao-visual-separada');
    fs.writeFileSync(path.join(evidenceDir,'LEIA-ME.txt'),[
      'TAMAO - EVIDENCIA DE PEDIDOS SINTETICOS / APENAS CI LOCAL',
      'Origem: teste Chrome com Auth, Postgres e Edge descartaveis em 127.0.0.1.',
      '01: Portal Parceiro real em rota localhost, pedido P13 PREPARING.',
      '02 e 03: Portal Cliente real em rota localhost, mesmo P13 em desktop/celular.',
      '04: Portal Admin real em rota localhost, Torre de Controle do mesmo P13.',
      '05: Simulador VISUAL interno do Admin (nao e pedido SQL).',
      'Nao e prova de funcionamento independente em tres dominios publicados.',
      'Nao ha compra, pagamento, Pix, CNPJ, ANP real ou fornecedor real.',
      'NUNCA usar estas imagens para anunciar estoque ou oferta comercial.',
      'Artefato temporario para revisao humana; nao contem credenciais nem tokens.',
      '06-08: Tres sessoes reais isoladas em contextos incognitos do Chrome, mesmo pedido SQL temporario.'
    ].join('\n')+'\n','utf8');
  }

  // Click the EXISTING Tower of Control button, retaining the canonical
  // adminPerform -> admin-ops -> admin_order_control_action transaction.
  const didClickNote=await evaluate("(()=>{const card=Array.from(document.querySelectorAll('.order-card')).find(x=>x.querySelector('.order-id')?.textContent.trim()===(adminRuntime.data?.controlOrders?.find(o=>o.id==="+JSON.stringify(orderId)+")?.public_code||''));const btn=Array.from(card?.querySelectorAll('button')||[]).find(x=>x.textContent.includes('Registrar observação'));if(!btn)return false;window.prompt=()=> 'Observacao de teste CI sem dados reais';btn.click();return true})()");
  assert.equal(didClickNote,true,'the Admin note must be submitted from the actual order card button');
  await wait("adminRuntime.status==='ready'&&adminRuntime.actionPending===false&&adminRuntime.data?.recentAudit?.some(x=>x.action==='order-control-note'&&x.target_id==="+JSON.stringify(orderId)+")",
    'Admin button must persist its audited note',50000);
  await verifyIndependentContexts();
  assert.deepEqual(violations,[],'browser must never contact production Supabase');
  console.log('PASS: real Chrome buyer, merchant and authorized Admin read the SAME localhost order; unauthorized buyer denied merchant and Admin; no remote backend requests.');
 }finally{
  if(ws){for(const [,p] of pending){clearTimeout(p.timer);p.reject(Error('Browser cleanup'))}ws.close()}
  // Chrome launches helper processes that can recreate profile files even
  // after the parent exits. Terminate this disposable process group first.
  try{if(chrome.pid)process.kill(-chrome.pid,'SIGTERM')}catch{chrome.kill('SIGTERM')}
  await new Promise(done=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return done();chrome.once('exit',done);setTimeout(done,2000).unref()});
  try{if(chrome.pid)process.kill(-chrome.pid,'SIGKILL')}catch{}
  await sleep(450);
  await new Promise(done=>server.close(done));
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:12,retryDelay:250});
 }
}
