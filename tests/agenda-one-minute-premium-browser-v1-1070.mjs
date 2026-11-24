import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Browser integration is strictly localhost, with synthetic UI data and NO live API writes.
const origin=String(process.env.TAMAO_VISUAL_BASE||'http://127.0.0.1:4179').replace(/\/$/,'');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'Never target production');
const debug=String(process.env.TAMAO_VISUAL_CDP||'http://127.0.0.1:9230').replace(/\/$/,'');
const out=path.resolve(process.env.TAMAO_VISUAL_OUTPUT||'public-visual-screenshots');
fs.mkdirSync(out,{recursive:true});
const sleep=n=>new Promise(ok=>setTimeout(ok,n));
let tab;
for(let i=0;i<40&&!tab;i++){
 try{const r=await fetch(debug+'/json/new?'+encodeURIComponent(origin+'/agenda/'),{method:'PUT'});if(r.ok)tab=await r.json();}catch{}
 if(!tab)await sleep(200);
}
assert.ok(tab?.webSocketDebuggerUrl,'Chrome remote debugging unavailable');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{
 const timer=setTimeout(()=>fail(Error('Chrome websocket timeout')),10000);
 ws.addEventListener('open',()=>{clearTimeout(timer);ok()},{once:true});
 ws.addEventListener('error',fail,{once:true});
});
let seq=0;const pending=new Map();
ws.addEventListener('message',event=>{
 const res=JSON.parse(String(event.data)),p=pending.get(res.id);
 if(!p)return;pending.delete(res.id);clearTimeout(p.timer);
 res.error?p.fail(Error(res.error.message)):p.ok(res.result);
});
function send(method,params={}){
 return new Promise((ok,fail)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP timeout '+method));},20000);
  pending.set(id,{ok,fail,timer});ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return r.result?.value;
}
function installFixture(){
 window.render=()=>{};
 const owner='10700000-0000-4000-8000-000000000001';
 const page={id:'10700000-0000-4000-8000-000000000011',owner_id:owner,
  title:'Barbearia QA Premium',slug:'barbearia-qa-ci',published:true,city:'São Gabriel',
  about:'Atendimento com hora marcada.',photo_paths:[],photos:[],
  services:[{id:'10700000-0000-4000-8000-000000000021',title:'Corte QA',price_cents:6000,duration_min:30,active:true}],
  staff:[{id:'10700000-0000-4000-8000-000000000031',name:'Equipe QA',active:true}]};
 agendaRuntime.page=page;agendaRuntime.services=page.services;agendaRuntime.staff=page.staff;
 agendaRuntime.user={id:owner};agendaRuntime.design=null;
 agendaRuntime.designDraft=null;agendaRuntime.designDraftOwnerId='';
 agendaRuntime.designUnavailable=false;agendaRuntime.busy=false;
 const root=document.createElement('main');root.className='section agenda';
 document.body.replaceChildren(root);
 root.innerHTML=agendaDesignOwnerEditor();
 return {
  themes:root.querySelectorAll('input[name=template]').length,
  selected:root.querySelector('input[name=template]:checked')?.value,
  advancedClosed:!root.querySelector('.agenda-design-advanced').open,
  noRequiredExtras:!root.querySelector('.agenda-design-advanced [required]'),
  primary:root.querySelector('.agenda-design-quick-actions .primary')?.textContent
 };
}
function editorGeometry(){
 const app=document.getElementById('agenda-design-editor');
 const button=app.querySelector('.agenda-design-quick-actions .primary');
 const rect=button.getBoundingClientRect();
 return {
  width:innerWidth,scroll:document.documentElement.scrollWidth,
  buttonInside:rect.left>=0&&rect.right<=innerWidth+2&&rect.height>=43,
  preview:!!app.querySelector('.agenda-design-preview-wrap[open]'),
  advanced:app.querySelector('.agenda-design-advanced').open
 };
}
async function chooseAndSave(){
 const form=document.getElementById('agenda-design-form');
 form.querySelector('[name=template][value=elegance]').click();
 const palette=form.querySelector('[name=primary_color]').value.toLowerCase()==='#553c4a'&&
  form.querySelector('[name=accent_color]').value.toLowerCase()==='#e8b5b9';
 const preview=!!document.querySelector('.agenda-design-live.theme-elegance');
 let calls=0;
 agendaRuntime.client={from:table=>{
  if(table!=='agenda_page_design')throw Error('Visual editor tried to modify '+table);
  return {upsert:data=>{
   calls++;return {select:()=>({single:async()=>({data,error:null})})};
  }};
 }};
 await agendaDesignSave({target:form,preventDefault(){}});
 return {palette,preview,calls,stored:agendaRuntime.design?.template};
}
function renderPublic(){
 const page=agendaRuntime.page;
 agendaRuntime.publicProfile=page;
 const root=document.createElement('main');root.className='section agenda agenda-standalone-profile';
 document.body.replaceChildren(root);
 root.innerHTML=agendaDesignPublicView(page,'<section class="agenda-panel" id="existing-booking">REAL BOOKING</section>');
 return {
  width:innerWidth,scroll:document.documentElement.scrollWidth,
  booking:root.querySelector('#existing-booking')?.textContent,
  services:root.querySelectorAll('.agenda-premium-service').length,
  menu:!!root.querySelector('.agenda-premium-nav')
 };
}
const results=[];
try{
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,screenWidth:390,screenHeight:900,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:origin+'/agenda/'});
 let ready=false;
 for(let i=0;i<90;i++){
  ready=await evaluate("typeof agendaDesignOwnerEditor==='function'&&typeof agendaRuntime!=='undefined'&&!!document.querySelector('link[href*=\"agenda-design.css\"]')?.sheet");
  if(ready)break;await sleep(150);
 }
 assert.equal(ready,true,'Editor scripts/styles must load from actual Agenda');
 const landing=await evaluate(`(()=>{
  const section=document.createElement('section');section.className='section agenda';
  document.body.appendChild(section);
  const style=getComputedStyle(section),layout={display:style.display,gap:parseFloat(style.rowGap)};
  section.remove();
  const link=[...document.querySelectorAll('.agenda-top-links a')].find(a=>a.textContent.trim()==='Minha agenda');
  const previousRender=window.render,previousMode=agendaRuntime.ownerMode,previousError=agendaRuntime.error;
  const before=location.href;let renders=0;
  window.render=()=>{renders++};
  agendaRuntime.ownerMode=false;
  try{link?.click();return {...layout,found:!!link,ownerMode:agendaRuntime.ownerMode,sameUrl:location.href===before,renders}}
  finally{window.render=previousRender;agendaRuntime.ownerMode=previousMode;agendaRuntime.error=previousError}
 })()`);
 assert.equal(landing.display,'grid','Standalone Agenda must preserve the shared layout grid');
 assert.ok(landing.gap>=12,'Agenda sections need breathing space');
 assert.ok(landing.found&&landing.ownerMode&&landing.sameUrl&&landing.renders===1,'My Agenda should open the owner flow directly without reloading');

 for(const width of [320,360,390,768,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,screenWidth:width,screenHeight:900,deviceScaleFactor:1,mobile:width<768});
  const setup=await evaluate('('+installFixture.toString()+')()');
  assert.equal(setup.themes,3);
  assert.equal(setup.selected,'black-gold');
  assert.equal(setup.advancedClosed,true);
  assert.equal(setup.noRequiredExtras,true);
  assert.match(setup.primary,/Usar este visual/);
  const g=await evaluate('('+editorGeometry.toString()+')()');
  assert.ok(g.scroll<=width+2,'Editor overflow: '+width+' '+g.scroll);
  assert.equal(g.buttonInside,true,'Unreachable main button: '+width);
  assert.equal(g.preview,true);assert.equal(g.advanced,false);
  results.push({screen:'owner',...g});
  if([390,1280].includes(width)){
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   fs.writeFileSync(path.join(out,'agenda-owner-quick-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
 }
 const saved=await evaluate('('+chooseAndSave.toString()+')()');
 assert.equal(saved.palette,true,'Color palette must change with theme');
 assert.equal(saved.preview,true,'Preview must change without reload');
 assert.equal(saved.calls,1,'Save only one design, no other data');
 assert.equal(saved.stored,'elegance');
 for(const width of [320,390,768,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,screenWidth:width,screenHeight:900,deviceScaleFactor:1,mobile:width<768});
  const view=await evaluate('('+renderPublic.toString()+')()');
  assert.ok(view.scroll<=width+2,'Public page overflow: '+width+' '+view.scroll);
  assert.equal(view.booking,'REAL BOOKING','Booking must use the official form markup');
  assert.equal(view.services,1,'Only real services from fixture appear');
  assert.equal(view.menu,true);
  results.push({screen:'public',...view});
  if([390,1280].includes(width)){
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   fs.writeFileSync(path.join(out,'agenda-public-quick-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
 }
}finally{
 fs.writeFileSync(path.join(out,'agenda-one-minute-premium-browser-v1-1070.json'),JSON.stringify(results,null,2)+'\n');
 ws.close();
 await fetch(debug+'/json/close/'+tab.id).catch(()=>{});
}
console.log('V1.1070 PASS: real Chrome 320/360/390/768/1280 owner/editor CTA, instant theme, one write, public booking and no overflow.');
