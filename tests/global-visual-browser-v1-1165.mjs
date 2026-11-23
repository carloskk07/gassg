import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
let target;
for(let i=0;i<40;i++){
 try{const r=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#learn'),{method:'PUT'});
   if(r.ok){target=await r.json();break}}catch{}
 await sleep(230);
}
assert.ok(target?.webSocketDebuggerUrl,'No Chrome CDP page');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok,bad)=>{
 const timeout=setTimeout(()=>bad(Error('Chrome CDP connection timed out')),9000);
 ws.addEventListener('open',()=>{clearTimeout(timeout);ok()},{once:true});
 ws.addEventListener('error',bad,{once:true});
});
let counter=0;
const pending=new Map();
ws.addEventListener('message',e=>{
 const message=JSON.parse(String(e.data)),p=pending.get(message.id);
 if(!p)return;
 pending.delete(message.id);clearTimeout(p.timer);
 if(message.error)p.reject(Error(message.error.message));else p.resolve(message.result);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++counter;
 const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timed out'))},17000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
const routes=[
 {name:'home',hash:'',icon:'.tamao-quick-path-icon,.tamao-benefit-emoji'},
 {name:'learn',hash:'#learn',icon:'.learn-premium .learn-benefit-symbol'},
 {name:'sponsors',hash:'#sponsors',icon:'.sponsor-premium-format-icon'},
 {name:'earn',hash:'#earn',icon:'.earn-benefit-symbol'},
 {name:'club',hash:'#club',icon:'.club-premium-feature-icon'}
];
const makeInspect=icon=>`JSON.stringify((()=>{const root=document.querySelector('#app');const e=document.querySelector(${JSON.stringify(icon)});const pseudo=e?getComputedStyle(e,'::before'):null;const mask=pseudo?(pseudo.webkitMaskImage||pseudo.maskImage):'';const x=document.querySelector('h1:not(.tamao-preboot h1)');const html=document.documentElement;return {ready:!!root&&!!x&&!root.querySelector('.tamao-preboot'),heading:x?.textContent?.trim()?.slice(0,90),icon:!!e,mask:String(mask||''),width:innerWidth,scroll:html.scrollWidth,style:!!document.querySelector('link[href*="visual-finish.css"]'),studioLabels:document.querySelector('.sponsor-placement-faux-products')?.textContent?.trim()||'',skeletons:document.querySelectorAll('.sponsor-placement-faux-products span:empty,.sponsor-placement-faux-lines span:empty').length};})())`;
const reports=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [360,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800,screenWidth:width,screenHeight:900});
  for(const page of routes){
   await send('Page.navigate',{url:origin+'/?vf=1165-'+width+page.hash});
   let item;
   for(let tries=0;tries<85;tries++){
    await sleep(170);
    const answer=await send('Runtime.evaluate',{expression:makeInspect(page.icon),returnByValue:true,awaitPromise:true});
    if(answer?.result?.value)item=JSON.parse(answer.result.value);
    if(item?.ready&&item.style&&item.icon)break;
   }
   assert.ok(item?.ready&&item.style&&item.icon,`Route ${page.name} not loaded at ${width}: ${JSON.stringify(item)}`);
   assert.ok(item.scroll<=width+2,`Horizontal overflow ${page.name}@${width}: ${JSON.stringify(item)}`);
   if(['home','learn','sponsors'].includes(page.name)){
    assert.match(item.mask,/data:image\/svg\+xml/i,`Finished icon missing in ${page.name}@${width}: ${JSON.stringify(item)}`);
   }
   if(page.name==='sponsors'){
    assert.equal(item.skeletons,0,'Do not draw empty skeleton cards as ad placements');
    assert.match(item.studioLabels,/Produtos e serviços/);
    assert.match(item.studioLabels,/Publicidade identificada/);
   }
   if(['home','learn','sponsors'].includes(page.name)){
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
    fs.writeFileSync(path.join(out,'visual-finish-'+page.name+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
   }
   reports.push({route:page.name,width,overflow:item.scroll-width,hasFinishedIcon:item.mask.includes('data:image/svg+xml')});
  }
 }
 console.log('V1.1165 global visual browser PASS',JSON.stringify(reports));
}finally{ws.close()}
