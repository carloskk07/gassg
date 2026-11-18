import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
const base=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Never test a production visitor');
const cdp=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const output=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(output,{recursive:true});
const wait=n=>new Promise(resolve=>setTimeout(resolve,n));
let tab;for(let i=0;i<35&&!tab;i++){
 try{const res=await fetch(cdp+'/json/new?'+encodeURIComponent(base+'/convite/'),{method:'PUT'});if(res.ok)tab=await res.json();}catch{}
 if(!tab)await wait(200);
}
assert.ok(tab?.webSocketDebuggerUrl,'Need isolated Chrome');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Chrome timeout')),9000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let next=0;const pending=new Map();
ws.addEventListener('message',event=>{
 const m=JSON.parse(String(event.data)),job=pending.get(m.id);if(!job)return;
 pending.delete(m.id);clearTimeout(job.timer);m.error?job.reject(Error(m.error.message)):job.resolve(m.result);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
async function evalJs(expression){
 const out=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(out.exceptionDetails)throw Error(out.exceptionDetails.exception?.description||out.exceptionDetails.text);
 return out.result?.value;
}
const seen=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [320,360,390,768,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,screenWidth:width,screenHeight:900,deviceScaleFactor:1,mobile:width<768});
  await send('Page.navigate',{url:base+'/convite/?ref=FRIEND88&a=merchant&t=gold&n=Ana'});
  let ready=false;
  for(let attempt=0;attempt<65;attempt++){
   ready=await evalJs("document.readyState==='complete'&&document.querySelector('#primary')?.href.includes('ref=FRIEND88')&&!!document.querySelector('link[href*=\"style.css\"]')?.sheet");
   if(ready)break;await wait(180);
  }
  assert.equal(ready,true,'Page must load and retain original invite code '+width);
  const data=await evalJs("(()=>{const cta=document.querySelector('#primary'),area=[...document.querySelectorAll('#areas a')];const r=cta.getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,canonical:location.pathname,hero:document.querySelector('h1')?.textContent,theme:document.body.className,cta:cta.href,ctaVisible:r.width>0&&r.height>=45,ctaFits:r.left>=0&&r.right<=innerWidth+2,areas:area.map(a=>a.href),inviter:document.getElementById('inviter')?.textContent,imagesBroken:[...document.images].filter(x=>x.complete&&x.naturalWidth===0).length};})()");
  assert.equal(data.canonical,'/convite/');
  assert.equal(data.theme,'theme-gold');
  assert.ok(data.scroll<=width+2,'Horizontal overflow at '+width+': '+data.scroll);
  assert.ok(data.ctaVisible&&data.ctaFits,'CTA out of viewport at '+width);
  assert.equal(data.imagesBroken,0,'Broken images');
  assert.equal(data.inviter,'Convite compartilhado por Ana');
  const cta=new URL(data.cta);
  assert.equal(cta.origin,'https://tamao.com.br');
  assert.equal(cta.searchParams.get('ref'),'FRIEND88');
  assert.equal(cta.hash,'#merchants');
  assert.equal(data.areas.length,7);
  for(const href of data.areas){
   const url=new URL(href);assert.equal(url.origin,'https://tamao.com.br');
   assert.equal(url.searchParams.get('ref'),'FRIEND88');
  }
  seen.push({width,scroll:data.scroll,cta:data.cta,areas:data.areas.length});
  if([390,1280].includes(width)){
   const snap=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   fs.writeFileSync(path.join(output,'network-invite-v1-1071-'+width+'.png'),Buffer.from(snap.data,'base64'));
  }
 }
}finally{
 fs.writeFileSync(path.join(output,'network-invite-browser-v1-1071.json'),JSON.stringify(seen,null,2)+'\n');
 ws.close();await fetch(cdp+'/json/close/'+tab.id).catch(()=>{});
}
console.log('V1.1071 PASS — branded invitation real Chrome at 320/360/390/768/1280px, seven safe destinations, first-touch ref, no overflow.');
