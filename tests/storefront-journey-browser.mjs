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
async function waitFor(expression,label){
 for(let attempt=0;attempt<60;attempt++){
  if(await run(expression))return;
  await sleep(150);
 }
 throw Error('UI not ready: '+label);
}
async function geometry(label,width){
 const info=await run(`(()=>{
  const title=document.querySelector('main h1'),cards=[...document.querySelectorAll('.home-discover-tile')].filter(x=>!x.hidden);
  const r=cards[0]?.getBoundingClientRect();
  return {url:location.hash,width:innerWidth,documentWidth:document.documentElement.scrollWidth,
   headings:document.querySelectorAll('main h1').length,title:title?.textContent,
   firstProductTop:r?.top,firstProductBottom:r?.bottom,
   visibleProducts:cards.length,
   brokenImages:[...document.images].filter(x=>x.complete&&x.naturalWidth===0).map(x=>x.getAttribute('src'))};
 })()`);
 assert.equal(info.width,width);
 assert.ok(info.documentWidth<=width+2,label+' '+width+': horizontal overflow '+info.documentWidth);
 assert.equal(info.headings,1,label+': one page heading');
 assert.equal(info.brokenImages.length,0,label+': broken image');
 results.push({label,...info});return info;
}
async function screenshot(name){
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
 fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));
}
try{
 await send('Page.enable');await send('Runtime.enable');
 // The public build has no commercial runtime. Test account access also with
 // public package RPCs unavailable: sign-in must remain visible independently.
 await send('Network.enable');
 await send('Network.setBlockedURLs',{urls:['*supabase.co*','*challenges.cloudflare.com*']});
 for(const width of [320,360,390,598,599,600,758,759,760,768,978,979,980,1024,1098,1099,1100,1280,1440,1920]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<760,screenWidth:width,screenHeight:900});
  await send('Storage.clearDataForOrigin',{origin,storageTypes:'local_storage'});
  await send('Page.navigate',{url:origin+'/?ux-check='+width+'#home'});
  await waitFor("!!document.querySelector('.tamao-storefront .home-discover-tile')&&!!document.querySelector('link[href*=\"public-ux.css\"]')?.sheet",'home');
  const home=await geometry('home',width);
  assert.equal(home.visibleProducts,6,'Six real catalogue choices');
  assert.ok(home.firstProductTop<820,'Products must start within the first 900px viewport at '+width);
  if(width>=1100)assert.ok(home.firstProductBottom<900,'Complete desktop catalogue above the fold');
  await run("document.querySelector('.city-price-chooser>summary').click()");
  await geometry('city chooser',width);
  await run("document.querySelector('.city-price-chooser>summary').click()");
  await run("document.querySelector('[data-tamao-filter=water]').click()");
  assert.ok(await run("[...document.querySelectorAll('.home-discover-tile')].filter(x=>!x.hidden).every(x=>x.dataset.tamaoDiscoverKind==='water')"),'Category filter works');
  await run("[...document.querySelectorAll('.home-discover-tile')].find(x=>!x.hidden).click()");
  await waitFor("location.hash==='#order'&&!!document.querySelector('.buyer-cart-selection')",'selected basket');
  let data=await run("({editorOpen:document.querySelector('.buyer-cart-edit').open,steps:document.querySelectorAll('.buyer-journey button').length,cart:document.querySelector('.buyer-cart-selection').textContent})");
  assert.equal(data.editorOpen,false,'Existing selection starts summarized');
  assert.equal(data.steps,4,'One navigation button per stage');
  assert.match(data.cart,/1 unidade selecionada/);
  await geometry('order',width);
  await run("document.querySelector('.buyer-journey button').click()");
  await waitFor("document.querySelector('.buyer-cart-edit').open",'editable basket');
  await run("[...document.querySelectorAll('.buyer-cart-item')].find(x=>x.dataset.buyerCartSelected==='true').querySelector('button[aria-label=Aumentar]').click()");
  await waitFor("document.querySelector('.buyer-cart-selection')?.textContent.includes('2 unidades selecionadas')&&document.querySelector('.buyer-cart-edit').open",'quantity change keeps editor open');
  await send('Page.reload');
  await waitFor("document.querySelector('.buyer-cart-selection')?.textContent.includes('2 unidades selecionadas')",'basket survives refresh');
  if([390,1440].includes(width))await screenshot('checkout-'+width);
  await send('Page.navigate',{url:origin+'/#club'});
  await waitFor("!!document.querySelector('.tamao-club-access')&&!!document.querySelector('link[href*=\"public-ux.css\"]')?.sheet",'club');
  const club=await run("(()=>{const form=document.querySelector('.tamao-club-access'),r=form.getBoundingClientRect();return {shown:r.width>0&&r.height>0,actions:[...form.querySelectorAll('button[type=submit]')].map(x=>x.value),packageHidden:document.querySelector('.tamao-coupon-price-board')?.hidden}})()");
  assert.ok(club.shown,'Access independent of available packages');
  assert.deepEqual(club.actions,['login','register'],'Existing and new accounts use separate flows');
  assert.equal(club.packageHidden,true,'An unavailable RPC cannot advertise package prices');
  await geometry('club',width);
  if([390,1440].includes(width))await screenshot('club-'+width);
 }
 // Leave a clean store overview as the primary visual evidence.
 await send('Storage.clearDataForOrigin',{origin,storageTypes:'local_storage'});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/#home'});
 await waitFor("!!document.querySelector('.tamao-storefront')&&!!document.querySelector('link[href*=\"public-ux.css\"]')?.sheet",'final home');
 await screenshot('storefront-1440');
}finally{
 fs.writeFileSync(path.join(out,'storefront-journey-results.json'),JSON.stringify(results,null,2)+'\n');
 ws.close();
 await fetch(debug+'/json/close/'+targetId(),{method:'GET'}).catch(()=>{});
}
function targetId(){return tab.id;}
console.log('PASS: storefront, product filters, editable basket, refresh recovery and Club at 20 viewport/breakpoint widths. No email or transaction sent.');
