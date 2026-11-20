import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const studio=read('js/sponsors-premium.js');
const official=read('js/ads-planner.js');
const css=read('css/public-ux.css');
const audit=read('.github/workflows/audit.yml');
assert.doesNotThrow(()=>new vm.Script(studio));
assert.doesNotThrow(()=>new vm.Script(official));
assert.ok(audit.includes('tests/sponsor-campaign-brief-v1-1096.mjs'));
assert.ok(css.includes('grid-template-areas:'));
assert.ok(css.includes('.sponsor-demo-plans button[aria-pressed="true"]'));
assert.ok(css.includes('@media(max-width:360px)'));

const storageData=new Map(),storage={getItem:key=>storageData.get(key)||null,setItem:(key,v)=>storageData.set(key,v)};
const objects={},status={textContent:''};let scrolled=0,posted=0,chosen=[],rendered=0;
const plans=[1990,4990,9990,19990].map(amount=>({
 amount,attrs:{},
 getAttribute:k=>k==='data-sponsor-demo-budget'?String(amount):this.attrs[k],
 setAttribute(k,value){this.attrs[k]=value}
}));
const previewTexts={planLabel:[{textContent:''}]};
const doc={
 getElementById(id){
  if(id==='sponsor-demo-status')return status;
  if(id==='sponsor-pricing')return {scrollIntoView(){scrolled++},focus(){}};
  return objects[id]||null;
 },
 querySelector:()=>null,
 querySelectorAll:selector=>{
  if(selector==='[data-sponsor-demo-budget]')return plans;
  if(selector==='[data-sponsor-demo="planLabel"]')return previewTexts.planLabel;
  return [];
 }
};
const g={sessionStorage:storage,matchMedia:()=>({matches:true}),
 tamaoAdsPlannerLoad:()=>{},tamaoAdsPlannerSection:()=>'<section>official real planner</section>',
 tamaoAdsChooseBudget:v=>{chosen.push(v);return true;},
 tamaoAdsUpdateCreativePreview:()=>{rendered++}};
const context={document:doc,shell:x=>x,globalThis:g,
 liveInvoke:()=>{posted++;throw new Error('Forbidden live call');}};
vm.createContext(context);
vm.runInContext(studio+';this.page=sponsorsLandingPremium;this.choose=sponsorDemoBudget;this.continueDraft=sponsorDemoContinue;',context);
const initial=context.page();
assert.equal((initial.match(/data-sponsor-demo-budget="/g)||[]).length,4);
assert.ok(initial.includes('R$ 19,90'));
assert.ok(initial.includes('R$ 49,90'));
assert.ok(initial.includes('R$ 99,90'));
assert.ok(initial.includes('R$ 199,90'));
assert.ok(initial.includes('data-sponsor-demo-budget="4990" aria-pressed="true"'));
assert.equal(g.tamaoSponsorDemoBudget(),null,'Preview is not consent to fill a commercial form');
assert.equal(context.choose('__proto__'),false);
assert.equal(context.choose(Infinity),false);
assert.equal(context.choose(999),false);
assert.equal(context.choose(9990),true);
assert.equal(plans[2].attrs['aria-pressed'],'true');
assert.equal(plans[1].attrs['aria-pressed'],'false');
assert.equal(previewTexts.planLabel[0].textContent,'R$ 99,90 · 30 dias');
assert.ok(status.textContent.includes('antes da contratação') || status.textContent.includes('revisão'));
assert.equal(g.tamaoSponsorDemoBudget(),null);
assert.equal(posted,0);
assert.equal(chosen.length,0,'Selecting preview must not mutate official form automatically');
assert.equal(context.continueDraft(),true);
assert.equal(scrolled,1);
assert.deepEqual(chosen,[9990]);
assert.equal(g.tamaoSponsorDemoBudget(),9990);
assert.equal(JSON.parse(storageData.get('tamao-sponsor-showcase-v1092')).budget,9990);
assert.equal(posted,0);

const plannerContext={document:{getElementById:()=>null},globalThis:{
 liveReady:()=>false,liveRuntime:{session:null},
 tamaoSponsorDemoBudget:g.tamaoSponsorDemoBudget
},URL,console};
vm.createContext(plannerContext);
vm.runInContext(official+';this.planner=tamaoAdsPlannerSection;',plannerContext);
let markup=plannerContext.planner();
assert.ok(markup.includes('data-sponsor-budget="9990" aria-pressed="true"'));
assert.ok(markup.includes('<option value="9990" selected>'));
assert.ok(markup.includes('<option value="30" selected>'));
assert.ok(markup.includes('Orçamento em análise: R$ 99,90 por 30 dias'));
assert.ok(!markup.includes('<option value="4990" selected>'));
assert.ok(markup.includes('sponsor-account-email'));
assert.equal(posted,0);

const unselected={document:{getElementById:()=>null},globalThis:{liveReady:()=>false,liveRuntime:{session:null}},URL,console};
vm.createContext(unselected);
vm.runInContext(official+';this.planner=tamaoAdsPlannerSection;',unselected);
markup=unselected.planner();
assert.ok(markup.includes('data-sponsor-budget="4990" aria-pressed="true"'));
assert.ok(markup.includes('Orçamento em análise: R$ 49,90 por 15 dias'));

const fresh={document:doc,shell:x=>x,globalThis:{sessionStorage:storage,
 tamaoAdsPlannerLoad:()=>{},tamaoAdsPlannerSection:()=>'<section></section>'}};
vm.createContext(fresh);
vm.runInContext(studio+';this.page=sponsorsLandingPremium;',fresh);
assert.ok(fresh.page().includes('data-sponsor-demo-budget="9990" aria-pressed="true"'));
assert.equal(fresh.globalThis.tamaoSponsorDemoBudget(),9990);
assert.equal(posted,0,'No campaign, impression, payment or backend write');
console.log('PASS V1.1096: secure 4-price selection, consented handoff, official budget and days, safe default, session restore, zero backend writes.');
