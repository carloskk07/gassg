import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Real Chrome on the isolated PR build, never inject a sample ad in production.
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'Only isolated local preview is eligible');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const response=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/#home'),{method:'PUT'});
assert.ok(response.ok,'Chrome CDP target unavailable');
const target=await response.json();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Chrome connection timeout')),10000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0;
const pending=new Map();
ws.addEventListener('message',event=>{
 const msg=JSON.parse(String(event.data)),task=pending.get(msg.id);
 if(!task)return;
 pending.delete(msg.id);clearTimeout(task.timer);
 if(msg.error)task.reject(Error(msg.error.message||'CDP failed'));
 else task.resolve(msg.result);
});
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(res.exceptionDetails)throw Error('Browser JS: '+(res.exceptionDetails.exception?.description||res.exceptionDetails.text));
 return res.result?.value;
}
const browserExpression="(async()=>{\n let css=document.querySelector('link[href*=\"public-ux.css\"]');\n if(!css){\n  await new Promise((resolve,reject)=>{\n   css=document.createElement('link');css.rel='stylesheet';css.href='./css/public-ux.css';\n   css.onload=resolve;css.onerror=()=>reject(Error('Missing design stylesheet'));\n   document.head.appendChild(css);\n  });\n }\n if(typeof tamaoAdsDraw!=='function'){\n  await new Promise((resolve,reject)=>{\n   const script=document.createElement('script');script.src='./js/ads-display.js';\n   script.onload=resolve;script.onerror=()=>reject(Error('Missing ad component'));\n   document.head.appendChild(script);\n  });\n }\n let host=document.getElementById('tamao-ads-home-slot');\n if(!host){host=document.createElement('div');host.id='tamao-ads-home-slot';\n  document.getElementById('tamao-main').appendChild(host)}\n const label=__MODE__;\n const slot={campaignId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',\n  challenge:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',\n  label,advertiser:label==='Institucional'?'TAMÃO':'Empresa de exemplo',\n  url:label==='Institucional'?'https://tamao.com.br/':'https://example.org/',\n  title:'Conheça os benefícios do TAMÃO',\n  description:'Confira cupons, vantagens e novidades do TAMÃO.',\n  city:'São Gabriel',state:'RS'};\n tamaoAdsDraw(host.id,slot);\n await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));\n const a=host.querySelector('.tamao-paid-placement .tamao-ad-cta');\n if(!a)return {label,error:'Styled CTA missing'};\n a.scrollIntoView({block:'center'});\n await new Promise(r=>requestAnimationFrame(r));\n const st=getComputedStyle(a),box=a.getBoundingClientRect();\n return {label,color:st.color,background:st.backgroundImage,\n  decoration:st.textDecorationLine,height:box.height,left:box.left,right:box.right,\n  width:innerWidth,scrollWidth:document.documentElement.scrollWidth,rel:a.rel,\n  classname:a.className,html:a.outerHTML};\n})()";
const results=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [360,1120]){
  await send('Emulation.setDeviceMetricsOverride',{
   width,height:850,screenWidth:width,screenHeight:850,deviceScaleFactor:1,mobile:width<800
  });
  await send('Page.navigate',{url:origin+'/#home'});
  let ready=false;
  for(let i=0;i<75;i++){
   ready=await evaluate("document.readyState==='complete'&&!!document.querySelector('#tamao-main')");
   if(ready)break;
   await sleep(200);
  }
  assert.ok(ready,'Home failed to render');
  for(const label of ['Institucional','Patrocinado']){
   const info=await evaluate(browserExpression.replace('__MODE__',JSON.stringify(label)));
   assert.ok(info&&!info.error,JSON.stringify(info));
   assert.equal(info.color,'rgb(255, 255, 255)',label+': purple text or wrong contrast');
   assert.match(info.background,/linear-gradient/,label+': not painted as a button');
   assert.equal(info.decoration,'none',label+': unwanted link underline');
   assert.ok(info.height>=44,label+': touch target smaller than 44px');
   assert.ok(info.left>=-2&&info.right<=width+2,label+': CTA clipped at '+width);
   assert.ok(info.scrollWidth<=width+3,label+': horizontal overflow');
   assert.ok(info.rel.includes('noopener')&&info.rel.includes('nofollow'));
   assert.equal(info.rel.includes('sponsored'),label==='Patrocinado');
   results.push({width,...info});
   const shot=await send('Page.captureScreenshot',{
    format:'png',captureBeyondViewport:false,fromSurface:true});
   const name='ads-cta-'+label.toLowerCase()+'-'+width+'.png';
   fs.writeFileSync(path.join(out,name),Buffer.from(shot.data,'base64'));
  }
 }
}finally{
 fs.writeFileSync(path.join(out,'ads-cta-v1-984-results.json'),JSON.stringify(results,null,2)+'\n');
 ws.close();
}
console.log('V1.984 CHROMIUM PASS: CTA institucional e patrocinado renderizados com contraste e toque a 360 e 1120 px.');
