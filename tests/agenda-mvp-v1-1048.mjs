import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('js/agenda.js','utf8');
const migration=readFileSync('supabase/migrations/20261117030500_agenda_profissionais_mvp.sql','utf8');
const landing=readFileSync('agenda/index.html','utf8');
const builder=readFileSync('scripts/build-live-portals.mjs','utf8');
const index=readFileSync('index.html','utf8');
const customer=readFileSync('js/customer.js','utf8');
const discovery=readFileSync('js/discovery.js','utf8');
const css=readFileSync('css/agenda.css','utf8');
const ctx=vm.createContext({
 URLSearchParams,
 location:{origin:'https://tamao.com.br',pathname:'/',hash:'#agenda?profissional=barbearia-sg',search:''},
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'public-key'},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 render(){},route(){return 'agenda'},esc:s=>String(s??''),
 crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
});
vm.runInContext(source,ctx,{filename:'js/agenda.js'});
assert.equal(vm.runInContext('agendaSlug()',ctx),'barbearia-sg');
assert.equal(vm.runInContext('agendaSafeSlug("Barbearia São Gabriel !")',ctx),'barbearia-sao-gabriel');
assert.match(vm.runInContext('agendaToday()',ctx),/^\d{4}-\d{2}-\d{2}$/);
assert.equal(vm.runInContext('agendaMoney(6000)',ctx).includes('60,00'),true);
assert.equal(vm.runInContext('agendaPhotoUrl("https://evil.example/photo.jpg")',ctx),'');
assert.match(vm.runInContext('agendaPhotoUrl("11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp")',ctx),/example\.supabase\.co\/storage\/v1\/object\/public/);
assert.match(vm.runInContext('agendaShareLink("barbearia-sg")',ctx),/#agenda\?profissional=barbearia-sg$/);
assert.match(vm.runInContext('agendaPage()',ctx),/TAMÃO AGENDA/);
assert.match(landing,/js\/agenda\.js/);
assert.match(landing,/js\/backend\.js/);
assert.match(builder,/role==='customer'\)copyDir\(path\.join\(ROOT,'agenda'\)/);
assert.match(index,/tamao-benefit-agenda-link/);
assert.match(customer,/tamaoDiscoveryEntryHub/);
assert.match(discovery,/Ver agendas disponíveis/);
assert.match(css,/@media\(max-width:500px\)/);
for(const name of ['agenda_pages','agenda_services','agenda_hours','agenda_appointments']){
 assert.match(migration,new RegExp('alter table public\\.'+name+' enable row level security','i'));
}
assert.match(migration,/revoke all on public\.agenda_pages,public\.agenda_services,public\.agenda_hours,public\.agenda_appointments/);
assert.match(migration,/pg_advisory_xact_lock/);
assert.match(migration,/AGENDA_SLOT_ALREADY_TAKEN/);
assert.match(migration,/unique\(customer_id,request_id\)/);
assert.match(migration,/agenda_replace_hours/);
assert.match(migration,/agenda_public_directory/);
assert.match(migration,/grant execute on function public\.agenda_book_slot.*to authenticated/i);
assert.doesNotMatch(migration,/grant execute on function public\.agenda_book_slot.*to anon/i);
assert.doesNotMatch(migration,/mercadopago|pix|payment_attempt|split_payments/i);
console.log('PASS: TAMÃO Agenda slug, safe photo paths, responsive access, atomic owner scheduling, booking grants and no payment path.');
