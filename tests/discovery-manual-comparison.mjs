import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=read('js/discovery.js'),css=read('css/discovery.css');
new vm.Script(js,{filename:'js/discovery.js'});
const store=new Map();
let kind='professionals',renders=0;
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const box={route:()=>kind,render:()=>renders++,shell:markup=>markup,esc:escape,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
 location:{origin:'https://tamao.com.br',search:''},
 adminPortalRequested:()=>false,merchantPortalRequested:()=>false,console};
box.globalThis=box;
vm.runInNewContext(js,box);
const id=i=>String(i).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const list=Array.from({length:5},(_,i)=>({
 id:id(i+1),vertical:'professionals',title:'Profissional '+(i+1),
 description:'Atendimento anunciado',occupation:'Eletricista',
 city_name:'São Gabriel',state_code:'RS'
}));
const state=box.discoveryState(kind);state.status='ready';state.items=list;
for(const item of list)assert.equal(box.discoveryToggleSaved(item.id),true);
assert.equal(box.discoverySavedIds(kind).length,5);
assert.match(box.discoverySavedComparison(kind,list),/Profissional 1/);
assert.doesNotMatch(box.discoverySavedComparison(kind,list),/Profissional 4/);
assert.equal(box.discoveryPickForComparison(id(5)),true);
let comparison=box.discoverySavedComparison(kind,list);
assert.match(comparison,/Profissional 5/);
assert.doesNotMatch(comparison,/Profissional 1/,'explicitly selected comparison wins');
assert.match(box.discoveryCard(list[4],kind),/aria-pressed="true" onclick="discoveryPickForComparison/);
assert.match(box.discoveryPage(),/Limpar seleção \(1\)/);
assert.equal(box.discoveryPickForComparison(id(2)),true);
assert.equal(box.discoveryPickForComparison(id(3)),true);
assert.equal(box.discoveryPickForComparison(id(4)),false,'fourth comparison must be rejected');
assert.match(state.savedNotice,/no máximo três/);
comparison=box.discoverySavedComparison(kind,list);
assert.equal((comparison.match(/class="discovery-shortlist-card"/g)||[]).length,3);
assert.doesNotMatch(comparison,/Profissional 4/);
assert.equal(box.discoveryPickForComparison('<script>alert(1)</script>'),false);
assert.equal(box.discoveryPickForComparison(id(99)),false,'cannot compare unseen listing ID');
assert.equal(box.discoveryToggleSaved(id(2)),true,'unsaving removes comparison permission');
assert.equal(Array.from(state.compareIds).includes(id(2)),false);
assert.equal(box.discoveryPickForComparison(id(2)),false,'must remain saved to compare');
state.items=[list[0]];
assert.doesNotMatch(box.discoverySavedComparison(kind,state.items),/Profissional 5/,
 'withdrawn or filtered listing cannot reappear by stored compare ID');
state.status='error';state.items=[];
assert.doesNotMatch(box.discoveryPage(),/class="discovery-shortlist-card"/);
state.status='ready';state.items=list;
assert.equal(box.discoveryClearComparisonSelection(),true);
assert.equal(state.compareOpen,false);assert.equal(state.compareIds.length,0);
assert.doesNotMatch(box.discoveryPage(),/Limpar seleção \(/);
kind='rides';const rideState=box.discoveryState(kind);
rideState.status='ready';rideState.items=[{...list[0],vertical:'rides'}];
assert.equal(box.discoveryPickForComparison(id(1)),false,
 'saved professional IDs cannot leak into a ride comparison');
assert.equal(rideState.compareIds.length,0);
const savedPayload=Array.from(store.values()).join(' ');
assert.doesNotMatch(savedPayload,/Profissional|Eletricista|São Gabriel|WhatsApp/i,
 'only safe UUID favorites may persist, no title or contact information');
for(const rule of ['.discovery-actions .discovery-pick',
 '.discovery-actions .discovery-pick:focus-visible','@media(max-width:560px)'])
 assert.ok(css.includes(rule),'missing accessible comparison style '+rule);
assert.ok(renders>7);
console.log('PASS: explicit three-ad comparison, consent-free UUID shortlist, no hidden listings, per-vertical isolation.');
