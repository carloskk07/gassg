import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Real Chrome on the isolated PR build, never inject a sample ad in production.
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'Only isolated local preview is eligible');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const response=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#home'),{method:'PUT'});
assert.ok(response.ok,'Chrome CDP target unavailable');
const target=await response.json();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Chrome connection timeout')),10000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0;
const pending=new Map();
ws.addEventListener('message',event=>{
 const msg=JSON.parse(String(event.data)),task=pending.get(msg.id);
 if(!task)return;
 pending.delete(msg.id);clearTimeout(task.timer);
 if(msg.error)task.reject(Error(msg.error.message||'CDP failed'));
 else task.resolve(msg.result);
});
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(res.exceptionDetails)throw Error('Browser JS: '+(res.exceptionDetails.exception?.description||res.exceptionDetails.text));
 return res.result?.value;
}

const results=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [320,360,390,768,1280]){
  await send('Emulation.setDeviceMetricsOverride',{
   width,height:920,screenWidth:width,screenHeight:920,deviceScaleFactor:1,mobile:width<800
  });
  await send('Page.navigate',{url:origin+'/#sponsors'});
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   ready=await evaluate("(()=>{const hero=document.querySelector('.sponsor-premium-v1090 .sponsor-premium-hero');return document.readyState==='complete'&&!!hero&&!!document.querySelector('#sponsor-cpm-budget')&&document.querySelectorAll('[data-sponsor-budget]').length===4&&getComputedStyle(hero).backgroundImage.includes('gradient')})()");
   if(ready)break;
   await sleep(200);
  }
  assert.ok(ready,'Advertiser page did not load its premium module, planner and CSS at '+width+'px');
  const first=await evaluate("(()=>{const hero=document.querySelector('.sponsor-premium-hero');const ad=document.querySelector('.sponsor-premium-ad-mock');const cta=document.querySelector('.sponsor-premium-main-cta');const rect=cta.getBoundingClientRect();return {title:document.title,h1:hero.querySelector('h1')?.textContent||'',heroBackground:getComputedStyle(hero).backgroundImage,adLabel:ad?.querySelector('.sponsor-premium-ad-tag')?.textContent||'',adNote:document.querySelector('.sponsor-premium-visual-note')?.textContent||'',ctaHeight:rect.height,ctaLeft:rect.left,ctaRight:rect.right,faqCount:document.querySelectorAll('.sponsor-premium-faq details').length,planCount:document.querySelectorAll('[data-sponsor-budget]').length,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,accountInput:!!document.getElementById('sponsor-account-email')}})()");
  assert.match(first.title,/Anuncie no TAMÃO/);
  assert.match(first.h1,/Sua marca merece/);
  assert.match(first.heroBackground,/gradient/);
  assert.match(first.adLabel,/PUBLICIDADE IDENTIFICADA/);
  assert.match(first.adNote,/ilustrativa/);
  assert.ok(first.ctaHeight>=44,'Sponsor CTA too small at '+width);
  assert.ok(first.ctaLeft>=-2&&first.ctaRight<=width+2,'Sponsor CTA outside viewport at '+width);
  assert.equal(first.faqCount,5);
  assert.equal(first.planCount,4);
  assert.equal(first.accountInput,true,'Real advertiser signup input must remain available');
  assert.ok(first.scrollWidth<=width+3,'Sponsor page horizontal overflow at '+width+': '+JSON.stringify(first));
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  fs.writeFileSync(path.join(out,'sponsors-premium-v1-1090-'+width+'.png'),Buffer.from(shot.data,'base64'));
  const actions=await evaluate("(async()=>{const one=document.querySelector('[data-sponsor-budget=\"1990\"]');one.click();const budget=document.getElementById('sponsor-cpm-budget');const days=document.getElementById('sponsor-cpm-days');const quote=document.getElementById('sponsor-cpm-result').textContent;document.querySelector('.sponsor-premium-main-cta').click();const focused=document.activeElement?.id||'';const faq=document.querySelector('.sponsor-premium-faq details');const beforeFaq=faq.open;faq.querySelector('summary').click();await new Promise(r=>requestAnimationFrame(r));return {beforeFaq,budget:budget.value,days:days.value,quote,focused,faqOpened:faq.open,hash:location.hash,buttons:[...document.querySelectorAll('[data-sponsor-budget]')].map(x=>x.getAttribute('aria-pressed'))}})()");
  assert.equal(actions.budget,'1990');
  assert.equal(actions.days,'7');
  assert.match(actions.quote,/R\$ 19,90 por 7 dias/);
  assert.equal(actions.focused,'sponsor-pricing');
  assert.notEqual(actions.faqOpened,actions.beforeFaq,'FAQ must toggle on click: '+JSON.stringify(actions));
  assert.equal(actions.hash,'#sponsors');
  assert.deepEqual(actions.buttons,['true','false','false','false']);
  results.push({width,...first,...actions});
 }
}finally{
 fs.writeFileSync(path.join(out,'sponsors-premium-v1-1090-results.json'),JSON.stringify(results,null,2)+'\n');
 ws.close();
}
console.log('PASS V1.1090 real Chrome: 320/360/390/768/1280, hero contrast, no overflow, 4 real budgets, FAQ and actionable CTA.');
