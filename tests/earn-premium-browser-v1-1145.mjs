import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const output=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(output,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let target;
for(let tries=0;tries<45;tries++){
 try{
  const r=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#earn'),{method:'PUT'});
  if(r.ok){target=await r.json();break}
 }catch{}
 await sleep(250);
}
assert.ok(target?.webSocketDebuggerUrl,'Chrome CDP unavailable');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok,bad)=>{
 const timer=setTimeout(()=>bad(Error('Chrome socket timeout')),8500);
 ws.addEventListener('open',()=>{clearTimeout(timer);ok()},{once:true});
 ws.addEventListener('error',bad,{once:true});
});
let seq=0;
const pending=new Map();
ws.addEventListener('message',e=>{
 const payload=JSON.parse(String(e.data)),req=pending.get(payload.id);
 if(!req)return;
 pending.delete(payload.id);clearTimeout(req.timeout);
 if(payload.error)req.reject(Error(payload.error.message));
 else req.resolve(payload.result);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);
 pending.set(id,{resolve,reject,timeout});
 ws.send(JSON.stringify({id,method,params}));
});
const inspect='JSON.stringify((()=>{const host=document.querySelector(".earn-signature");const hero=document.querySelector(".earn-hero");const action=document.querySelector(".earn-action-primary");const title=document.querySelector("#earn-signature-title");const rect=action?.getBoundingClientRect();const heading=title?.getBoundingClientRect();return {ready:!!host,style:!!document.querySelector("link[data-tamao-earn-premium]")?.sheet,href:location.hash,width:innerWidth,documentWidth:document.documentElement.scrollWidth,heroBackground:getComputedStyle(hero||document.body).backgroundImage,heading:title?.innerText||"",headingLeft:heading?.left||0,headingRight:heading?.right||0,ctaText:action?.innerText||"",ctaTop:Math.round(rect?.top||0),ctaBottom:Math.round(rect?.bottom||0),ctaLeft:Math.round(rect?.left||0),ctaRight:Math.round(rect?.right||0),steps:document.querySelectorAll(".earn-step-grid article").length,proof:document.querySelectorAll(".earn-assurance>div").length,faqs:document.querySelectorAll(".earn-faq details").length,example:document.querySelector(".earn-try")?.innerText||"",editorialScene:!!document.querySelector(".earn-hero .earn-editorial-scene .earn-scene-art"),financialSeparate:!!document.querySelector(".earn-economics .earn-try")&&!document.querySelector(".earn-hero .earn-try"),error:window.__lastRenderError||null};})())';
const results=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const size of [320,360,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width:size,height:900,deviceScaleFactor:1,mobile:size<800,screenWidth:size,screenHeight:900});
  await send('Page.navigate',{url:origin+'/?earnPremiumVisual=1145#earn'});
  let item;
  for(let attempts=0;attempts<75;attempts++){
   await sleep(180);
   const result=await send('Runtime.evaluate',{expression:inspect,returnByValue:true,awaitPromise:true});
   if(result?.result?.value)item=JSON.parse(result.result.value);
   if(item?.ready&&item?.style)break;
  }
  assert.ok(item?.ready&&item?.style,'Premium #earn page or CSS did not load at '+size+': '+JSON.stringify(item));
  assert.equal(item.width,size);
  assert.ok(item.documentWidth<=size+2,'Horizontal overflow at '+size+': '+JSON.stringify(item));
  assert.ok(item.headingLeft>=-1&&item.headingRight<=size+2,'Heading clipped at '+size);
  assert.ok(item.ctaLeft>=-1&&item.ctaRight<=size+2,'Primary CTA clipped at '+size);
  assert.ok(item.ctaTop>=0&&item.ctaBottom<=900,'Primary CTA outside first screen at '+size);
  assert.equal(item.steps,3);assert.equal(item.proof,4);assert.equal(item.faqs,6);
  assert.ok(item.editorialScene&&item.financialSeparate,'Editorial hero must not impersonate a financial balance panel at '+size);
  assert.match(item.heading,/Indique com confiança/i);
  assert.match(item.ctaText,/Acessar minha Rede/i);
  assert.match(item.heroBackground,/gradient/i);
  assert.match(item.example,/primeiras compras elegíveis|FAÇA AS CONTAS/i);
  assert.equal(item.error,null,'Render failure at '+size);
  await send('Runtime.evaluate',{expression:'earnPremiumScenarioChoose(5)',returnByValue:true});
  const changed=await send('Runtime.evaluate',{expression:'JSON.stringify({pressed:document.querySelector(\'[data-earn-scenario="5"]\')?.getAttribute(\'aria-pressed\'),total:document.querySelector(\'[data-earn-scenario-total]\')?.textContent,expected:BRL.format(referralExample(120,5))})',returnByValue:true});
  const scenario=JSON.parse(changed.result.value);
  assert.equal(scenario.pressed,'true');
  assert.equal(scenario.total,scenario.expected);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  fs.writeFileSync(path.join(output,'earn-premium-'+size+'.png'),Buffer.from(shot.data,'base64'));
  results.push({width:size,ctaTop:item.ctaTop,ctaBottom:item.ctaBottom,overflow:item.documentWidth-size});
 }
 // Commercial CTA must be visible on compact laptop displays, not only 900px-tall screenshots.
 await send('Emulation.setDeviceMetricsOverride',{width:1365,height:645,deviceScaleFactor:1,mobile:false,screenWidth:1365,screenHeight:645});
 await send('Page.navigate',{url:origin+'/?earnPremiumVisual=1147-short#earn'});
 let compact;
 for(let attempts=0;attempts<75;attempts++){
  await sleep(180);
  const current=await send('Runtime.evaluate',{expression:inspect,returnByValue:true});
  if(current?.result?.value)compact=JSON.parse(current.result.value);
  if(compact?.ready&&compact?.style)break;
 }
 assert.ok(compact?.ready&&compact?.style,'Short desktop hero unavailable');
 assert.equal(compact.width,1365);
 assert.ok(compact.documentWidth<=1367,'Short desktop overflow');
 assert.ok(compact.ctaTop>=0&&compact.ctaBottom<=635,
   'Rede primary CTA must be fully above fold at 1365x645: '+JSON.stringify(compact));
 const compactShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
 fs.writeFileSync(path.join(output,'earn-premium-short-desktop-1365x645.png'),Buffer.from(compactShot.data,'base64'));
 results.push({width:1365,height:645,ctaTop:compact.ctaTop,ctaBottom:compact.ctaBottom,overflow:compact.documentWidth-1365});
 await send('Runtime.evaluate',{expression:'document.querySelector(".earn-action-primary")?.click()',returnByValue:true});
 await sleep(350);
 const targetRoute=await send('Runtime.evaluate',{expression:'location.hash',returnByValue:true});
 assert.equal(targetRoute.result.value,'#refer','Primary CTA must open real Rede workspace');
 console.log('TAMÃO Rede premium browser PASS',JSON.stringify(results));
}finally{ws.close()}
