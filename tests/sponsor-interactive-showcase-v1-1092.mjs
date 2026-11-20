import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sponsor=read('js/sponsors-premium.js');
const planner=read('js/ads-planner.js');
const css=read('css/public-ux.css');
const audit=read('.github/workflows/audit.yml');
assert.doesNotThrow(()=>new vm.Script(sponsor,{filename:'js/sponsors-premium.js'}));
assert.doesNotThrow(()=>new vm.Script(planner,{filename:'js/ads-planner.js'}));
assert.match(audit,/tests\/sponsor-interactive-showcase-v1-1092\.mjs/);
assert.match(css,/\.sponsor-demo-options button\[aria-pressed="true"\]/);
assert.match(css,/@media\(max-width:360px\)/);
assert.match(css,/\.sponsor-premium-ad-art\[data-demo-sector="food"\]/);

const entries=new Map();
const storage={
 getItem:k=>entries.get(k)||null,
 setItem:(k,v)=>{entries.set(k,v)}
};
let jumps=0, serverWrites=0;
const nameInput={value:'',setAttribute(){}};
const status={textContent:''};
const art={attrs:{},setAttribute(k,v){this.attrs[k]=v}};
const fields=Object.fromEntries(['brand','headline','copy','label','symbol'].map(k=>
 [k,[{textContent:''},{textContent:''},{textContent:''}]]));
const options=['commerce','services','food'].map(key=>({
 key,attrs:{},
 getAttribute(k){return k==='data-sponsor-demo-sector'?key:this.attrs[k]},
 setAttribute(k,v){this.attrs[k]=v}
}));
const document={
 getElementById(id){
  if(id==='sponsor-demo-company')return nameInput;
  if(id==='sponsor-demo-status')return status;
  if(id==='sponsor-pricing')return {scrollIntoView(){jumps++},focus(){}};
  return null;
 },
 querySelector(selector){
  if(selector==='.sponsor-premium-ad-art')return art;
  return null;
 },
 querySelectorAll(selector){
  const m=/^\[data-sponsor-demo="(\w+)"\]$/.exec(selector);
  if(m)return fields[m[1]]||[];
  if(selector==='[data-sponsor-demo-sector]')return options;
  return [];
 }
};
const context={
 document,
 shell:x=>x,
 globalThis:{
  sessionStorage:storage,
  matchMedia:()=>({matches:true}),
  tamaoAdsPlannerLoad:()=>{},
  tamaoAdsPlannerSection:()=>'<div id="real-ads-form"></div>',
  tamaoAdsUpdateCreativePreview:()=>{}
 },
 console,
 liveInvoke:()=>{serverWrites++;throw Error('Preview cannot submit or publish')}
};
vm.createContext(context);
vm.runInContext(sponsor+';this.show=sponsorsLandingPremium;this.handlers={type:sponsorDemoType,select:sponsorDemoSelect,continue:sponsorDemoContinue,brand:sponsorDemoPresentation};',context);
let html=context.show();
assert.match(html,/id="sponsor-demo-company"/);
assert.match(html,/oninput="sponsorDemoType\(\)"/);
assert.match(html,/sponsorDemoContinue\(\)/);
assert.match(html,/Prévia no navegador|Experimente sem cadastro e sem enviar dados/);
assert.equal((html.match(/data-sponsor-demo-sector="/g)||[]).length,3);
assert.match(html,/data-sponsor-demo="brand"/);
assert.match(html,/sponsor-placement-gallery/);
assert.equal(context.handlers.select('__proto__'),false,'Invalid sector must be rejected');
assert.equal(context.handlers.select('food'),true);
assert.equal(art.attrs['data-demo-sector'],'food');
assert.equal(fields.headline[0].textContent,'Novos sabores para descobrir na cidade.');
assert.equal(options[2].attrs['aria-pressed'],'true');
assert.equal(options[0].attrs['aria-pressed'],'false');
assert.match(status.textContent,/gastronomia/);

nameInput.value='Ateliê & Cia <img onerror="alert(1)">';
assert.equal(context.handlers.type(),true);
assert.equal(fields.brand[0].textContent,nameInput.value);
assert.equal(fields.brand[2].textContent,nameInput.value);
html=context.show();
assert.ok(html.includes('Ateliê &amp; Cia &lt;img onerror=&quot;alert(1)&quot;&gt;'));
assert.doesNotMatch(html,/Ateliê & Cia <img/,'User input must never be emitted as markup');
assert.equal(context.globalThis.tamaoSponsorDemoCompany(),'',
 'Typing a company name alone does not authorize any campaign prefill');
assert.equal(context.handlers.continue(),true);
assert.equal(jumps,1);
assert.equal(context.globalThis.tamaoSponsorDemoCompany(),nameInput.value,
 'Only explicit continuation prepares the brand name for the draft');
const stored=JSON.parse(storage.getItem('tamao-sponsor-showcase-v1092'));
assert.equal(stored.sector,'food');
assert.equal(stored.preparing,true);
assert.equal(serverWrites,0,'Preview must never hit backend, publish, bill or count a view');

// Recreate page after an OTP redirect in the same browser tab.
const next={
 shell:x=>x,
 document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]},
 globalThis:{sessionStorage:storage,tamaoAdsPlannerLoad:()=>{},
  tamaoAdsPlannerSection:()=>'<div id="real-ads-form"></div>'}
};
vm.createContext(next);
vm.runInContext(sponsor+';this.show=sponsorsLandingPremium;',next);
assert.match(next.show(),/data-demo-sector="food"/);
assert.ok(next.show().includes('Ateliê &amp; Cia &lt;img'));
assert.equal(next.globalThis.tamaoSponsorDemoCompany(),nameInput.value);

// The actual identified advertiser draft escapes the name; it is not submitted.
const plannerCtx={
 document:{getElementById:()=>null},
 globalThis:{liveRuntime:{session:{user:{id:'verified',email_confirmed_at:'2026-11-20',is_anonymous:false}}},
  liveReady:()=>true,tamaoSponsorDemoCompany:next.globalThis.tamaoSponsorDemoCompany},
 URL,console,liveInvoke:()=>{serverWrites++;throw Error('No server calls expected')}
};
vm.createContext(plannerCtx);
vm.runInContext(planner+';this.attrs=tamaoAdsPublicDemoCompanyAttr;this.form=tamaoAdsCampaignForm;',plannerCtx);
const attr=plannerCtx.attrs();
assert.equal(attr,' value="Ateliê &amp; Cia &lt;img onerror=&quot;alert(1)&quot;&gt;"');
const form=plannerCtx.form();
assert.match(form,/id="sponsor-ad-company"/);
assert.ok(form.includes(attr),'The real campaign form must preserve the escaped brand name');
assert.equal(serverWrites,0,'No campaign is submitted just by previewing or prefilling');

// No account? no prefill even if the same company name exists in storage.
const emptyCtx={globalThis:{tamaoSponsorDemoCompany:()=>''}};
vm.createContext(emptyCtx);
vm.runInContext(planner.slice(planner.indexOf('function tamaoAdsPublicDemoCompanyAttr()'),planner.indexOf('function tamaoAdsCampaignForm(){'))+
 ';this.attr=tamaoAdsPublicDemoCompanyAttr;',emptyCtx);
assert.equal(emptyCtx.attr(),'');
console.log('PASS V1.1092: dynamic sector and brand preview, safe HTML/text, one-tab restore, consented draft prefill, no backend writes or money.');
