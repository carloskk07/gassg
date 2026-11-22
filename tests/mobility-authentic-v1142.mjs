import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// V1.1142 — read-only real Chrome coverage of the public mobility page.
// Only checks genuine discovery destinations; never creates bookings or users.
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const response=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#mobility'),{method:'PUT'});
assert.ok(response.ok,'Chrome CDP tab unavailable');
const tab=await response.json(),ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const t=setTimeout(()=>reject(Error('Chrome connection timeout')),11000);
 ws.addEventListener('open',()=>{clearTimeout(t);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0;
const pending=new Map();
ws.addEventListener('message',event=>{
 const msg=JSON.parse(String(event.data)),item=pending.get(msg.id);
 if(!item)return;
 pending.delete(msg.id);clearTimeout(item.timer);
 msg.error?item.reject(Error(msg.error.message)):item.resolve(msg.result);
});
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timeout'))},22000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw Error('Chrome: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));
 return r.result?.value;
}
const snapshots=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [320,390,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{
   width,height:960,screenWidth:width,screenHeight:960,deviceScaleFactor:1,mobile:width<768
  });
  await send('Page.navigate',{url:origin+'/?mobility_visual='+width+'#mobility'});
  let ready=false;
  for(let i=0;i<90;i++){
   ready=await evaluate("document.readyState==='complete'&&!!document.querySelector('.mobility-page .mobility-hero')&&document.querySelectorAll('.mobility-choices a').length===2&&!!document.querySelector('link[href*=\"mobility.css\"]')?.sheet");
   if(ready)break;
   await sleep(180);
  }
  assert.ok(ready,'Mobility editorial page must paint at '+width+'px');
  const value=JSON.parse(await evaluate(`JSON.stringify((()=>{
   const hero=document.querySelector('.mobility-hero'),cards=[...document.querySelectorAll('.mobility-choices a')];
   const rects=cards.map(el=>el.getBoundingClientRect());
   return {
    title:hero.querySelector('h1')?.textContent,
    viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
    heroWidth:Math.round(hero.getBoundingClientRect().width),
    photos:[...document.querySelectorAll('.mobility-hero-art img,.mobility-choices img')].map(x=>x.getAttribute('src')),
    visuals:document.querySelectorAll('.mobility-choices .mobility-choice-image svg').length,
    graphic:!!document.querySelector('.mobility-hero .mobility-graphic-title'),
    destinations:cards.map(x=>x.getAttribute('href')),
    guideSteps:document.querySelectorAll('.mobility-journey-steps article').length,
    panels:document.querySelectorAll('.mobility-access-layout').length,
    action:document.querySelectorAll('.mobility-choices a').length===2,
    heroPhotoAlt:hero.querySelector('.mobility-hero-car')?.getAttribute('alt'),
    artDisplay:getComputedStyle(document.querySelector('.mobility-hero-art')).display,
    integrated:!!document.querySelector('.mobility-hero .mobility-choices'),
    clarityCount:document.querySelectorAll('.mobility-clarity li').length,
    choiceTop:document.querySelector('.mobility-choices')?.getBoundingClientRect().top,
    linkAccessible:cards.every(x=>/Encontrar (mototaxista|motorista)/.test(x.getAttribute('aria-label'))),
    firstCardTop:rects[0]?.top,
    cardTitles:cards.map(x=>x.querySelector('strong')?.textContent),
    cardRects:rects.map(r=>({width:r.width,height:r.height,left:r.left,right:r.right}))
   };
  })())`));
  assert.match(value.title,/A cidade se move/);
  assert.equal(value.photos.length,0,'No synthetic stock visuals should load');
  assert.equal(value.visuals,2,'Expected vector symbols for moto and carro');
  assert.equal(value.graphic,true,'Hero needs brand illustration without fake regional imagery');
  assert.ok(value.photos.every(src=>!src),'No external hero/card photo should remain');
  assert.deepEqual(value.destinations,['/?servico=moto#professionals','/?servico=carro#professionals']);
  assert.equal(value.guideSteps,3);
  assert.equal(value.integrated,true,'Service choices must be inside the main editorial hero');
  assert.equal(value.clarityCount,3,'Missing clear service, payment and privacy information');
  assert.equal(value.heroPhotoAlt,undefined,'Hero should not impersonate a local photograph');
  assert.deepEqual(value.cardTitles,['Encontrar mototaxista','Encontrar motorista']);
  assert.equal(value.artDisplay,width<=760?'none':'block','Decorative abstract hero hidden on mobile');
  assert.ok(value.firstCardTop<700,'Choices must appear near the first fold at '+width+'px');
  assert.equal(value.linkAccessible,true);
  assert.ok(value.choiceTop<=value.firstCardTop+2);
  assert.ok(value.documentWidth<=width+2,'Horizontal overflow at '+width+'px: '+value.documentWidth);
  assert.ok(value.cardRects.every(r=>r.height>=44&&r.width>=44&&r.left>=-2&&r.right<=width+2),
   'Discovery card clipped or too small at '+width+'px');
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  fs.writeFileSync(path.join(out,'mobility-premium-1142-'+width+'.png'),Buffer.from(shot.data,'base64'));
  snapshots.push({width,...value});
 }
}finally{ws.close()}
fs.writeFileSync(path.join(out,'mobility-premium-1142.json'),JSON.stringify(snapshots,null,2));
console.log('V1.1142 PASS — no fake regional photos, trustworthy vector choices, real routes and no overflow at 320–1440px.');
