import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
const cdp=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let target;
for(let i=0;i<45;i++){
 try{
  const r=await fetch(cdp+'/json/new?'+encodeURIComponent(origin+'/#professionals'),{method:'PUT'});
  if(r.ok){target=await r.json();break}
 }catch{}
 await sleep(200);
}
assert.ok(target?.webSocketDebuggerUrl,'Isolated Chrome CDP not available');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('CDP socket timed out')),9000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0;const pending=new Map();
ws.addEventListener('message',event=>{
 const m=JSON.parse(String(event.data)),request=pending.get(m.id);
 if(!request)return;
 clearTimeout(request.timer);pending.delete(m.id);
 if(m.error)request.reject(Error(m.error.message));else request.resolve(m.result);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},18000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
const inspect=kind=>{
 const selector=kind==='professionals'?'.discovery-professionals .pros-specialty-icon':'.discovery-rides .rides-assurance-symbol';
 return `JSON.stringify((()=>{const icon=document.querySelector(${JSON.stringify(selector)});
 const s=icon&&getComputedStyle(icon,'::before'),mask=s?(s.webkitMaskImage||s.maskImage):'';
 const css=[...document.querySelectorAll('link[rel=stylesheet]')].some(x=>x.href.includes('discovery.css'));
 const photo=document.querySelector('.discovery-rides .rides-hero-visual>img');
 const credit=document.querySelector('.discovery-rides .rides-photo-credit');
 return {
  ready:!!document.querySelector('.discovery-${kind}'),css,icon:!!icon,mask:String(mask||''),
  scrollWidth:document.documentElement.scrollWidth,width:innerWidth,
  specialties:document.querySelectorAll('.pros-specialty-grid .pros-specialty').length,
  agendaIcon:!!document.querySelector('.discovery-professionals .pros-agenda-icon'),
  photo:photo?.src||'',credit:credit?.textContent?.trim()||'',creditHref:credit?.href||'',
  creditRel:credit?.rel||'',creditTarget:credit?.target||'',
  trustIcons:document.querySelectorAll('.rides-assurance-item .rides-assurance-symbol').length
 };})())`;
};
const results=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [360,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800,screenWidth:width,screenHeight:900});
  for(const kind of ['professionals','rides']){
   await send('Page.navigate',{url:origin+'/?visual=1166-'+width+'#'+kind});
   let item;
   for(let i=0;i<100;i++){
    await sleep(180);
    const r=await send('Runtime.evaluate',{expression:inspect(kind),returnByValue:true,awaitPromise:true});
    if(r?.result?.value)item=JSON.parse(r.result.value);
    if(item?.ready&&item.css&&item.icon&&item.mask.includes('data:image/svg+xml'))break;
   }
   assert.ok(item?.ready&&item?.css&&item.icon,'Failed real discovery page '+kind+'@'+width+': '+JSON.stringify(item));
   assert.match(item.mask,/data:image\/svg\+xml/i,'Unfinished specialty/trust icon '+kind+'@'+width);
   assert.ok(item.scrollWidth<=width+2,'Horizontal overflow '+kind+'@'+width+': '+JSON.stringify(item));
   if(kind==='professionals'){
    assert.equal(item.specialties,6,'Six real professional categories retained');
    assert.ok(item.agendaIcon,'Agenda follow-up is missing');
   }else{
    assert.match(item.photo,/photo-1673528218483-cc37fb93b2fe/);
    assert.match(item.credit,/Pedro Fritsch/);
    assert.match(item.credit,/Arroio Grande\/RS/);
    assert.match(item.creditHref,/unsplash\.com\/photos/);
    assert.equal(item.creditTarget,'_blank');
    assert.ok(item.creditRel.includes('noopener')&&item.creditRel.includes('noreferrer'));
    assert.equal(item.trustIcons,3);
   }
   const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   fs.writeFileSync(path.join(out,'visual-integrity-'+kind+'-'+width+'.png'),Buffer.from(image.data,'base64'));
   results.push({kind,width,overflow:item.scrollWidth-width});
  }
 }
 console.log('V1.1166 discovery visual browser PASS',JSON.stringify(results));
}finally{ws.close()}
