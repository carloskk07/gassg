import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
const base=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
const cdp=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const outDir=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');fs.mkdirSync(outDir,{recursive:true});
const shopId='11111111-2222-4333-8444-555555555555',ref='TMR'+'A'.repeat(24);
const fixture={source:'participant_native_page_v1_1072',kind:'merchant',slug:'revenda-da-rua-111111112222',
 name:'Revenda da Rua',headline:'Seu bairro, nossa atenção',tagline:'Água, gás e entregas na região.',
 theme:'gold',referralCode:ref,merchantId:shopId,
 city:'São Gabriel',state:'RS',items:[{code:'P13',name:'Gás P13'},{code:'WATER20',name:'Água mineral 20 L'}],
 photos:[],details:'',agendaSlug:'',listingId:'',vertical:''};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let tab;for(let i=0;i<35&&!tab;i++){
 try{const response=await fetch(cdp+'/json/new?'+encodeURIComponent(base+'/p/index.html'),{method:'PUT'});
  if(response.ok)tab=await response.json()}catch{}
 if(!tab)await wait(250);
}
assert.ok(tab?.webSocketDebuggerUrl,'Chrome endpoint unavailable');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome websocket timeout')),10000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
 ws.addEventListener('error',reject,{once:true});});
let seq=0;const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));const p=pending.get(m.id);if(!p)return;
 pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);});
const send=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Chrome '+method+' timed out'));},15000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
async function evaluate(expression){
 const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 return result.result?.value;
}
const rows=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 const injected="(()=>{history.replaceState(null,'','/p/"+fixture.slug+"/');"+
  "const orig=window.fetch.bind(window);window.fetch=(url,opts)=>"+
  "String(url).includes('/functions/v1/participant-pages')"+
  "?Promise.resolve(new Response(JSON.stringify("+JSON.stringify(fixture)+"),"+
  "{status:200,headers:{'Content-Type':'application/json'}})):orig(url,opts);})();";
 const firstScript=await send('Page.addScriptToEvaluateOnNewDocument',{source:injected});
 for(const width of [320,360,390,760,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,screenWidth:width,screenHeight:900,deviceScaleFactor:1,mobile:width<760});
  await send('Page.navigate',{url:base+'/p/index.html'});
  let ready=false;for(let i=0;i<55;i++){
   ready=await evaluate("document.querySelector('#content')?.hidden===false&&document.querySelector('#main-action')?.href.includes('seller=')&&document.querySelector('link[href=\"/p/style.css\"]')?.sheet!=null");
   if(ready)break;await wait(140);
  }
  assert.equal(ready,true,'Real participant page must render at '+width);
  const data=await evaluate("(()=>{const c=document.querySelector('#main-action'),r=c.getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,title:document.querySelector('#page-title').textContent,theme:document.body.className,href:c.href,ctaVisible:r.width>0&&r.height>45,ctaFits:r.left>=-1&&r.right<=innerWidth+1,items:[...document.querySelectorAll('#items a')].map(x=>x.href),photos:[...document.querySelectorAll('#items .product-visual')].map(e=>({cls:e.className,background:getComputedStyle(e).backgroundImage})),coverCount:document.querySelectorAll('#cover-products .product-visual').length,coverHidden:document.querySelector('#cover-products').hidden,hidden:document.querySelector('#missing').hidden}})()");
  assert.equal(data.title,fixture.headline);assert.equal(data.theme,'theme-gold');
  assert.equal(data.hidden,true);
  assert.ok(data.scroll<=width+2,'Horizontal overflow '+width+' '+data.scroll);
  assert.ok(data.ctaVisible&&data.ctaFits,'Main merchant CTA clipped '+width);
  const u=new URL(data.href);
  assert.equal(u.origin,'https://tamao.com.br');
  assert.equal(u.searchParams.get('ref'),ref);
  assert.equal(u.searchParams.get('seller'),shopId);
  assert.equal(u.hash,'#order');
  assert.equal(data.items.length,2);
  assert.equal(data.photos.length,2,'Merchant catalog must show two real product images');
  assert.ok(data.photos[0].cls.includes('product-visual-gas'));
  assert.ok(data.photos[1].cls.includes('product-visual-water'));
  for(const photo of data.photos)assert.match(photo.background,/tamao-products-sprite\.webp/);
  assert.equal(data.coverCount,2,'Real products also illustrate the shop hero');
  assert.equal(data.coverHidden,false);
  for(const link of data.items){
   const item=new URL(link);
   assert.equal(item.searchParams.get('seller'),shopId);
   assert.equal(item.searchParams.get('ref'),ref);
   assert.ok(['P13','WATER20'].includes(item.searchParams.get('item')));
  }
  rows.push({width,scroll:data.scroll,products:data.items.length,cta:data.href});
  if([390,1280].includes(width)){
   const screenshot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
   fs.writeFileSync(path.join(outDir,'participant-native-v1-1072-'+width+'.png'),Buffer.from(screenshot.data,'base64'));
  }
 }
 // A real published professional photo must become the hero cover, not only
 // remain buried below the text. All synthetic data stays in local Chrome.
 await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:firstScript.identifier});
 const listingId='33333333-2222-4333-8444-555555555555';
 const key='11111111-2222-4333-8444-555555555555/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg';
 const profile={...fixture,kind:'listing',slug:'profissional-de-teste-1075',
  name:'Profissional Exemplo',headline:'Atendimento personalizado',
  listingId,vertical:'professionals',merchantId:'',items:[],photos:[key],theme:'rose'};
 const source="(()=>{history.replaceState(null,'','/p/"+profile.slug+"/');"+
  "const orig=window.fetch.bind(window);window.fetch=(url,opts)=>"+
  "String(url).includes('/functions/v1/participant-pages')"+
  "?Promise.resolve(new Response(JSON.stringify("+JSON.stringify(profile)+"),"+
  "{status:200,headers:{'Content-Type':'application/json'}})):orig(url,opts);})();";
 await send('Page.addScriptToEvaluateOnNewDocument',{source});
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,screenWidth:390,screenHeight:900,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:base+'/p/index.html'});
 let coverReady=false;
 for(let i=0;i<55;i++){
  coverReady=await evaluate("document.querySelector('#visual-card.over-photo')!==null&&document.querySelector('.visual-photo')!==null&&document.querySelector('#content')?.hidden===false");
  if(coverReady)break;await wait(140);
 }
 assert.equal(coverReady,true,'Published professional cover photo must render');
 const listingResult=await evaluate("(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,hero:document.querySelector('.visual-photo')?.src,images:document.querySelectorAll('#photos img').length,headline:document.querySelector('#page-title').textContent,destination:document.querySelector('#main-action')?.href}))()");
 assert.equal(listingResult.headline,'Atendimento personalizado');
 assert.ok(listingResult.hero?.endsWith(key),'Use only approved media belonging to the published listing');
 assert.equal(listingResult.images,1,'Photo remains available in portfolio');
 assert.ok(listingResult.scroll<=392,'Professional hero must not cause mobile overflow');
 const destination=new URL(listingResult.destination);
 assert.equal(destination.searchParams.get('listing'),listingId);
 assert.equal(destination.searchParams.get('ref'),ref);
 assert.equal(destination.hash,'#professionals');
}finally{
 fs.writeFileSync(path.join(outDir,'participant-native-browser-v1-1072.json'),JSON.stringify(rows,null,2)+'\n');
 ws.close();await fetch(cdp+'/json/close/'+tab.id).catch(()=>{});
}
console.log('V1.1075 PASS — real-data merchant page, explicit chosen seller and original referral in mobile/desktop Chromium.');
