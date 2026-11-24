import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
const cdp=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const folder=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(folder,{recursive:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let tab;
for(let i=0;i<45;i++){
 try{const r=await fetch(cdp+'/json/new?'+encodeURIComponent(origin+'/#club'),{method:'PUT'});if(r.ok){tab=await r.json();break;}}catch{}
 await pause(220);
}
assert.ok(tab?.webSocketDebuggerUrl,'Chrome CDP is not available for real site UX smoke');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Chrome socket open timed out')),9000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0;const pending=new Map();
ws.addEventListener('message',e=>{
 const result=JSON.parse(String(e.data)),request=pending.get(result.id);
 if(!request)return;
 pending.delete(result.id);clearTimeout(request.timer);
 if(result.error)request.reject(Error(result.error.message));else request.resolve(result.result);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Chrome '+method+' timeout'))},18000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
const routes=['home','sponsors','club','merchants','learn'];
const getStatus=`JSON.stringify((()=>{
 const help=document.querySelector('.tamao-help-shortcut');
 const main=document.querySelector('main#tamao-main');
 const helpRect=help?.getBoundingClientRect(), mainRect=main?.getBoundingClientRect();
 const sponsor=document.querySelector('.sponsor-preview-pills');
 const after=document.querySelector('.sponsor-preview-after');
 const headline=document.querySelector('.club-premium-visitor h1');
 const clubRect=headline?.getBoundingClientRect();
 return {
  heading:document.querySelector('main h1')?.textContent?.trim()||'',
  help:!!help,
  helpPosition:help?getComputedStyle(help).position:null,
  helpHref:help?.href||'',
  inFlow:!!helpRect&&!!mainRect&&helpRect.top>=mainRect.bottom-3,
  documentWidth:document.documentElement.scrollWidth,
  viewportWidth:innerWidth,
  sponsorChips:[...sponsor?.querySelectorAll('span')||[]].map(e=>({text:e.textContent.trim(),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),
  previewChips:[...after?.querySelectorAll('span')||[]].map(e=>({text:e.textContent.trim(),height:e.getBoundingClientRect().height})),
  club:!!headline,clubText:headline?.textContent||'',
  clubHeight:clubRect?.height||0,
  accountForm:!!document.querySelector('.club-premium-visitor [data-tamao-account-context="club"]'),
  emptyStorefront:document.querySelector('.city-price-empty')?.textContent?.trim()||''
 };})())`;
const done=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [360,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800,screenWidth:width,screenHeight:900});
  for(const route of routes){
   await send('Page.navigate',{url:origin+'/?verify=1167-'+width+'#'+route});
   let status;
   for(let attempt=0;attempt<95;attempt++){
    await pause(160);
    const r=await send('Runtime.evaluate',{expression:getStatus,returnByValue:true,awaitPromise:true});
    if(r?.result?.value)status=JSON.parse(r.result.value);
    if(status?.help&&status.heading&&(!['sponsors','club'].includes(route)||(route==='sponsors'?status.sponsorChips.length===3:status.club)))break;
   }
   assert.ok(status?.help&&status.heading,'Route not ready '+route+' '+width+': '+JSON.stringify(status));
   assert.equal(status.helpPosition,'relative','Support link obscures page at '+route+' '+width);
   assert.ok(status.inFlow,'Support link must follow main content at '+route+' '+width);
   assert.match(status.helpHref,/tamao_help=cliente/);
   assert.match(status.helpHref,/modulo=/);
   assert.ok(status.documentWidth<=width+2,'Horizontal overflow at '+route+' '+width+': '+JSON.stringify(status));
   if(route==='sponsors'){
    assert.deepEqual(status.sponsorChips.map(x=>x.text),['Região','Produtos','Serviços']);
    assert.deepEqual(status.previewChips.map(x=>x.text),['Marca identificada','Condições transparentes','Revisão antes de publicar']);
    assert.ok(status.sponsorChips.every(x=>x.width>25&&x.height>=20),'Sponsor preview still looks like skeleton');
   }
   if(route==='club'){
    assert.ok(status.club&&status.accountForm,'Club guest account lost');
    assert.match(status.clubText,/Cupons e cashback/);
    assert.match(status.clubText,/Benefícios claros no Clube TAMÃO/);
    if(width===1280)assert.ok(status.clubHeight<230,'Desktop Club headline still consumes the entire screen');
   }
   if(route==='home'){
    const result=await send('Runtime.evaluate',{expression:`JSON.stringify((()=>{const target=document.getElementById('tamao-all-benefits');const link=document.querySelector('.tamao-storefront-benefit-strip a');if(!target||!link)return {found:false};const hash=location.hash;link.click();return {found:true,sameRoute:location.hash===hash,focused:document.activeElement===target.querySelector('h2')}})())`,returnByValue:true});
    assert.deepEqual(JSON.parse(result.result.value),{found:true,sameRoute:true,focused:true},'Home benefits link must scroll and focus without changing SPA route');
   }
   if(route==='home'&&status.emptyStorefront){
    assert.match(status.emptyStorefront,/Sem ofertas confirmadas/);
    assert.match(status.emptyStorefront,/O pedido só avança com uma revenda e um preço confirmados/);
   }
   if(['home','sponsors','club'].includes(route)){
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
    fs.writeFileSync(path.join(folder,'ux-finish-'+route+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
   }
   done.push({route,width,nonOverlappingHelp:true,overflow:status.documentWidth-width});
  }
 }
 console.log('V1.1167 real Chrome UX PASS',JSON.stringify(done));
}finally{ws.close()}
