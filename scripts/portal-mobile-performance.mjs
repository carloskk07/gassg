import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BASE=new URL(process.env.TAMAO_PERF_BASE||'http://127.0.0.1:4186/');
const DEBUG=new URL(process.env.CHROME_DEBUG||'http://127.0.0.1:9226');
for(const url of [BASE,DEBUG])assert.ok(url.protocol==='http:'&&url.hostname==='127.0.0.1','Disposable local endpoints only');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=await (async()=>{
 for(let i=0;i<40;i++){
  try{const pages=await fetch(new URL('/json/list',DEBUG)).then(r=>r.json());
   const page=pages.find(x=>x.type==='page');if(page)return page;
  }catch{}
  await sleep(250);
 }
 throw new Error('Local Chrome unavailable');
})();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
 const t=setTimeout(()=>reject(new Error('CDP connection timeout')),5000);
 ws.addEventListener('open',()=>{clearTimeout(t);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});
});
let seq=0,blockedExternal=0;
const pending=new Map();
function send(method,params={}){
 const id=++seq;
 return new Promise((resolve,reject)=>{
  const t=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},12000);
  pending.set(id,{resolve,reject,t});
  ws.send(JSON.stringify({id,method,params}));
 });
}
ws.addEventListener('message',ev=>{
 const m=JSON.parse(String(ev.data));
 if(m.id&&pending.has(m.id)){
  const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.t);
  if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);
 }
 if(m.method==='Fetch.requestPaused'){
  const u=new URL(m.params.request.url);
  const allowed=u.origin===BASE.origin&&['GET','HEAD'].includes(m.params.request.method);
  if(!allowed)blockedExternal++;
  send(allowed?'Fetch.continueRequest':'Fetch.failRequest',
    allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
 }
});
async function evaluate(expression){
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);
 return r.result?.value;
}
async function waitFor(expr,timeout=90000){
 const end=Date.now()+timeout;
 while(Date.now()<end){
  try{if(await evaluate(expr))return;}catch{}
  await sleep(250);
 }
 throw new Error('Timed out: '+expr);
}
const observerSource=String.raw`
globalThis.__tamaoPerf={lcp:null,cls:0,session:0,first:0,last:0,longTasks:0,blockingMs:0};
const p=globalThis.__tamaoPerf;
for(const type of ['largest-contentful-paint','layout-shift','longtask']){
 try{new PerformanceObserver(list=>{
  for(const e of list.getEntries()){
   if(type==='largest-contentful-paint')p.lcp=e.startTime;
   if(type==='layout-shift'&&!e.hadRecentInput){
    if(p.last&&e.startTime-p.last<1000&&e.startTime-p.first<5000)p.session+=e.value;
    else{p.session=e.value;p.first=e.startTime;}
    p.last=e.startTime;p.cls=Math.max(p.cls,p.session);
   }
   if(type==='longtask'){p.longTasks++;p.blockingMs+=Math.max(0,e.duration-50);}
  }
 }).observe({type,buffered:true});}catch{}
}
`;
try{
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 // No external requests and no mutating requests: this is a local test bundle,
 // not an authenticated session, analytics collector or production load test.
 await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844});
 await send('Emulation.setCPUThrottlingRate',{rate:4});
 await send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750,connectionType:'cellular4g'});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:observerSource});
 const results=[];
 for(const [role,route] of [['customer','home'],['merchant','merchant'],['admin','admin']]){
  await send('Page.navigate',{url:'about:blank'});
  await send('Network.clearBrowserCache');
  const url=new URL(role+'/#'+route,BASE).href;
  const before=blockedExternal;
  await send('Page.navigate',{url});
  await waitFor('location.origin+location.pathname==='+JSON.stringify(new URL(url).origin+new URL(url).pathname)+' && document.readyState==="complete" && !!document.querySelector("#app") && document.querySelector("#app").innerText.trim().length>20');
  await sleep(1600);
  const sample=await evaluate(`(()=>{
   const nav=performance.getEntriesByType('navigation')[0];
   const paint=performance.getEntriesByType('paint');
   const perf=globalThis.__tamaoPerf;
   const resources=performance.getEntriesByType('resource').filter(e=>e.name.startsWith(location.origin+'/'));
   return {role:globalThis.CHAMA_PORTAL_ROLE,fcpMs:paint.find(e=>e.name==='first-contentful-paint')?.startTime??null,
     lcpMs:perf.lcp,cls:perf.cls,longTasks:perf.longTasks,blockingMs:perf.blockingMs,
     domContentLoadedMs:nav?.domContentLoadedEventEnd??null,loadMs:nav?.loadEventEnd??null,
     observedLocalResources:resources.length,localResourceTransferBytes:resources.reduce((a,e)=>a+e.transferSize,0),
     horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
  })()`);
  assert.equal(sample.role,role,'Wrong isolated portal rendered');
  for(const key of ['fcpMs','lcpMs','cls','longTasks','blockingMs','domContentLoadedMs','loadMs','observedLocalResources','localResourceTransferBytes','horizontalOverflow'])
    assert.ok(sample[key]===null||(Number.isFinite(sample[key])&&sample[key]>=0),'Invalid '+key);
  results.push({...sample,blockedExternalRequests:blockedExternal-before});
 }
 const report={schemaVersion:1,kind:'synthetic-local-cold-start',viewport:{width:390,height:844},cpuSlowdown:4,
   network:{latencyMs:150,downloadBytesPerSecond:200000,uploadBytesPerSecond:93750},
   limitations:['Single sample per role; not field data or p75','External requests blocked; no authenticated flows','Local HTTP server does not simulate CDN compression','LCP and CLS observed through 1.6s after load; INP not measured'],portals:results};
 const dest=path.resolve(process.env.TAMAO_PERF_REPORT||'dist/portal-mobile-performance.json');
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{ws.close();}
