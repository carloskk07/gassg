import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('js/agenda.js','utf8');
const migration=readFileSync('supabase/migrations/20261117032111_agenda_profissionais_mvp.sql','utf8');
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
 render(){},route(){return 'agenda'},shell:s=>s,esc:s=>String(s??''),
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
assert.match(landing,/js\/agenda-boot\.js/);
assert.match(readFileSync('scripts/generate-runtime-config.mjs','utf8'),/location\.pathname/);
assert.match(readFileSync('js/runtime-config.js','utf8'),/location\.pathname/);
assert.doesNotMatch(index,/agenda-callback\.js/);
assert.doesNotMatch(landing,/<script>/);
assert.doesNotMatch(index,/<script>/);
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
const daysMigration=readFileSync('supabase/migrations/20261117110000_agenda_folgas_v1_1049.sql','utf8');
assert.match(daysMigration,/agenda_closed_days_owner_select/);
assert.match(daysMigration,/agenda_set_closed_day/);
assert.match(daysMigration,/AGENDA_DAY_HAS_BOOKINGS/);
assert.match(daysMigration,/pg_advisory_xact_lock/);
assert.match(daysMigration,/agenda_closed_day_booking_guard/);
assert.match(daysMigration,/grant execute on function public\.agenda_day_is_closed\(uuid,date\) to anon,authenticated/);
assert.doesNotMatch(daysMigration,/grant execute on function public\.agenda_set_closed_day\(date,boolean\) to anon/);
assert.match(source,/agendaDownloadCalendar/);
assert.match(source,/agenda_set_closed_day/);
assert.match(source,/agenda_day_is_closed/);
assert.match(source,/Este profissional não atende nesta data/);
assert.match(source,/select\('id,starts_at,ends_at,status,page_id,service_id'\)/);
assert.match(css+readFileSync('css/agenda.css','utf8'),/agenda-closed-list/);
assert.equal(vm.runInContext('agendaDateOnly("2026-11-20")',ctx),'20/11/2026');
const ics=vm.runInContext('agendaIcsContent({id:"11111111-1111-4111-8111-111111111111",starts_at:"2026-11-20T13:00:00Z",ends_at:"2026-11-20T13:45:00Z"},"Corte, barba; agenda")',ctx);
assert.match(ics,/BEGIN:VCALENDAR\r\n/);
assert.match(ics,/UID:11111111-1111-4111-8111-111111111111@tamao.com.br/);
assert.match(ics,/DTSTART:20261120T130000Z/);
assert.match(ics,/DTEND:20261120T134500Z/);
assert.match(ics,/TRIGGER:-PT1H/);
assert.match(ics,/SUMMARY:Corte\\, barba\\; agenda/);
assert.equal(vm.runInContext('agendaIcsContent({id:"not-uuid",starts_at:"2026-11-20T13:00:00Z",ends_at:"2026-11-20T13:45:00Z"},"Invalid")',ctx),'');
assert.equal(vm.runInContext('agendaIcsContent({id:"11111111-1111-4111-8111-111111111111",starts_at:"2026-11-20T13:45:00Z",ends_at:"2026-11-20T13:00:00Z"},"Invalid")',ctx),'');
console.log('PASS: TAMÃO Agenda ACL, folgas, ICS calendário e proteção de datas; pagamentos continuam desligados.');
