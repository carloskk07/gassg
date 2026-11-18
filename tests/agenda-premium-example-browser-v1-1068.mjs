import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'Use local static site only');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
let tab;
for(let n=0;n<30;n++){
 try{const r=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/agenda/exemplo/'),{method:'PUT'});if(r.ok){tab=await r.json();break}}catch{}
 await sleep(250);
}
assert.ok(tab?.webSocketDebuggerUrl,'Chrome unavailable');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true})});
let seq=0;const pending=new Map();
ws.addEventListener('message',e=>{
 const response=JSON.parse(String(e.data)),job=pending.get(response.id);
 if(!job)return;
 pending.delete(response.id);clearTimeout(job.timer);
 response.error?job.fail(Error(response.error.message)):job.ok(response.result);
});
const send=(method,params={})=>new Promise((ok,fail)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(Error(method+' timeout'))},18000);
 pending.set(id,{ok,fail,timer});ws.send(JSON.stringify({id,method,params}));
});
async function evaluate(expression){
 const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 return result.result?.value;
}
const findings=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [320,390,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:840,screenWidth:width,screenHeight:840,deviceScaleFactor:1,mobile:width<768});
  await send('Page.navigate',{url:origin+'/agenda/exemplo/'});
  let ready=false;
  for(let n=0;n<60;n++){
   ready=await evaluate("document.readyState==='complete'&&!!document.querySelector('#hero-title')&&!!document.querySelector('#demo-booking')&&!!document.querySelector('link[href*=\\\"exemplo/style.css\\\"]')?.sheet");
   if(ready)break;
   await sleep(160);
  }
  assert.ok(ready,'Premium demo must load with CSS on '+width+'px');
  const first=JSON.parse(await evaluate("JSON.stringify((function(){var h=document.querySelector('#hero-title');var n=document.querySelector('.main-nav');return {pathname:location.pathname,viewport:innerWidth,docWidth:document.documentElement.scrollWidth,title:h.textContent.trim(),right:h.getBoundingClientRect().right,services:document.querySelectorAll('.service').length,photos:document.querySelectorAll('.gallery-photo').length,hero:document.querySelector('.hero-photo').getAttribute('src'),nav:getComputedStyle(n).display,signup:!!document.querySelector('a[href^=\\\"/agenda/?agenda=1\\\"]')};})())"));
  assert.equal(first.pathname,'/agenda/exemplo/');
  assert.match(first.title,/Barbearia Black Gold/);
  assert.equal(first.services,4);
  assert.equal(first.photos,6);
  assert.match(first.hero,/images\.unsplash\.com/);
  assert.equal(first.signup,true);
  assert.ok(first.docWidth<=width+2,'Overflow at '+width+'px: '+first.docWidth);
  assert.ok(first.right<=width+2,'Clipped H1 at '+width+'px');
  if(width<768){
   const nav=JSON.parse(await evaluate("JSON.stringify((function(){var m=document.getElementById('menu-toggle');m.click();var open=m.getAttribute('aria-expanded');var display=getComputedStyle(document.querySelector('.main-nav')).display;document.querySelector('.main-nav a[href=\\\"#servicos\\\"]').click();return {open:open,display:display,closed:m.getAttribute('aria-expanded')};})())"));
   assert.equal(nav.open,'true');assert.equal(nav.display,'flex');assert.equal(nav.closed,'false');
  }
  const form=JSON.parse(await evaluate("JSON.stringify((function(){document.querySelector('.service[data-service=\\\"combo\\\"]').click();document.querySelector('[data-slot=\\\"10:00\\\"]').click();document.getElementById('demo-booking').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return {price:document.getElementById('booking-price').textContent,message:document.getElementById('booking-feedback').textContent,state:document.getElementById('booking-feedback').dataset.state};})())"));
  assert.match(form.price,/70,00/);
  assert.match(form.message,/nenhuma reserva ou pagamento foi realizado/);
  assert.equal(form.state,'success');
  const gallery=JSON.parse(await evaluate("JSON.stringify((function(){document.querySelector('.gallery-photo').click();var d=document.getElementById('gallery-dialog');var opened=d.open;document.getElementById('dialog-close').click();return {opened:opened,closed:!d.open};})())"));
  assert.deepEqual(gallery,{opened:true,closed:true});
  const screen=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  const name='agenda-premium-example-'+width+'.png';
  fs.writeFileSync(path.join(out,name),Buffer.from(screen.data,'base64'));
  findings.push({...first,form,gallery,screenshot:name});
 }
}finally{
 fs.writeFileSync(path.join(out,'agenda-premium-example-results.json'),JSON.stringify(findings,null,2)+'\n');
 ws.close();
}
console.log('V1.1068 Chrome PASS: real premium demo, mobile menu, booking preview, gallery, 320–1440px without overflow.');
