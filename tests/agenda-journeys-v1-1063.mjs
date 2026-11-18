import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/agenda.js');
const css=read('css/agenda.css');
const ctx=vm.createContext({
 location:{pathname:'/agenda/',hash:'',origin:'https://tamao.com.br',search:''},
 URL,URLSearchParams,
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'public'},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 shell:html=>html,route:()=> 'agenda',esc:value=>String(value??''),
 crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
});
vm.runInContext(source,ctx);
const setup=data=>vm.runInContext('Object.assign(agendaRuntime,'+JSON.stringify(data)+')',ctx);
const render=()=>vm.runInContext('agendaPage()',ctx);
setup({phase:'ready',user:null,ownerMode:false,page:null,publicProfile:null,slug:'',mine:[],myWaiting:[],
 directory:[{slug:'barbearia-da-praca',title:'Barbearia da Praça',city:'São Gabriel',photo_path:''}]});
const listed=render();
assert.ok(listed.indexOf('id="agenda-directory"')>=0);
assert.ok(listed.indexOf('id="agenda-directory"')<listed.indexOf('class="agenda-intro"'),
 'Real published agendas should be shown before inviting an anonymous visitor to create a page');
assert.match(listed,/Encontre seu próximo horário no TAMÃO/);
assert.match(listed,/href="#agenda-directory"/);
assert.match(listed,/Barbearia da Praça/);
assert.doesNotMatch(listed,/simula[cç][aã]o|reserva confirmada sem vaga/i);

setup({directory:[]});
const empty=render();
assert.ok(empty.indexOf('class="agenda-intro"')<empty.indexOf('id="agenda-directory"'),
 'When no published agendas exist, help professionals onboard first');
assert.match(empty,/Sua agenda organizada/);
assert.match(empty,/href="\/#professionals"/);
assert.match(empty,/As páginas dos profissionais aparecerão aqui/);
assert.equal((empty.match(/id="agenda-directory"/g)||[]).length,1);

setup({ownerMode:true});
const auth=render();
assert.match(auth,/Primeiro, confirme seu e-mail/);
assert.ok(auth.indexOf('Primeiro, confirme seu e-mail')<auth.indexOf('id="agenda-directory"'));
ctx.location.pathname='/agenda/barbearia-da-praca';
setup({ownerMode:false,slug:'barbearia-da-praca'});
const direct=render();
assert.match(direct,/href="\/agenda\/"/,'Professional page should let visitors discover other schedules');
assert.doesNotMatch(direct,/href="#agenda-directory"/,
 'Do not link to the directory anchor from a standalone professional page');

for(const name of ['.agenda-directory{scroll-margin-top:94px}',
 '.agenda-directory .agenda-list a:focus-visible','@media(prefers-reduced-motion:reduce)']){
 assert.ok(css.includes(name),'Responsive and keyboard-safe listing: '+name);
}
console.log('V1.1063 PASS: real calendars first, empty directory owner-first, profile links and accessible cards.');
