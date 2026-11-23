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
 try{const r=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#club'),{method:'PUT'});if(r.ok){target=await r.json();break}}catch{}
 await sleep(250);
}
assert.ok(target?.webSocketDebuggerUrl,'Chrome CDP unavailable');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok,bad)=>{
 const timer=setTimeout(()=>bad(Error('Chrome socket timeout')),9000);
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
 const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},18000);
 pending.set(id,{resolve,reject,timeout});
 ws.send(JSON.stringify({id,method,params}));
});
const inspect='JSON.stringify((()=>{const host=document.querySelector(".tamao-club-premium.club-premium-visitor");const heading=host?.querySelector("h1");const cta=host?.querySelector(".club-premium-actions .club-premium-primary");const r=cta?.getBoundingClientRect();const h=heading?.getBoundingClientRect();const offer=host?.querySelector(".tamao-coupon-price-board");return {ready:!!host,style:!!document.querySelector("link[data-tamao-club-premium]")?.sheet,loaded:typeof globalThis.clubPremiumPage==="function",width:innerWidth,documentWidth:document.documentElement.scrollWidth,heading:heading?.innerText||"",headingLeft:h?.left,headingRight:h?.right,ctaTop:r?.top,ctaBottom:r?.bottom,ctaLeft:r?.left,ctaRight:r?.right,account:!!host?.querySelector("[data-tamao-account-context=club]"),inputs:host?.querySelectorAll("#clube-visitor-coupon-name,#clube-visitor-coupon-phone,#clube-visitor-coupon-email").length,login:!!host?.querySelector("[name=intent][value=login]"),register:!!host?.querySelector("[name=intent][value=register]"),benefits:host?.querySelectorAll(".club-premium-benefit").length,faq:host?.querySelectorAll(".club-premium-faq-items details").length,realOffer:offer?.hidden===false,price:offer?.querySelector("[data-coupon-price]")?.textContent||"",error:window.__lastRenderError||null};})())';
const results=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const size of [320,360,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width:size,height:900,deviceScaleFactor:1,mobile:size<800,screenWidth:size,screenHeight:900});
  await send('Page.navigate',{url:origin+'/?clubPremiumVisual=1164#club'});
  let item;
  for(let attempts=0;attempts<100;attempts++){
   await sleep(180);
   const r=await send('Runtime.evaluate',{expression:inspect,returnByValue:true,awaitPromise:true});
   if(r?.result?.value)item=JSON.parse(r.result.value);
   if(item?.ready&&item?.style&&item?.loaded)break;
  }
  assert.ok(item?.ready&&item?.style&&item?.loaded,'Premium #club did not load at '+size+': '+JSON.stringify(item));
  assert.equal(item.width,size);
  assert.ok(item.documentWidth<=size+2,'Club horizontal overflow at '+size+': '+JSON.stringify(item));
  assert.ok(item.headingLeft>=-1&&item.headingRight<=size+2,'Club heading clipped at '+size+': '+JSON.stringify(item));
  assert.ok(item.ctaLeft>=-1&&item.ctaRight<=size+2,'Club CTA clipped at '+size+': '+JSON.stringify(item));
  assert.equal(item.inputs,3);
  assert.ok(item.account&&item.login&&item.register,'Identified customer login/register broken: '+JSON.stringify(item));
  assert.equal(item.benefits,3);
  assert.equal(item.faq,5);
  assert.match(item.heading,/Cupons e cashback/);
  assert.equal(item.error,null);
  // Do not issue an OTP, payment or request: only native disclosure and safe scroll action.
  const disclosure=await send('Runtime.evaluate',{expression:'(()=>{const d=document.querySelector(".club-premium-faq-items details");d.open=false;d.querySelector("summary").click();return d.open})()',returnByValue:true});
  assert.equal(disclosure.result.value,true,'Native FAQ does not work at '+size);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  fs.writeFileSync(path.join(output,'club-premium-'+size+'.png'),Buffer.from(shot.data,'base64'));
  results.push({width:size,overflow:item.documentWidth-size,verifiedOfferShown:item.realOffer});
 }
 console.log('TAMÃO Clube premium browser PASS',JSON.stringify(results));
}finally{ws.close()}
