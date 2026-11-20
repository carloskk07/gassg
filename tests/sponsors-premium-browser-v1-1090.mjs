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
  const geometry=await evaluate("(()=>{const hero=document.querySelector('.sponsor-premium-hero');const row=hero.querySelector('.sponsor-hero-layout');const panel=hero.querySelector('.sponsor-demo-panel');const badge=hero.querySelector('.sponsor-premium-eyebrow');const preview=hero.querySelector('.sponsor-premium-browser');return {panelSibling:panel.parentElement===row.parentElement,panelAfter:panel.getBoundingClientRect().top>=row.getBoundingClientRect().bottom-3,badgeDelta:Math.abs(badge.getBoundingClientRect().top-preview.getBoundingClientRect().top)}})()");
  assert.equal(geometry.panelSibling,true,'Brand customization must not inflate the right column');
  assert.equal(geometry.panelAfter,true,'Controls belong below the two-column hero');
  if(width>=1100)assert.ok(geometry.badgeDelta<90,
   'Sponsor headline and preview misaligned at '+width+': '+JSON.stringify(geometry));
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
  // Personalized visuals must work without a logged-in user at every viewport.
  const demo=await evaluate("(()=>{const input=document.getElementById('sponsor-demo-company');input.value='Ateliê & Cia';input.dispatchEvent(new Event('input',{bubbles:true}));const sector=document.querySelector('[data-sponsor-demo-sector=\"services\"]');sector.click();const brands=[...document.querySelectorAll('[data-sponsor-demo=\"brand\"]')].map(x=>x.textContent);const headline=document.querySelector('[data-sponsor-demo=\"headline\"]').textContent;const sectorActive=sector.getAttribute('aria-pressed');const persisted=JSON.parse(sessionStorage.getItem('tamao-sponsor-showcase-v1092')||'null');document.querySelector('.sponsor-demo-continue').click();return {brands,headline,sectorActive,persisted,focus:document.activeElement?.id||'',width:document.documentElement.scrollWidth}})()");
  assert.ok(demo.brands.length>=3,'Both public mockups and the hero must be updated');
  assert.ok(demo.brands.every(name=>name==='Ateliê & Cia'),'All examples must share the selected brand');
  assert.match(demo.headline,/serviços da nossa cidade/);
  assert.equal(demo.sectorActive,'true');
  assert.equal(demo.persisted.company,'Ateliê & Cia');
  assert.equal(demo.persisted.sector,'services');
  assert.equal(demo.persisted.preparing,true);
  assert.equal(demo.focus,'sponsor-pricing');
  assert.ok(demo.width<=width+3,'Interactive options must not overflow at '+width);
  // V1.1094: creative choices and user-entered copy must remain live and safe at every width.
  const studio=await evaluate("(()=>{const goal=document.querySelector('[data-sponsor-demo-goal=\\\"news\\\"]');goal.click();const input=document.getElementById('sponsor-demo-message');input.value='Novidades especiais no nosso site';input.dispatchEvent(new Event('input',{bubbles:true}));return {goalPressed:goal.getAttribute('aria-pressed'),headline:document.querySelector('[data-sponsor-demo=\\\"headline\\\"]').textContent,copy:document.querySelector('[data-sponsor-demo=\\\"copy\\\"]').textContent,monogram:document.querySelector('[data-sponsor-demo=\\\"monogram\\\"]').textContent,scrollWidth:document.documentElement.scrollWidth}})()");
  assert.equal(studio.goalPressed,'true');
  assert.match(studio.headline,/Tem novidade nos nossos serviços/);
  assert.equal(studio.copy,'Novidades especiais no nosso site');
  assert.equal(studio.monogram,'A');
  assert.ok(studio.scrollWidth<=width+3,'Premium studio overflows at '+width);
  results.push({width,...first,...actions,demo,studio});

 }
}finally{
 fs.writeFileSync(path.join(out,'sponsors-premium-v1-1090-results.json'),JSON.stringify(results,null,2)+'\n');
 ws.close();
}
console.log('PASS V1.1090 real Chrome: 320/360/390/768/1280, hero contrast, no overflow, 4 real budgets, FAQ and actionable CTA.');
