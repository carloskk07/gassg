import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/ads-display.js');
new vm.Script(source);

const UUID=n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+
 '-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
const campaign=UUID('a');
let nextChallenge=1,empty=false,clock=0,focused=true,activeObserver=null;
const requests=[],servedChallenges=[],timers=new Map(),events=new Map(),winEvents=new Map();
let nextTimer=0;
const creative={isConnected:true};
const host={innerHTML:'',textContent:'',querySelector(name){
 return name==='article'&&this.innerHTML.includes('tamao-paid-placement')?creative:null;
}};
function add(map,type,fn){if(!map.has(type))map.set(type,new Set());map.get(type).add(fn)}
function remove(map,type,fn){map.get(type)?.delete(fn)}
function fire(map,type){for(const fn of [...(map.get(type)||[])])fn()}
class Observer{
 constructor(fn){this.fn=fn;this.disconnected=false;activeObserver=this;}
 observe(){this.disconnected=false}
 disconnect(){this.disconnected=true}
 emit(ratio){if(this.disconnected)return;this.fn([{target:creative,intersectionRatio:ratio}]);}
}
const ctx=vm.createContext({
 CHAMA_BACKEND:{url:'https://api.example.test',publishableKey:'safe-key'},
 async fetch(url,req){
  assert.equal(url,'https://api.example.test/functions/v1/ads-independent');
  const body=JSON.parse(req.body);
  requests.push(body);
  if(body.action==='serve'){
   const challenge=UUID(String(nextChallenge++));
   const slot=empty?null:{
    label:'Institucional',advertiser:'TAMÃO',challenge,campaignId:campaign,
    title:'Conheça o TAMÃO',description:'Conheça os serviços de São Gabriel.',
    city:'São Gabriel',state:'RS',url:'https://tamao.com.br/'
   };
   if(slot)servedChallenges.push(challenge);
   return {ok:true,json:async()=>({
    source:'ads_independent_issue_v1_884',billingEnabled:false,
    noCharge:true,slot
   })};
  }
  assert.equal(body.action,'confirm');
  assert.equal(body.tabVisible,true);
  assert.ok(body.visibleMs>=1000);
  assert.ok(body.visiblePercent>=50);
  return {ok:true,json:async()=>({countedForDiagnostics:true,billable:false})};
 },
 document:{
  visibilityState:'visible',hasFocus:()=>focused,getElementById:()=>host,
  addEventListener:(name,fn)=>add(events,name,fn),
  removeEventListener:(name,fn)=>remove(events,name,fn)
 },
 window:{
  addEventListener:(name,fn)=>add(winEvents,name,fn),
  removeEventListener:(name,fn)=>remove(winEvents,name,fn)
 },
 performance:{now:()=>clock},IntersectionObserver:Observer,
 setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id},
 clearTimeout:id=>timers.delete(id),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;'),
 URL,Date,Map,Set,Number,String,Math,JSON,
 console
});
vm.runInContext(source+
 '\nthis.exercise={show:tamaoAdsDisplaySlot,stop:tamaoAdsStopView,home:tamaoAdsDisplayHome};',ctx);
const show=ctx.exercise.show;
const fireTimer=async(ms)=>{
 const item=[...timers].find(([,t])=>t.ms===ms);
 assert.ok(item,'expected '+ms+'ms proof timer');
 timers.delete(item[0]);await item[1].fn();
};
await show('São Gabriel','RS','tamao-ads-home-slot');
assert.equal(requests.filter(r=>r.action==='serve').length,1);
const first=requests[0];
assert.ok(activeObserver&&!activeObserver.disconnected);
activeObserver.emit(0.8);
clock=1300;
await fireTimer(1250);
const confirms=()=>requests.filter(r=>r.action==='confirm');
assert.equal(confirms().length,1);
assert.equal(confirms()[0].challenge,UUID('1'));
// A new rendering of the SAME geographic placement must fetch a new
// one-use server challenge. Previously the 45s cache reused the old token.
await show('São Gabriel','RS','tamao-ads-home-slot');
assert.equal(requests.filter(r=>r.action==='serve').length,2,
 'positive placements must never reuse challenge cache');
assert.notEqual(servedChallenges[1],servedChallenges[0]);
assert.equal(winEvents.get('blur')?.size,1,'no leaked blur handlers');
assert.equal(winEvents.get('focus')?.size,1,'no leaked focus handlers');
activeObserver.emit(0.9);
assert.ok([...timers.values()].some(t=>t.ms===1250));
focused=false;fire(winEvents,'blur');
assert.ok(![...timers.values()].some(t=>t.ms===1250),
 'blur cancels an in-progress view proof');
clock=1800;focused=true;fire(winEvents,'focus');
assert.ok([...timers.values()].some(t=>t.ms===1250),
 'focus resumes measuring without IntersectionObserver threshold changes');
clock=3150;await fireTimer(1250);
assert.equal(confirms().length,2);
assert.notEqual(confirms()[0].challenge,confirms()[1].challenge,
 'two real views require two distinct server challenges');
assert.equal(requests.filter(r=>r.action==='purchase'||r.action==='checkout').length,0,
 'impression proof must never create payments');
empty=true;
await show('São Gabriel','RS','tamao-ads-home-slot');
const served=requests.filter(r=>r.action==='serve').length;
assert.equal(served,3);
await show('São Gabriel','RS','tamao-ads-home-slot');
assert.equal(requests.filter(r=>r.action==='serve').length,served,
 'negative response may be briefly cached');
assert.equal(winEvents.get('blur')?.size??0,0,'cleanup on empty placement');
assert.equal(winEvents.get('focus')?.size??0,0,'cleanup on empty placement');
console.log('V1.945 PASS: fresh one-use challenges, focus resumes eligible impressions, negative-only cache, no financial writes.');

// V1.951: first-visit São Gabriel showcase is our own free campaign only.
// An actual remembered region retains the normal ad-selection contract.
empty=false;
ctx.route=()=> 'home';
await ctx.exercise.home();
const anonymousShowcase=requests.filter(q=>q.action==='serve').at(-1);
assert.equal(anonymousShowcase.city,'São Gabriel');
assert.equal(anonymousShowcase.state,'RS');
assert.equal(anonymousShowcase.institutionalOnly,true,
 'unverified showcase must never issue a paid placement');
assert.match(host.innerHTML,/INSTITUCIONAL • TAMÃO/);
ctx.rememberedMarketRegion=()=>({city:'Porto Alegre',state:'RS'});
await ctx.exercise.home();
const verifiedRegion=requests.filter(q=>q.action==='serve').at(-1);
assert.equal(verifiedRegion.city,'Porto Alegre');
assert.equal(verifiedRegion.state,'RS');
assert.equal(verifiedRegion.institutionalOnly,undefined);
console.log('V1.951 PASS: institutional showcase with no CEP; verified targeting preserved.');
