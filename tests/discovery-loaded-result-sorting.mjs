import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const discovery=read('js/discovery.js');
const css=read('css/discovery.css');
new vm.Script(discovery,{filename:'js/discovery.js'});
let kind='rides',renders=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const box={route:()=>kind,render:()=>renders++,shell:x=>x,esc,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 location:{origin:'https://tamao.com.br',search:''},
 adminPortalRequested:()=>false,merchantPortalRequested:()=>false,
 localStorage:{getItem:()=>null,setItem:()=>{}},console};
box.globalThis=box;
vm.runInNewContext(discovery,box);
const uuid=i=>String(i).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rows=[
 {id:uuid(1),vertical:'rides',title:'Viagem 1',departure_at:'2030-11-03T12:00:00Z',seats_available:1},
 {id:uuid(2),vertical:'rides',title:'Viagem 2',departure_at:'2030-10-30T10:00:00Z',seats_available:5},
 {id:uuid(3),vertical:'rides',title:'Viagem 3',departure_at:'2030-11-01T10:00:00Z',seats_available:null},
 {id:uuid(4),vertical:'rides',title:'Viagem 4',departure_at:'invalid',seats_available:3}
];
const sorted=(k,v,mode)=>Array.from(box.discoverySortLoaded(k,v,mode)).map(x=>x.id);
assert.deepEqual(sorted('rides',rows,'departure'),[uuid(2),uuid(3),uuid(1),uuid(4)],
 'future departures are chronological; unknown goes last');
assert.deepEqual(sorted('rides',rows,'seats'),[uuid(2),uuid(4),uuid(1),uuid(3)],
 'declared seats sort descending and missing last');
assert.deepEqual(sorted('rides',rows,'recent'),rows.map(x=>x.id),
 'default respects server publication order');
assert.deepEqual(sorted('rides',rows,'price'),rows.map(x=>x.id),
 'an unsupported sort cannot be injected into another vertical');
assert.deepEqual(rows.map(x=>x.id),[uuid(1),uuid(2),uuid(3),uuid(4)],
 'sort must not mutate server-result array');
kind='professionals';
const pros=[
 {id:uuid(5),vertical:'professionals',title:'P1',occupation:'Pedreiro',years_experience:0},
 {id:uuid(6),vertical:'professionals',title:'P2',occupation:'Pedreiro',years_experience:12},
 {id:uuid(7),vertical:'professionals',title:'P3',occupation:'Pedreiro',years_experience:9000},
 {id:uuid(8),vertical:'professionals',title:'P4',occupation:'Pedreiro',years_experience:12}
];
assert.deepEqual(sorted(kind,pros,'experience'),[uuid(6),uuid(8),uuid(5),uuid(7)],
 'stable ties, zero declared years, reject unreasonable claimed experience');
kind='stays';
const stays=[
 {id:uuid(9),vertical:'stays',title:'Hotel A',guests:2,price_from_brl_cents:35000},
 {id:uuid(10),vertical:'stays',title:'Hotel B',guests:8,price_from_brl_cents:null},
 {id:uuid(11),vertical:'stays',title:'Hotel C',guests:4,price_from_brl_cents:12000},
 {id:uuid(12),vertical:'stays',title:'Hotel D',guests:null,price_from_brl_cents:12000}
];
assert.deepEqual(sorted(kind,stays,'price'),[uuid(11),uuid(12),uuid(9),uuid(10)],
 'missing prices go last instead of inventing a free stay');
assert.deepEqual(sorted(kind,stays,'capacity'),[uuid(10),uuid(11),uuid(9),uuid(12)]);
const s=box.discoveryState('stays');
s.status='ready';s.items=stays;s.hasMore=true;
let html=box.discoveryPage();
assert.match(html,/Ordenar anúncios carregados/);
assert.match(html,/Ordem local: não inclui anúncios ainda não carregados/);
assert.match(html,/Menor preço anunciado/);
assert.doesNotMatch(html,/Mais experiência declarada/);
assert.equal(box.discoverySetSort('price'),true);
assert.equal(s.sortMode,'price');assert.equal(renders,1);
html=box.discoveryPage();
assert.ok(html.indexOf('Hotel C')<html.indexOf('Hotel A'));
assert.ok(html.indexOf('Hotel A')<html.indexOf('Hotel B'));
assert.match(html,/Há mais resultados para carregar/);
assert.equal(box.discoverySetSort('departure'),false,'other category sort rejected');
assert.equal(s.sortMode,'price');
assert.equal(box.discoverySetSort('<img src=x>'),false,'HTML cannot set sort mode');
assert.equal(renders,1);
kind='rides';
const rideState=box.discoveryState('rides');
assert.equal(rideState.sortMode,'recent','each vertical has separate sort choice');
rideState.status='ready';rideState.items=rows;
assert.equal(box.discoverySetSort('departure'),true);
assert.match(box.discoveryPage(),/Próximas saídas/);
assert.equal(box.discoverySetSort('recent'),true);
assert.equal(rideState.sortMode,'recent');
assert.doesNotMatch(box.discoveryPage(),/preço garantido|reserva confirmada/i);
for(const token of ['.discovery-sort-bar','.discovery-sort-bar select:focus-visible',
 '@media(max-width:560px)'])assert.ok(css.includes(token),'missing responsive sort CSS '+token);
console.log('PASS: multi-vertical loaded-result ordering, invalid-data fallbacks, stable ties, and safe scoped UI.');
