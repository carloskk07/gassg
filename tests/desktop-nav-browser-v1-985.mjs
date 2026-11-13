import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'PR browser test must not modify production');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=t=>new Promise(ok=>setTimeout(ok,t));
const res=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#home'),{method:'PUT'});
assert.ok(res.ok,'Chrome CDP endpoint missing');
const tab=await res.json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{
 const id=setTimeout(()=>fail(new Error('Chrome websocket timeout')),10000);
 ws.addEventListener('open',()=>{clearTimeout(id);ok()},{once:true});
 ws.addEventListener('error',fail,{once:true});
});
let n=0;
const inFlight=new Map();
ws.addEventListener('message',event=>{
 const data=JSON.parse(String(event.data)),pending=inFlight.get(data.id);
 if(!pending)return;
 inFlight.delete(data.id);clearTimeout(pending.timer);
 if(data.error)pending.fail(Error(data.error.message||'CDP error'));
 else pending.ok(data.result);
});
const send=(method,params={})=>new Promise((ok,fail)=>{
 const id=++n,timer=setTimeout(()=>{inFlight.delete(id);fail(Error('CDP timeout '+method))},20000);
 inFlight.set(id,{ok,fail,timer});
 ws.send(JSON.stringify({id,method,params}));
});
async function run(expression){
 const x=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(x.exceptionDetails)throw Error(x.exceptionDetails.exception?.description||x.exceptionDetails.text);
 return x.result?.value;
}
const results=[];
const navReadExpression="(async()=>{\n const nav=document.querySelector('.tamao-public-nav'),\n  cta=document.querySelector('.tamao-public-header .tamao-header-cta'),\n  bottom=document.querySelector('.bottom-nav'),\n  width=innerWidth;\n const visible=nav&&getComputedStyle(nav).display!=='none';\n const info={width,visible,cta:cta?.innerText?.trim(),\n  documentWidth:document.documentElement.scrollWidth,\n  bottomVisible:bottom&&getComputedStyle(bottom).display!=='none'};\n if(!nav)return {...info,error:'Desktop nav DOM missing'};\n const primary=[...nav.querySelectorAll(':scope>button')].map(x=>x.textContent.trim());\n const menus=[...nav.querySelectorAll(':scope>details')];\n const labels=menus.map(x=>x.querySelector('summary')?.textContent?.trim());\n const allButtons=[...nav.querySelectorAll('button[onclick]')].map(x=>x.getAttribute('onclick'));\n info.primary=primary;info.menus=labels;info.routes=allButtons;\n const rect=nav.getBoundingClientRect(),hero=cta?.getBoundingClientRect();\n info.navRect={left:rect.left,right:rect.right};\n info.ctaRect={left:hero?.left,right:hero?.right};\n if(width>=760){\n  menus[0].open=true;\n  await new Promise(ok=>requestAnimationFrame(ok));\n  const panel=menus[0].querySelector('.tamao-nav-more-panel'),\n   box=panel.getBoundingClientRect(),cs=getComputedStyle(panel);\n  info.openPanel={left:box.left,right:box.right,height:box.height,\n   display:cs.display,background:cs.backgroundColor};\n  menus[1].open=true;\n  info.exclusive=!menus[0].open&&menus[1].open;\n  menus[1].querySelector('summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));\n  info.escapeClosed=!menus[1].open;\n  menus[0].open=true;\n  document.querySelector('main')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));\n  info.outsideClosed=!menus[0].open;\n  menus[0].open=true;\n }\n return info;\n})()";
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [390,760,820,1024,1440]){
  await send('Emulation.setDeviceMetricsOverride',{
   width,height:900,deviceScaleFactor:1,mobile:width<760,
   screenWidth:width,screenHeight:900
  });
  await send('Page.navigate',{url:origin+'/#home'});
  let loaded=false;
  for(let i=0;i<75;i++){
   loaded=await run("document.readyState==='complete'&&!!document.querySelector('.tamao-public-header')");
   if(loaded)break;
   await sleep(200);
  }
  assert.ok(loaded,'Header absent at '+width);
  const data=await run(navReadExpression);
  assert.ok(data&&!data.error,JSON.stringify(data));
  assert.ok(data.documentWidth<=width+2,'Horizontal overflow at '+width);
  if(width<760){
   assert.equal(data.visible,false,'Desktop menu must hide on mobile');
   assert.ok(data.bottomVisible,'Mobile navigation must remain visible');
  }else{
   assert.equal(data.visible,true,'Desktop menu hidden at '+width);
   assert.deepEqual(data.primary,['Clube','Indicações']);
   assert.deepEqual(data.menus,['Serviços ⌄','Conheça ⌄']);
   assert.equal(data.routes.length,9,'Nine public destination links, each exactly once');
   assert.equal(new Set(data.routes).size,9,'Repeated route in desktop menu');
   assert.match(data.cta,/^Comprar/,'One dedicated purchase action');
   assert.ok(data.navRect.left>=0&&data.ctaRect.right<=width+2,'Header navigation clipped');
   assert.ok(data.openPanel.left>=-2&&data.openPanel.right<=width+2,'Dropdown clipped');
   assert.equal(data.openPanel.display,'grid','Dropdown should use styled panel');
   assert.equal(data.exclusive,true,'Two dropdowns open at once');
   assert.equal(data.escapeClosed,true,'Escape must close the opened dropdown');
   assert.equal(data.outsideClosed,true,'Pointer outside must dismiss menu');
  }
  results.push(data);
  if(width===1440){
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   fs.writeFileSync(path.join(out,'desktop-header-services-v1-985.png'),Buffer.from(shot.data,'base64'));
  }
 }
}finally{
 fs.writeFileSync(path.join(out,'desktop-nav-v1-985-results.json'),JSON.stringify(results,null,2)+'\n');
 ws.close();
}
console.log('V1.985 CHROMIUM PASS: no duplicates, unclipped dropdowns, Escape/outside close and responsive header 390-1440px.');
