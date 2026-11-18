import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/agenda.js');
const css=read('css/agenda.css');
const audit=read('.github/workflows/audit.yml');
const esc=value=>String(value??'').replaceAll('&','&amp;')
 .replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
 .replaceAll("'","&#39;");
const ctx=vm.createContext({
 location:{pathname:'/agenda/',hash:'',origin:'https://tamao.com.br',search:''},
 URL,URLSearchParams,
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'public'},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 shell:html=>html,route:()=> 'agenda',esc,
 crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
});
vm.runInContext(source,ctx);
const setup=data=>vm.runInContext('Object.assign(agendaRuntime,'+JSON.stringify(data)+')',ctx);
const directory=[
 {slug:'barbearia-da-praca',title:'Barbearia da Praça',city:'São Gabriel',about:'Cortes e barba',photo_path:''},
 {slug:'studio-flor',title:'Estúdio Flor',city:'Porto Alegre',about:'Maquiagem e cabelo',photo_path:''},
 {slug:'clinica-sorriso',title:'Clínica <script>privado</script>',city:'São Gabriel',about:'<img src=x onerror=alert(1)>',photo_path:''}
];
setup({phase:'ready',user:null,page:null,ownerMode:false,directory,directoryQuery:''});
const view=()=>vm.runInContext('agendaDirectoryView()',ctx);
const plain=view();
assert.match(plain,/Nome, especialidade ou cidade/);
assert.match(plain,/type="search"/);
assert.match(plain,/oninput="agendaDirectoryFilter\(this.value\)"/);
assert.match(plain,/aria-controls="agenda-directory-cards"/);
assert.match(plain,/role="status" aria-live="polite"/);
assert.match(plain,/Mostrando 3 profissionais publicados/);
assert.equal((plain.match(/data-agenda-directory-card/g)||[]).length,3);
assert.match(plain,/https:\/\/tamao.com.br\/agenda\/barbearia-da-praca/);
assert.doesNotMatch(plain,/<script>privado<\/script>/,'No HTML injection from a professional title');
assert.match(plain,/&lt;script&gt;privado&lt;\/script&gt;/);
assert.doesNotMatch(plain,/<img src=x onerror=alert\(1\)>/);
assert.match(plain,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(plain,/Maquiagem e cabelo/);
assert.equal(ctx.agendaDirectoryMatches(directory[0],'barbearia Sao Gabriel'),true);
assert.equal(ctx.agendaDirectoryMatches(directory[1],'flor porto'),true);
assert.equal(ctx.agendaDirectoryMatches(directory[1],'Gabriel'),false);
assert.equal(ctx.agendaDirectoryMatches(directory[1],'MAQUIAGEM'),true);
assert.equal(ctx.agendaDirectoryMatches(directory[0],'barba'),true);
assert.equal(ctx.agendaDirectoryMatches(directory[0],'praça'),true);
assert.equal(ctx.agendaDirectoryMatches(directory[0],'PRACA'),true);

let focusCount=0;
const cards=directory.map((_,index)=>({
 hidden:false,
 getAttribute(name){return name==='data-agenda-index'?String(index):null;}
}));
const count={textContent:''};
const input={value:'',focus(){focusCount++;}};
const panel={
 querySelectorAll(selector){assert.equal(selector,'[data-agenda-directory-card]');return cards;},
 querySelector(selector){assert.equal(selector,'#agenda-directory-result');return count;}
};
ctx.document={getElementById:id=>id==='agenda-directory'?panel:
 id==='agenda-directory-search'?input:null};
assert.equal(ctx.agendaDirectoryFilter('BARBEARIA   SAO'),1);
assert.deepEqual(cards.map(c=>c.hidden),[false,true,true]);
assert.equal(count.textContent,'1 profissional encontrado');
assert.equal(ctx.agendaDirectoryFilter('cidade inexistente'),0);
assert.ok(cards.every(c=>c.hidden));
assert.match(count.textContent,/Nenhum profissional corresponde/);
assert.equal(ctx.agendaDirectoryFilter('maquiagem'),1);
assert.deepEqual(cards.map(c=>c.hidden),[true,false,true]);
assert.equal(ctx.agendaDirectoryFilter('Porto Alegre'),1);
assert.deepEqual(cards.map(c=>c.hidden),[true,false,true]);
assert.equal(ctx.agendaDirectoryFilter(''),3);
assert.ok(cards.every(c=>!c.hidden));
assert.equal(count.textContent,'Mostrando 3 profissionais publicados');

setup({directoryQuery:'barbearia sao'});
const filtered=view();
assert.match(filtered,/1 profissional encontrado/);
assert.match(filtered,/data-agenda-index="1" hidden/);
assert.match(filtered,/data-agenda-index="2" hidden/);
assert.doesNotMatch(filtered,/data-agenda-index="0" hidden/);
input.value='termo anterior';
ctx.agendaDirectoryClearSearch();
assert.equal(input.value,'');
assert.equal(focusCount,1);
assert.equal(ctx.agendaRuntime?.directoryQuery,undefined);
assert.equal(vm.runInContext('agendaRuntime.directoryQuery',ctx),'');

// Returning customers must see their own confirmed appointments before the
// business-owner invitation, without a second login or duplicated cards.
setup({directoryQuery:'',user:{id:'returning-customer'},page:null,ownerMode:false,
 mine:[{id:'11111111-1111-4111-8111-111111111111',
   slug:'barbearia-da-praca',page_title:'Barbearia da Praça',
   service_title:'Corte masculino',staff_title:'João',
   starts_at:'2026-12-04T14:00:00-03:00',reschedule_count:0}],
 myWaiting:[]});
const returning=vm.runInContext('agendaPage()',ctx);
assert.match(returning,/Suas reservas e novos horários/);
assert.equal((returning.match(/<h2>Minhas reservas<\/h2>/g)||[]).length,1);
assert.ok(returning.indexOf('<h2>Minhas reservas</h2>')<returning.indexOf('id="agenda-directory"'));
assert.ok(returning.indexOf('id="agenda-directory"')<returning.indexOf('class="agenda-intro"'));
assert.match(returning,/Corte masculino/);
assert.match(returning,/href="\/agenda\/barbearia-da-praca"/);
assert.doesNotMatch(returning,/Primeiro, confirme seu e-mail/);

setup({mine:[],myWaiting:[]});
const newCustomer=vm.runInContext('agendaPage()',ctx);
assert.match(newCustomer,/Encontre seu próximo horário no TAMÃO/);
assert.ok(newCustomer.indexOf('id="agenda-directory"')<newCustomer.indexOf('class="agenda-intro"'),
 'Logged-in customer without bookings should discover real professionals first');
assert.equal((newCustomer.match(/id="agenda-directory"/g)||[]).length,1);

// Search is a public read-only filter; it must not call mutation APIs.
const start=source.indexOf('function agendaDirectorySearchText(');
const end=source.indexOf('function agendaMyWaitingView(',start);
const searchSource=source.slice(start,end);
assert.doesNotMatch(searchSource,/\.from\(|\.rpc\(|insert\(|delete\(|update\(|localStorage|sessionStorage|fetch\(/);
for(const name of ['.agenda-directory-search-row', '.agenda-directory .agenda-list a[hidden]',
 '.agenda-directory-placeholder', '.agenda-directory-about', '@media(max-width:500px)', '@media(prefers-reduced-motion:reduce)'])
 assert.ok(css.includes(name),'Missing accessible mobile style: '+name);
assert.match(audit,/node tests\/agenda-directory-search-v1-1066\.mjs/);
console.log('V1.1066 PASS: real published directory, accent-insensitive search, safe markup, no login or new database calls.');
