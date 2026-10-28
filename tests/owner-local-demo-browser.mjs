import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';

// Browser smoke of the OWNER'S three localhost portals, not a test of HTML
// returned by fetch. The application scripts and server APIs run for real.
export async function verifyOwnerLocalDemoBrowser({roles,customerId}){
  assert.equal(process.env.CI,'true');
  assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
  const canonical=[
    'http://127.0.0.1:4179/#home',
    'http://127.0.0.1:4180/?merchant=1#merchant',
    'http://127.0.0.1:4181/?admin=1#admin'
  ];
  assert.deepEqual(roles.map(x=>x.url),canonical);
  const chromeCmd=execFileSync('sh',['-c','command -v google-chrome || command -v chromium || command -v chromium-browser'],
    {encoding:'utf8'}).trim();
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-owner-browser-'));
  const chrome=spawn(chromeCmd,['--headless=new','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
    '--remote-allow-origins=*','--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],
    {stdio:'ignore',detached:true});
  const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
  const forbidden=[],pages=[],contexts=[];
  let browser=null;
  function connect(url){
    const ws=new WebSocket(url),pending=new Map();let serial=0;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Chrome CDP not ready')),12000);
      ws.addEventListener('open',()=>{
        clearTimeout(timer);
        ws.addEventListener('message',event=>{
          const msg=JSON.parse(String(event.data));
          if(msg.method==='Network.requestWillBeSent'&&/\.supabase\.co/i.test(msg.params?.request?.url||''))
            forbidden.push('Chrome tried to contact commercial Supabase');
          if(msg.id&&pending.has(msg.id)){
            const p=pending.get(msg.id);pending.delete(msg.id);clearTimeout(p.timer);
            if(msg.error)p.reject(Error(JSON.stringify(msg.error)));else p.resolve(msg.result);
          }
        });
        const send=(method,params={})=>new Promise((done,fail)=>{
          const id=++serial;
          const t=setTimeout(()=>{pending.delete(id);fail(Error('CDP timeout '+method))},17000);
          pending.set(id,{resolve:done,reject:fail,timer:t});
          ws.send(JSON.stringify({id,method,params}));
        });
        const evaluate=async expression=>{
          const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
          if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
          return r.result?.value;
        };
        const wait=async (expression,label,ms=40000)=>{
          const until=Date.now()+ms;
          while(Date.now()<until){
            try{if(await evaluate(expression))return}catch{}
            await pause(250);
          }
          const state=await evaluate("JSON.stringify({route:location.href,text:document.body.innerText.slice(0,180),customer:typeof liveRuntime==='undefined'?null:{status:liveRuntime.status,error:liveRuntime.error},merchant:typeof merchantRuntime==='undefined'?null:{status:merchantRuntime.status,error:merchantRuntime.error},admin:typeof adminRuntime==='undefined'?null:{status:adminRuntime.status,error:adminRuntime.error}})").catch(e=>String(e));
          throw Error('OWNER PORTAL '+label+' FAILED: '+state);
        };
        resolve({send,evaluate,wait,close(){
          for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP shutdown'))}
          ws.close();
        }});
      },{once:true});
      ws.addEventListener('error',reject,{once:true});
    });
  }
  try{
    let port=null;
    for(let i=0;i<160;i++){
      try{
        const raw=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8');
        const p=Number(raw.trim().split(/\s+/)[0]);
        if(Number.isInteger(p)&&p>0){port=p;break}
      }catch{}
      if(chrome.exitCode!==null||chrome.signalCode!==null)break;
      await pause(250);
    }
    assert.ok(port,'Chrome must start with loopback-only debugger');
    const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();
    browser=await connect(version.webSocketDebuggerUrl);
    async function openRole(name,url){
      const {browserContextId}=await browser.send('Target.createBrowserContext',{disposeOnDetach:true});
      contexts.push(browserContextId);
      const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
      let endpoint;
      for(let i=0;i<75;i++){
        const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
        endpoint=list.find(x=>x.id===targetId)?.webSocketDebuggerUrl;
        if(endpoint)break;
        await pause(150);
      }
      assert.ok(endpoint,'Chrome target needed for '+name);
      const page=await connect(endpoint);pages.push(page);
      await page.send('Page.enable');await page.send('Runtime.enable');
      await page.send('Network.enable');
      await page.send('Emulation.setDeviceMetricsOverride',{
        width:1280,height:900,deviceScaleFactor:1,mobile:false});
      await page.send('Page.navigate',{url});
      await page.wait("document.readyState==='complete'&&!!document.querySelector('#app')",name+' page load',19000);
      return page;
    }
    const buyer=await openRole('customer',canonical[0]);
    await buyer.wait("typeof liveRuntime!=='undefined'&&liveRuntime.status==='ready'&&liveRuntime.session?.user?.id==="+JSON.stringify(customerId),'buyer Auth',52000);
    assert.ok(await buyer.evaluate("!!document.querySelector('#app')?.innerText.includes('TAMÃO')"));
    const merchant=await openRole('merchant',canonical[1]);
    await merchant.wait("typeof merchantRuntime!=='undefined'&&merchantRuntime.status==='ready'",'merchant Auth',52000);
    const admin=await openRole('admin',canonical[2]);
    await admin.wait("typeof adminRuntime!=='undefined'&&adminRuntime.status==='ready'&&Array.isArray(adminRuntime.data?.controlOrders)",'Admin Auth',52000);
    // A local SQL fixture intentionally has commerce_enabled=true so the
    // real checkout works. Every human-facing role MUST display the clear
    // synthetic-data banner, otherwise LIVE badges could mislead the owner.
    for(const [name,page] of [['cliente',buyer],['revenda',merchant],['admin',admin]]){
      const ribbon=await page.evaluate("(()=>{const el=document.getElementById('tamao-owner-demo-ribbon');if(!el)return null;const r=el.getBoundingClientRect();return {text:el.innerText,visible:r.height>20&&r.width>300}})()");
      assert.ok(ribbon?.visible,name+' needs a visible local demonstration label');
      assert.match(ribbon.text,/DEMONSTRAÇÃO LOCAL/);
      assert.match(ribbon.text,/DADOS FICTÍCIOS/);
      assert.match(ribbon.text,/NENHUMA VENDA, COBRANÇA OU PIX REAL/);
    }
    const contextsAuth=[
      await buyer.evaluate("JSON.stringify({customer:!!localStorage.getItem('chama-sg-customer-auth-v2'),merchant:!!sessionStorage.getItem('chama-sg-merchant-auth-v1'),admin:!!sessionStorage.getItem('chama-sg-admin-auth-v1')})"),
      await merchant.evaluate("JSON.stringify({customer:!!localStorage.getItem('chama-sg-customer-auth-v2'),merchant:!!sessionStorage.getItem('chama-sg-merchant-auth-v1'),admin:!!sessionStorage.getItem('chama-sg-admin-auth-v1')})"),
      await admin.evaluate("JSON.stringify({customer:!!localStorage.getItem('chama-sg-customer-auth-v2'),merchant:!!sessionStorage.getItem('chama-sg-merchant-auth-v1'),admin:!!sessionStorage.getItem('chama-sg-admin-auth-v1')})")
    ].map(JSON.parse);
    assert.deepEqual(contextsAuth,[
      {customer:true,merchant:false,admin:false},
      {customer:false,merchant:true,admin:false},
      {customer:false,merchant:false,admin:true}
    ],'real demo origins must keep all 3 Auth sessions separated');

    // New checkout from actual CUSTOMER DOM on :4179 (no SQL insert or fetch).
    const start=await buyer.evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.getAttribute('onclick')?.includes(\"homeChooseProduct('WATER20')\"));if(!b)return false;b.click();return true})()");
    assert.equal(start,true,'water home CTA missing on owner demo');
    await buyer.wait("route()==='order'&&state.cart?.WATER20===1",'owner demo basket');
    assert.equal(await buyer.evaluate("(()=>{const p=document.querySelector('#postal-code'),n=document.querySelector('#address-number');if(!p||!n)return false;p.value='97300-000';p.dispatchEvent(new Event('input',{bubbles:true}));n.value='10';n.dispatchEvent(new Event('input',{bubbles:true}));return true})()"),true);
    await buyer.wait("!!state.address&&!!document.querySelector('#payment-method')",'owner demo canonical CEP',52000);
    assert.equal(await buyer.evaluate("(()=>{const el=document.querySelector('#payment-method');if(!el)return false;el.value='cash';el.dispatchEvent(new Event('change',{bubbles:true}));return true})()"),true);
    await buyer.wait("state.checkout.paymentMethod==='cash'&&liveRuntime.offers?.length>0&&!!document.querySelector('.offer-submit:not([disabled])')",
      'owner demo real quote',55000);
    assert.equal(await buyer.evaluate("(()=>{const i=document.querySelector('#delivery-phone');if(!i)return false;i.value='11999999999';i.dispatchEvent(new Event('change',{bubbles:true}));return true})()"),true);
    assert.equal(await buyer.evaluate("(()=>{const b=document.querySelector('.offer-submit:not([disabled])');if(!b)return false;b.click();return true})()"),true);
    await buyer.wait("route()==='tracking'&&liveRuntime.order?.status==='OFFERED_TO_MERCHANT'",'owner demo checkout',55000);
    const orderId=await buyer.evaluate("liveRuntime.order?.orderId");
    assert.match(orderId,/^[a-f0-9]{8}-[a-f0-9-]{27}$/i);
    async function reload(page,url){
      await page.send('Page.navigate',{url});
      await page.wait("document.readyState==='complete'&&!!document.querySelector('#app')",'reloaded',19000);
    }
    await reload(merchant,canonical[1]);
    await merchant.wait("merchantRuntime.status==='ready'&&merchantRuntime.orders.some(o=>o.orderId==="+JSON.stringify(orderId)+")",'merchant sees browser order',52000);
    await reload(admin,canonical[2]);
    await admin.wait("adminRuntime.status==='ready'&&adminRuntime.data?.controlOrders?.some(o=>o.id==="+JSON.stringify(orderId)+")",'Admin sees browser order',52000);
    // Real ACCEPT button, preserving authenticated Edge action/idempotency.
    const accepted=await merchant.evaluate("(()=>{const c=document.getElementById('merchant-order-card-'+"
      +JSON.stringify(orderId)+");const b=Array.from(c?.querySelectorAll('button')||[]).find(x=>x.textContent.includes('Aceitar pedido')&&!x.disabled);if(!b)return false;b.click();return true})()");
    assert.equal(accepted,true,'merchant must be able to accept actual buyer order');
    await merchant.wait("merchantRuntime.status==='ready'&&merchantRuntime.orders.some(o=>o.orderId==="
      +JSON.stringify(orderId)+"&&o.status==='PREPARING')",'owner merchant accepts',55000);
    await reload(buyer,'http://127.0.0.1:4179/#tracking');
    await buyer.wait("liveRuntime.status==='ready'&&liveRuntime.order?.orderId==="
      +JSON.stringify(orderId)+"&&liveRuntime.order.status==='PREPARING'",'buyer sees acceptance',55000);
    await reload(admin,canonical[2]);
    await admin.wait("adminRuntime.status==='ready'&&adminRuntime.data?.controlOrders?.some(o=>o.id==="
      +JSON.stringify(orderId)+"&&o.status==='PREPARING')",'Admin sees acceptance',55000);
    assert.deepEqual(forbidden,[],'browser must not access remote Supabase');
    // Screenshot proof must actually show the same order. An admin dashboard
    // at the top or a merchant hero cannot be called evidence of this order.
    const code=await merchant.evaluate("merchantRuntime.orders.find(o=>o.orderId==="+JSON.stringify(orderId)+")?.publicCode");
    assert.ok(typeof code==='string'&&code.length>4,'merchant public order code missing');
    const adminCode=await admin.evaluate("adminRuntime.data.controlOrders.find(o=>o.id==="+JSON.stringify(orderId)+")?.public_code");
    assert.equal(adminCode,code,'Admin/merchant public code must agree');
    const selectedOrders=await admin.evaluate("(()=>{const button=Array.from(document.querySelectorAll('.admin-nav-item')).find(b=>b.getAttribute('onclick')?.includes(\"adminSetSection('orders')\"));if(!button)return false;button.click();return true})()");
    assert.equal(selectedOrders,true,'owner demo Admin must open Pedidos through actual navigation');
    await admin.wait("adminRuntime.section==='orders'&&Array.from(document.querySelectorAll('.order-card .order-id')).some(x=>x.textContent.trim()==="+JSON.stringify(code)+")",'Admin must render canonical order card',17000);
    const dir=path.resolve('test-results/isolated-order-evidence');
    fs.mkdirSync(dir,{recursive:true});
    for(const [page,name,expression] of [
      [buyer,'11-demo-local-cliente-pedido',
        "(()=>{const el=document.querySelector('.page');if(!el)return false;el.scrollIntoView({block:'start',behavior:'instant'});return true})()"],
      [merchant,'12-demo-local-revenda-pedido',
        "(()=>{const el=document.getElementById('merchant-order-card-'+"
          +JSON.stringify(orderId)+");if(!el)return false;el.scrollIntoView({block:'start',behavior:'instant'});return true})()"],
      [admin,'13-demo-local-admin-pedido',
        "(()=>{const el=Array.from(document.querySelectorAll('.order-card')).find(card=>card.querySelector('.order-id')?.textContent.trim()==="
          +JSON.stringify(code)+");if(!el)return false;el.scrollIntoView({block:'start',behavior:'instant'});return true})()"]
    ]){
      assert.equal(await page.evaluate(expression),true,'screenshot must target a rendered order '+name);
      await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
      const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const png=Buffer.from(shot.data||'','base64');
      assert.ok(png.length>6000);
      fs.writeFileSync(path.join(dir,name+'.png'),png);
    }
    console.log('PASS: OWNER LOCAL :4179 buyer DOM checkout -> :4180 merchant DOM accept -> :4179 and :4181 see same SQL PREPARING order. 3 isolated origins; 0 cloud Supabase requests.');
    return orderId;
  }finally{
    for(const p of pages)p.close();
    if(browser){
      for(const id of contexts.reverse()){
        try{await browser.send('Target.disposeBrowserContext',{browserContextId:id})}catch{}
      }
      browser.close();
    }
    try{if(chrome.pid)process.kill(-chrome.pid,'SIGTERM')}catch{chrome.kill('SIGTERM')}
    await new Promise(done=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return done();chrome.once('exit',done);setTimeout(done,2200).unref()});
    try{if(chrome.pid)process.kill(-chrome.pid,'SIGKILL')}catch{}
    await pause(350);
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
  }
}
