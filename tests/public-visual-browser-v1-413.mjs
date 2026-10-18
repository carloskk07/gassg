import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const cases=[
 ['home','/'],['como-funciona','/como-funciona/'],
 ['para-revendas','/para-revendas/'],['para-marcas','/para-marcas/'],
 ['indicacoes','/indicacoes/']
];
const sizes=[{width:360,height:800},{width:768,height:900},{width:1440,height:900}];
let target;
for(let i=0;i<30;i++){
 try{
  const r=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/'),{method:'PUT'});
  if(r.ok){target=await r.json();break}
 }catch{}
 await sleep(250);
}
assert.ok(target?.webSocketDebuggerUrl,'Chrome remote debugging unavailable');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const deadline=setTimeout(()=>reject(new Error('Chrome websocket timeout')),8000);
 ws.addEventListener('open',()=>{clearTimeout(deadline);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0;
const pending=new Map();
ws.addEventListener('message',event=>{
 const message=JSON.parse(String(event.data));
 const request=pending.get(message.id);
 if(!request)return;
 pending.delete(message.id);clearTimeout(request.timeout);
 if(message.error)request.reject(new Error(message.error.message||JSON.stringify(message.error)));
 else request.resolve(message.result);
});
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++seq, timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method))},15000);
  pending.set(id,{resolve,reject,timeout});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function readDOM(){
 const expression=`JSON.stringify((()=>{
 const heading=document.querySelector('main h1, h1');
 const rect=heading?.getBoundingClientRect();
 return {
  url:location.pathname, title:document.title,
  viewport:innerWidth, documentWidth:document.documentElement.scrollWidth,
  heading:heading?.innerText?.trim()||'', headingLeft:rect?.left||0,
  headingRight:rect?.right||0,
  brokenImages:[...document.images].filter(i=>i.complete&&i.naturalWidth===0)
   .map(i=>i.getAttribute('src')).filter(Boolean).slice(0,8),
  savingsScene:document.querySelectorAll('.ed-value-scene').length,
  compactPerks:document.querySelectorAll('.tamao-value-compact .tamao-perks-panel').length,
  visibleCatalogue:document.querySelectorAll('.home-discover-tile:not([hidden])').length
 }})())`;
 const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(res.exceptionDetails)throw new Error('DOM evaluate exception: '+res.exceptionDetails.text);
 return JSON.parse(res.result.value);
}
async function awaitReady(label){
 for(let i=0;i<60;i++){
  const state=await send('Runtime.evaluate',{expression:"document.readyState==='complete'&&!!document.querySelector('h1')",returnByValue:true});
  if(state.result?.value)return;
  await sleep(200);
 }
 throw new Error(label+': heading did not appear in 12 seconds');
}
const results=[],issues=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const [name,route] of cases){
  for(const size of sizes){
   await send('Emulation.setDeviceMetricsOverride',{
    width:size.width,height:size.height,deviceScaleFactor:1,mobile:size.width<800,
    screenWidth:size.width,screenHeight:size.height
   });
   await send('Page.navigate',{url:origin+route});
   await awaitReady(name+' '+size.width);
   await sleep(400);
   const data=await readDOM();
   const file=name+'-'+size.width+'.png';
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   fs.writeFileSync(path.join(out,file),Buffer.from(shot.data,'base64'));
   results.push({page:name,width:size.width,...data,screenshot:file});
   if(data.viewport!==size.width)issues.push(name+' '+size.width+': wrong viewport '+data.viewport);
   if(data.documentWidth>size.width+2)issues.push(name+' '+size.width+': horizontal overflow '+(data.documentWidth-size.width)+'px');
   if(data.headingLeft< -2||data.headingRight>size.width+2)issues.push(name+' '+size.width+': clipped heading');
   if(!data.heading)issues.push(name+' '+size.width+': empty heading');
   if(data.brokenImages.length)issues.push(name+' '+size.width+': broken images '+data.brokenImages.join(','));
   if(name!=='home'&&data.savingsScene!==1)issues.push(name+' '+size.width+': expected one distinct visual benefit scene');
   if(name==='home'&&data.compactPerks!==2)issues.push(name+' '+size.width+': expected two first-visit benefit panels');
   if(name==='home'&&data.visibleCatalogue===0)issues.push(name+' '+size.width+': catalogue missing');
  }
 }
}finally{
 fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({testedAt:new Date().toISOString(),results,issues},null,2)+'\n');
 ws.close();
}
for(const problem of issues)console.error('VISUAL: '+problem);
assert.equal(issues.length,0,'Public visitor viewport regression; inspect uploaded browser screenshots and audit.json');
console.log('TAMÃO V1.413 visual PASS: five real browser pages × three viewport widths, without horizontal overflow.');
