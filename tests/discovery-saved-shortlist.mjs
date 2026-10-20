import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/discovery.js'),css=read('css/discovery.css');
new vm.Script(source,{filename:'discovery.js'});
const storage=new Map();let current='professionals',renders=0;
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const makeSandbox=(storageAdapter={getItem:key=>storage.get(key)??null,
 setItem:(key,value)=>storage.set(key,value)})=>{
 const box={
  route:()=>current,render:()=>renders++,shell:x=>x,esc,
  BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
  adminPortalRequested:()=>false,merchantPortalRequested:()=>false,
  localStorage:storageAdapter,location:{origin:'https://tamao.com.br',search:''},
  console
 };
 box.globalThis=box;
 vm.runInNewContext(source,box,{filename:'discovery.js'});
 return box;
};
const test=makeSandbox(),ids=[
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
];
const items=ids.map((id,i)=>({
 id,vertical:'professionals',title:i===0?'<img src=x onerror=alert(1)>':'Eletricista '+i,
 description:'Atendimento anunciado',occupation:'Eletricista',
 city_name:'São Gabriel',state_code:'RS'
}));
const state=test.discoveryState('professionals');
state.status='ready';state.items=items;
assert.equal(test.discoverySavedIds('professionals').length,0);
assert.match(test.discoveryPage(),/★ 0 salvos neste navegador/);
assert.match(test.discoveryCard(items[0],'professionals'),/aria-pressed="false"/);
assert.equal(test.discoveryToggleSaved('bad'),false,'reject invalid ID');
assert.equal(test.discoveryToggleSaved(ids[0]),true);
assert.deepEqual(Array.from(test.discoverySavedIds('professionals')),[ids[0]]);
assert.match(test.discoveryCard(items[0],'professionals'),/★ Salvo/);
assert.match(test.discoveryCard(items[0],'professionals'),/aria-pressed="true"/);
assert.match(test.discoveryPage(),/★ 1 salvo neste navegador/);
assert.equal(storage.get('tamao-discovery-saved-v1-professionals'),JSON.stringify([ids[0]]));
assert.equal(test.discoveryToggleSaved(ids[1]),true);
assert.equal(test.discoveryToggleSaved(ids[2]),true);
assert.equal(test.discoveryToggleSaved(ids[3]),true);
assert.equal(test.discoverySavedIds('professionals').length,4);
let comparison=test.discoverySavedComparison('professionals',state.items);
assert.equal((comparison.match(/class="discovery-shortlist-card"/g)||[]).length,3,
 'comparison is deliberately capped at three actual loaded listings');
assert.doesNotMatch(comparison,/<img src=x onerror/);
assert.match(comparison,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(comparison,/Dados declarados nos anúncios carregados/);
assert.doesNotMatch(comparison,/Reserva confirmada|Preço garantido|contratação paga/);
assert.equal(test.discoveryToggleComparison(),true);
assert.match(test.discoveryPage(),/Compare os salvos desta busca/);
assert.equal(test.discoveryToggleSavedFilter(),true);
assert.match(test.discoveryPage(),/Exibindo 4 anúncios salvos/);
state.items=[items[1]];
let filtered=test.discoveryPage();
assert.doesNotMatch(filtered,/&lt;img src=x onerror/,'no cached, hidden or withdrawn listing');
assert.equal((filtered.match(/class="discovery-result"/g)||[]).length,1);
assert.equal((filtered.match(/class="discovery-shortlist-card"/g)||[]).length,1);
state.items=[];
filtered=test.discoveryPage();
assert.match(filtered,/Nenhum anúncio salvo entre os resultados carregados desta busca/);
assert.doesNotMatch(filtered,/Eletricista 1/);
assert.equal(test.discoveryToggleSaved(ids[0]),false,'not allowed to toggle hidden/unloaded listings');
state.status='error';
assert.doesNotMatch(test.discoveryPage(),/class="discovery-shortlist-card"/,
 'network error must never display prior data as verified');
state.status='loading-more';state.items=[items[1]];
assert.match(test.discoveryPage(),/Eletricista 1/,'loaded rows remain visible during pagination');
state.status='ready';
assert.equal(test.discoveryToggleSaved(ids[1]),true,'saved item toggles off');
assert.equal(test.discoverySavedIds('professionals').includes(ids[1]),false);
const reloaded=makeSandbox();
assert.equal(reloaded.discoverySavedIds('professionals').length,3,'saved IDs survive reload');
assert.equal(reloaded.discoverySavedIds('rides').length,0,'modalities are independent');
current='stays';
const stay=reloaded.discoveryState('stays');stay.status='ready';
stay.items=[{id:ids[0],vertical:'stays',title:'Pousada P',
 city_name:'São Gabriel',state_code:'RS',guests:4,price_from_brl_cents:null,price_unit:'night'}];
assert.equal(reloaded.discoveryToggleSaved(ids[0]),true);
assert.doesNotMatch(reloaded.discoverySavedComparison('stays',stay.items),/Desde R\$ 0/,
 'missing lodging price cannot become invented free accommodation');
stay.items[0].price_from_brl_cents=28900;
assert.match(reloaded.discoverySavedComparison('stays',stay.items),/Desde R\$\s?289,00 por noite/);
current='rides';
const ride=reloaded.discoveryState('rides');ride.status='ready';
ride.items=[{id:ids[0],vertical:'rides',title:'Viagem compartilhada',
 seats_available:2,departure_at:'2030-07-05T12:00:00Z',city_name:'São Gabriel'}];
assert.equal(reloaded.discoveryToggleSaved(ids[0]),true);
assert.match(reloaded.discoverySavedComparison('rides',ride.items),/2 vagas anunciadas/);
assert.doesNotMatch(reloaded.discoverySavedComparison('rides',ride.items),/Reserva confirmada/);
// Corrupt or malicious localStorage entries cannot inject markup or change categories.
storage.set('tamao-discovery-saved-v1-rides',JSON.stringify(['<script>alert(1)</script>',
 ids[0],ids[0],'../../secret']));
assert.deepEqual(Array.from(reloaded.discoverySavedIds('rides')),[ids[0]]);
const session=makeSandbox({getItem:()=>{throw new Error('disabled')},
 setItem:()=>{throw new Error('disabled')}});
current='professionals';session.discoveryState('professionals').status='ready';
session.discoveryState('professionals').items=[items[2]];
assert.equal(session.discoveryToggleSaved(ids[2]),true);
assert.equal(session.discoverySavedIds('professionals').includes(ids[2]),true,
 'private-mode fallback stays usable in session');
for(const token of ['.discovery-saved-bar','.discovery-shortlist-grid','.discovery-save',
 '@media(max-width:760px)'])assert.ok(css.includes(token),'missing responsive CSS '+token);
assert.ok(renders>=5);
console.log('PASS: server-only visible favorites, safe per-category local IDs, bounded comparison and responsive navigation.');
