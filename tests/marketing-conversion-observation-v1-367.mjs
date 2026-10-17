import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const analytics=read('js/analytics.js');
const contact=read('js/legal.js');
for(const [name,source] of [['analytics',analytics],['legal',contact]])
  new vm.Script(source,{filename:name+'.js'});

let now=1000;
let currentRoute='home';
let requestOk=false;
const requests=[];
const storage=new Map();
const context={
  Date:{now:()=>now},URL,URLSearchParams,Map,Set,WeakSet,
  location:{hostname:'tamao.com.br',pathname:'/',search:'?utm_source=local',hash:'#home'},
  document:{referrer:'',getElementById:()=>null,querySelector:()=>null},
  sessionStorage:{
    getItem:key=>storage.get(key)??null,
    setItem:(key,value)=>storage.set(key,String(value))
  },
  CHAMA_BACKEND:{url:'https://example.test',publishableKey:'public-test-key'},
  route:()=>currentRoute,
  __CHAMA_TEST__:false,
  CHAMA_INTERNAL_PILOT:false,
  adminPortalRequested:()=>false,
  merchantPortalRequested:()=>false,
  chamaFetch:async (url,options)=>{
    requests.push({url,method:options.method,payload:JSON.parse(options.body)});
    return {ok:requestOk,status:requestOk?204:503};
  },
  console:{warn:()=>{}}
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(analytics,context);

// Failed network calls must not mark a session as measured.
assert.equal(await context.marketingTrack('landing_view','customer'),false);
assert.equal(requests.length,1);
assert.equal(storage.size,0,'unacknowledged measurement must remain retryable');
assert.equal(await context.marketingTrack('landing_view','customer'),false);
assert.equal(requests.length,1,'failed endpoint needs bounded cooldown');
now+=60001;requestOk=true;
assert.equal(await context.marketingTrack('landing_view','customer'),true);
assert.equal(requests.length,2);
assert.equal(storage.size,1,'only accepted measurements are saved as sent');
assert.equal(await context.marketingTrack('landing_view','customer'),false);
assert.equal(requests.length,2,'successful event is deduplicated');

// In-flight events from rapid SPA rerenders must not be sent twice.
currentRoute='sponsors';
let release;
context.chamaFetch=(url,options)=>{
  requests.push({url,method:options.method,payload:JSON.parse(options.body)});
  return new Promise(resolve=>{release=resolve});
};
const pending=context.marketingTrack('landing_view','merchant');
assert.equal(await context.marketingTrack('landing_view','merchant'),false);
assert.equal(requests.length,3,'one simultaneous sponsor landing request');
release({ok:true,status:204});
assert.equal(await pending,true);
assert.equal(await context.marketingTrack('landing_view','merchant'),false);

// Large mobile forms can occupy more than the viewport and never be 35% visible.
currentRoute='contact';
context.tamaoPublicContactAudience='merchant';
const sponsorNode={classList:{contains:key=>key==='public-contact-card'}};
const customerNode={id:'early-access',classList:{contains:()=>false}};
context.document.getElementById=id=>id==='early-access'?customerNode:null;
context.document.querySelector=selector=>selector==='.public-contact-card'?sponsorNode:null;
let observer;
class FakeObserver{
  constructor(callback,options){this.callback=callback;this.options=options;this.nodes=[];this.removed=[];observer=this}
  observe(node){this.nodes.push(node)}
  unobserve(node){this.removed.push(node)}
}
context.IntersectionObserver=FakeObserver;
context.chamaFetch=async (url,options)=>{
  requests.push({url,method:options.method,payload:JSON.parse(options.body)});
  return {ok:requestOk,status:requestOk?204:503};
};
context.marketingObserveLeadForms();
assert.ok(observer.nodes.includes(sponsorNode),'sponsor form should be observed');
assert.ok(observer.options.threshold.includes(0.1),'small visible ratios on mobile need callbacks');
const observation=node=>({
  target:node,isIntersecting:true,intersectionRatio:0.12,
  intersectionRect:{height:180},boundingClientRect:{height:1500}
});
observer.callback([observation(sponsorNode)]);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(observer.removed.includes(sponsorNode),true,'accepted lead form observation may be removed');
const sponsorEvent=requests.at(-1).payload;
assert.equal(sponsorEvent.eventType,'lead_form_view');
assert.equal(sponsorEvent.audience,'merchant');
assert.equal(sponsorEvent.landingPath,'/#contact');
assert.deepEqual(Object.keys(sponsorEvent).sort(),
  ['eventType','audience','source','medium','campaign','content','landingPath','referrerHost'].sort(),
  'anonymous event may not contain names, phones, messages or IDs');

// On a rejected mobile lead impression, keep observing for another chance.
currentRoute='home';context.tamaoPublicContactAudience=null;
requestOk=false;
const removedBefore=observer.removed.length;
observer.callback([observation(customerNode)]);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(observer.removed.length,removedBefore,'failed form impression should be kept');
now+=60001;requestOk=true;
observer.callback([observation(customerNode)]);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(observer.removed.includes(customerNode),true,'accepted retry clears observation');

// Direct contact intent, absent a sponsor CTA, is still classified correctly.
const changed=contact.slice(contact.indexOf('function contactKindChanged(){'),
  contact.indexOf('\nfunction contactChannelChanged(){'));
let kind='sponsor',observed=0,visibility=false;
const contactCtx={
 document:{querySelector:selector=>selector==='#public-request-kind'?{value:kind}:
  selector==='#privacy-action-wrap'?{set hidden(value){visibility=value}}:null},
 route:()=> 'contact',
 globalThis:{marketingObserveLeadForms:()=>{observed++}}
};
vm.createContext(contactCtx);
vm.runInContext(changed+'\nthis.change=contactKindChanged;',contactCtx);
contactCtx.change();
assert.equal(contactCtx.globalThis.tamaoPublicContactAudience,'merchant');
assert.equal(visibility,true);
assert.equal(observed,1);
kind='general';contactCtx.change();
assert.equal(contactCtx.globalThis.tamaoPublicContactAudience,null);
kind='privacy';contactCtx.change();
assert.equal(visibility,false);

console.log('TAMÃO V1.367 PASS — acknowledged analytics, bounded retries, mobile forms, direct sponsor intent and privacy.');
