import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const premium=read('js/sponsors-premium.js');
const planner=read('js/ads-planner.js');
const css=read('css/public-ux.css');
const audit=read('.github/workflows/audit.yml');

assert.doesNotThrow(()=>new vm.Script(premium));
assert.doesNotThrow(()=>new vm.Script(planner));
assert.match(audit,/tests\/sponsor-creative-studio-v1-1094\.mjs/);
assert.match(css,/sponsor-demo-goals button\[aria-pressed="true"\]/);
assert.match(css,/@media\(max-width:360px\)/);
assert.match(css,/sponsor-premium-art-caption/);

const state=new Map(), storage={
 getItem:key=>state.get(key)||null,setItem:(key,value)=>state.set(key,value)
};
let writes=0,scrolls=0,updates=0;
const inputs={
 'sponsor-demo-company':{value:''},'sponsor-demo-message':{value:''},
 'sponsor-ad-company':{value:''},'sponsor-ad-title':{value:''},
 'sponsor-ad-copy':{value:''}
};
const fields=Object.fromEntries(['brand','headline','copy','label','symbol','goalLabel','monogram']
 .map(name=>[name,[{textContent:''},{textContent:''},{textContent:''}]]));
function option(key,attr){return {
 attrs:{},getAttribute:k=>k===attr?key:this.attrs[k],
 setAttribute(k,value){this.attrs[k]=value}
};}
const sectors=['commerce','services','food'].map(k=>option(k,'data-sponsor-demo-sector'));
const goals=['intro','news','visit'].map(k=>option(k,'data-sponsor-demo-goal'));
const art={setAttribute(){}};
const document={
 getElementById(id){if(inputs[id])return inputs[id];if(id==='sponsor-demo-status')return {textContent:''};
  if(id==='sponsor-pricing')return {scrollIntoView(){scrolls++},focus(){}};return null;},
 querySelector:key=>key==='.sponsor-premium-ad-art'?art:null,
 querySelectorAll:key=>{
  const m=/^\[data-sponsor-demo="(\w+)"\]$/.exec(key);
  if(m)return fields[m[1]]||[];
  if(key==='[data-sponsor-demo-sector]')return sectors;
  if(key==='[data-sponsor-demo-goal]')return goals;
  return [];
 }
};
const g={sessionStorage:storage,matchMedia:()=>({matches:true}),
 tamaoAdsPlannerLoad:()=>{},tamaoAdsPlannerSection:()=>'<p>Formulário oficial</p>',
 tamaoAdsUpdateCreativePreview:()=>{updates++}};
const context={document,globalThis:g,shell:x=>x,liveInvoke:()=>{writes++}};
vm.createContext(context);
vm.runInContext(premium+';this.view=sponsorsLandingPremium;this.handlers={company:sponsorDemoType,goal:sponsorDemoGoal,sector:sponsorDemoSelect,message:sponsorDemoMessage,continue:sponsorDemoContinue,presentation:sponsorDemoPresentation};',context);
const html=context.view();
assert.match(html,/ESTÚDIO DE ANÚNCIOS/);
assert.match(html,/id="sponsor-demo-message"/);
assert.match(html,/data-sponsor-demo-goal="news"/);
assert.match(html,/data-sponsor-demo="monogram"/);
assert.match(html,/aria-label="Objetivo da campanha"/);
assert.match(html,/onclick="sponsorDemoGoal\('news'\)"/);
assert.match(html,/data-sponsor-demo="brand"/);
assert.equal(g.tamaoSponsorDemoCreative(),null,'Merely previewing must never authorize the real form');
assert.equal(context.handlers.goal('__proto__'),false);
assert.equal(context.handlers.goal('news'),true);
assert.equal(context.handlers.sector('services'),true);
assert.equal(fields.headline[0].textContent,'Tem novidade nos nossos serviços.');
assert.equal(goals[1].attrs['aria-pressed'],'true');
assert.equal(sectors[1].attrs['aria-pressed'],'true');
inputs['sponsor-demo-company'].value='Ateliê & Cia';
assert.equal(context.handlers.company(),true);
assert.equal(fields.monogram[0].textContent,'A');

inputs['sponsor-demo-message'].value='<img src=x onerror=alert(1)> & Cia';
assert.equal(context.handlers.message(),true);
assert.equal(fields.copy[0].textContent,'<img src=x onerror=alert(1)> & Cia');
const escaped=context.view();
assert.match(escaped,/&lt;img src=x onerror=alert\(1\)&gt; &amp; Cia/);
assert.doesNotMatch(escaped,/<img src=x onerror=/);
assert.equal(writes,0,'Live previews must not create campaigns or views');
assert.equal(g.tamaoSponsorDemoCreative(),null,'Typing cannot cause a background draft handoff');

inputs['sponsor-ad-title'].value='Título já editado';
assert.equal(context.handlers.continue(),true);
assert.equal(scrolls,1);
assert.equal(updates,1);
assert.equal(inputs['sponsor-ad-title'].value,'Título já editado','Do not overwrite existing drafts');
assert.equal(inputs['sponsor-ad-copy'].value,inputs['sponsor-demo-message'].value);
assert.equal(inputs['sponsor-ad-company'].value,'Ateliê & Cia');
assert.equal(g.tamaoSponsorDemoCreative().headline,'Tem novidade nos nossos serviços.');
assert.equal(g.tamaoSponsorDemoCreative().copy,inputs['sponsor-demo-message'].value);
assert.equal(JSON.parse(state.get('tamao-sponsor-showcase-v1092')).goal,'news');

const verified={document:{getElementById:()=>null},globalThis:{
 liveRuntime:{session:{user:{id:'confirmed-account',email_confirmed_at:'2026-11-20',is_anonymous:false}}},
 liveReady:()=>true,tamaoSponsorDemoCompany:g.tamaoSponsorDemoCompany,
 tamaoSponsorDemoCreative:g.tamaoSponsorDemoCreative},URL,console};
vm.createContext(verified);
vm.runInContext(planner+';this.form=tamaoAdsCampaignForm;this.safe=tamaoAdsPublicDemoCreative;',verified);
const form=verified.form();
assert.match(form,/id="sponsor-ad-title"/);
assert.match(form,/value="Tem novidade nos nossos serviços\."/);
assert.match(form,/&lt;img src=x onerror=alert\(1\)&gt; &amp; Cia<\/textarea>/);
assert.equal(verified.safe('__proto__'),'');
assert.equal(writes,0,'No publication, payment or backend submission');
console.log('PASS V1.1094: studio intent and text, brand monogram, escaped content, preserved edits, verified draft prefill, no backend writes.');
