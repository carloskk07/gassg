import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Real isolated Chrome: visual and functional contract for #professionals.
// No production writes or synthetic listings.
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const res=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#professionals'),{method:'PUT'});
assert.ok(res.ok,'Chrome CDP target unavailable');
const tab=await res.json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Chrome timeout')),11000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0;
const pending=new Map();
ws.addEventListener('message',e=>{
 const msg=JSON.parse(String(e.data)),p=pending.get(msg.id);
 if(!p)return;
 pending.delete(msg.id);clearTimeout(p.timer);
 msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);
});
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timeout'))},22000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(res.exceptionDetails)throw Error('Chrome: '+(res.exceptionDetails.exception?.description||res.exceptionDetails.text));
 return res.result?.value;
}
const snapshots=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [320,390,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{
   width,height:950,screenWidth:width,screenHeight:950,deviceScaleFactor:1,mobile:width<768
  });
  await send('Page.navigate',{url:origin+'/?pro_layout='+width+'#professionals'});
  let ready=false;
  for(let i=0;i<90;i++){
   ready=await evaluate("document.readyState==='complete'&&!!document.querySelector('.discovery-professionals .pros-hero')&&!!document.querySelector('.pros-specialty-grid')&&!!document.getElementById('discovery-occupation')&&!!document.querySelector('link[href*=\"discovery.css\"]')?.sheet");
   if(ready)break;
   await sleep(180);
  }
  assert.ok(ready,'Premium professionals module must paint at '+width+'px');
  const value=JSON.parse(await evaluate("JSON.stringify((()=>{const h=document.querySelector('.pros-hero');const photo=document.querySelector('.pros-photo-main img');const actions=[...document.querySelectorAll('.pros-hero-actions button')].map(el=>el.getBoundingClientRect());return {title:h.querySelector('h1')?.textContent,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,heroWidth:Math.round(h.getBoundingClientRect().width),heroVisible:getComputedStyle(h).display,photos:[...document.querySelectorAll('.pros-hero-visual img')].map(i=>({src:i.getAttribute('src'),alt:i.alt,loaded:i.complete&&i.naturalWidth>0})),specialties:document.querySelectorAll('.pros-specialty').length,primaryHeight:actions[0]?.height,primaryLeft:actions[0]?.left,primaryRight:actions[0]?.right,searchFields:['discovery-uf','discovery-city','discovery-occupation'].every(id=>!!document.getElementById(id)),illustrative:document.querySelector('.pros-photo-note')?.textContent,agendaLink:!!document.querySelector('.pros-agenda a[href=\"/agenda/\"]'),ownerCta:!!document.querySelector('.pros-partner button')}})())"));
  assert.match(value.title,/Bons serviços começam com boas escolhas/);
  assert.equal(value.specialties,6);
  assert.equal(value.photos.length,3);
  assert.ok(value.photos.every(p=>p.src?.includes('images.unsplash.com')&&/ilustrativa/i.test(p.alt)));
  assert.match(value.illustrative,/ilustrativas/);
  assert.equal(value.searchFields,true);
  assert.equal(value.agendaLink,true);
  assert.equal(value.ownerCta,true);
  assert.ok(value.documentWidth<=width+2,'Horizontal overflow at '+width+': '+value.documentWidth);
  assert.ok(value.primaryHeight>=44,'Tiny primary CTA at '+width);
  assert.ok(value.primaryLeft>=-2&&value.primaryRight<=width+2,'Primary CTA clipped at '+width);
  if(width===390){
   await evaluate("document.querySelector('.pros-specialty').click()");
   const filter=await evaluate("document.getElementById('discovery-occupation')?.value");
   assert.equal(filter,'Eletricista','Specialty shortcut must drive the real search input');
  }
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  fs.writeFileSync(path.join(out,'professionals-premium-1138-'+width+'.png'),Buffer.from(shot.data,'base64'));
  snapshots.push({width,...value});
 }
}finally{ws.close()}
fs.writeFileSync(path.join(out,'professionals-premium-1138.json'),JSON.stringify(snapshots,null,2));
console.log('V1.1138 PASS — editorial photographs, six functional specialties, real search, CTA, Agenda, no overflow at 320/390/768/1440.');
