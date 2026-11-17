import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Uses only an isolated site. No accounts, API writes or real reservations.
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const res=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#home'),{method:'PUT'});
assert.equal(res.ok,true);
const tab=await res.json(),ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true})});
let seq=0;const tasks=new Map();
ws.addEventListener('message',e=>{
 const result=JSON.parse(String(e.data)),task=tasks.get(result.id);if(!task)return;
 tasks.delete(result.id);clearTimeout(task.timer);
 result.error?task.fail(Error(result.error.message)):task.ok(result.result);
});
function send(method,params={}){
 return new Promise((ok,fail)=>{
  const id=++seq,timer=setTimeout(()=>{tasks.delete(id);fail(Error(method+' timeout'))},20000);
  tasks.set(id,{ok,fail,timer});ws.send(JSON.stringify({id,method,params}));
 });
}
async function evalPage(expression){
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return r.result?.value;
}
const found=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [320,360,390,760,1120]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:850,screenWidth:width,screenHeight:850,deviceScaleFactor:1,mobile:width<760});
  await send('Page.navigate',{url:origin+'/#home'});
  for(let i=0;i<70;i++){
   if(await evalPage("!!document.querySelector('.tamao-account-access>summary')&&!!document.querySelector('link[href*=\\\"public-ux.css\\\"]')?.sheet"))break;
   await delay(150);
  }
  const data=await evalPage(`(async()=>{
   const details=document.querySelector('.tamao-account-access');
   if(!details)return {error:'Menu ausente'};
   const summary=details.querySelector('summary');
   details.open=false;summary.click();await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));
   const panel=details.querySelector('.tamao-account-access-panel');
   const box=panel.getBoundingClientRect(),button=summary.getBoundingClientRect();
   return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    open:details.open,summary:summary.textContent.trim(),links:[...panel.querySelectorAll('a')].map(a=>a.getAttribute('href')),
    text:panel.textContent.trim(),left:box.left,right:box.right,
    height:box.height,buttonHeight:button.height,
    visible:getComputedStyle(panel).display!=='none',color:getComputedStyle(summary).color};
  })()`);
  assert.ok(data&&!data.error,JSON.stringify(data));
  assert.equal(data.width,width);assert.equal(data.open,true);
  assert.match(data.summary,/Entrar/);
  assert.equal(data.links.length,5,'Cinco áreas de acesso');
  assert.deepEqual(data.links,['#club','#earn','/agenda/','https://parceiro.tamao.com.br/','#advertise']);
  assert.doesNotMatch(data.text,/Administraç|admin\.tamao\.com\.br/i);
  assert.ok(data.scrollWidth<=width+2,'Documento excede a tela '+width+': '+data.scrollWidth);
  assert.ok(data.left>=-2&&data.right<=width+2,'Menu cortado em '+width+'px: '+JSON.stringify(data));
  assert.ok(data.buttonHeight>=42&&data.visible,'Botão ou painel inacessível');
  found.push(data);
  if([320,390,1120].includes(width)){
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   fs.writeFileSync(path.join(out,'participant-entry-open-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
 }
}finally{fs.writeFileSync(path.join(out,'participant-entry-v1-1056-results.json'),JSON.stringify(found,null,2)+'\n');ws.close()}
console.log('V1.1056 PASS: menu aberto, 5 acessos, nenhum Admin, sem corte a 320/360/390/760/1120 px.');
