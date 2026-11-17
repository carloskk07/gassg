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
const daysMigration=readFileSync('supabase/migrations/20261117111221_agenda_folgas_v1_1049.sql','utf8');
assert.match(daysMigration,/agenda_closed_days_owner_select/);
assert.match(daysMigration,/agenda_set_closed_day/);
assert.match(daysMigration,/AGENDA_DAY_HAS_BOOKINGS/);
assert.match(daysMigration,/pg_advisory_xact_lock/);
assert.match(daysMigration,/agenda_closed_day_booking_guard/);
assert.match(daysMigration,/agenda_my_bookings/);
assert.match(daysMigration,/a\.customer_id=auth\.uid\(\)/);
assert.match(daysMigration,/grant execute on function public\.agenda_my_bookings\(\) to authenticated/);
assert.match(daysMigration,/grant execute on function public\.agenda_day_is_closed\(uuid,date\) to anon,authenticated/);
assert.doesNotMatch(daysMigration,/grant execute on function public\.agenda_set_closed_day\(date,boolean\) to anon/);
assert.match(source,/agendaDownloadCalendar/);
assert.match(source,/agenda_set_closed_day/);
assert.match(source,/agenda_day_is_closed/);
assert.match(source,/Este profissional não atende nesta data/);
assert.match(source,/rpc\('agenda_my_bookings'\)/);
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
const advanced=readFileSync('supabase/migrations/20261117115553_agenda_equipes_remarcacao_v1_1050.sql','utf8');
for(const word of ['agenda_staff_owner_select','agenda_staff_owner_insert',
 'agenda_staff_owner_update','agenda_booking_staff_guard','agenda_available_staff_slots',
 'agenda_book_staff_slot','agenda_reschedule_booking','AGENDA_STAFF_SELECTION_REQUIRED',
 'AGENDA_SLOT_ALREADY_TAKEN','AGENDA_BOOKING_CHANGED','AGENDA_DAY_CLOSED',
 'agenda_my_bookings'])assert.match(advanced,new RegExp(word));
assert.match(advanced,/revoke all on function public\.agenda_reschedule_booking/);
assert.match(advanced,/grant execute on function public\.agenda_available_staff_slots.*to anon,authenticated/);
assert.match(source,/agendaBeginReschedule/);
assert.match(source,/agendaConfirmReschedule/);
assert.match(source,/agendaChooseStaff/);
assert.match(source,/agenda_book_staff_slot/);
assert.match(source,/agenda_available_staff_slots/);
assert.match(source,/Remarcar/);
assert.match(source,/SEQUENCE:/);
assert.doesNotMatch(advanced,/mercadopago|mp_access_token|pix|payment_attempt|split_payments/i);

vm.runInContext('agendaRuntime.phase="ready";agendaRuntime.user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"};',ctx);
vm.runInContext('agendaRuntime.page={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",title:"Barbearia Centro",slug:"barbearia-centro",published:true,photo_paths:[],city:"São Gabriel"};',ctx);
vm.runInContext('agendaRuntime.staff=[{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",name:"Ana",active:true}];',ctx);
vm.runInContext('agendaRuntime.services=[{id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",title:"Corte",duration_min:45,price_cents:6000,active:true}];',ctx);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Equipe e agendas simultâneas/);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Ana/);
vm.runInContext('agendaRuntime.publicProfile={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",slug:"barbearia-centro",title:"Barbearia Centro",services:agendaRuntime.services,staff:agendaRuntime.staff,city:"São Gabriel"};',ctx);
vm.runInContext('agendaRuntime.serviceId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";agendaRuntime.staffId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";agendaRuntime.day="2026-11-23";',ctx);
assert.match(vm.runInContext('agendaPublicView()',ctx),/Profissional/);
assert.match(vm.runInContext('agendaPublicView()',ctx),/Ana/);
vm.runInContext('agendaRuntime.selectedStart="2026-11-23T14:00:00Z";agendaRuntime.rescheduleId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";',ctx);
assert.match(vm.runInContext('agendaPublicView()',ctx),/Confirmar remarcação/);
assert.doesNotMatch(vm.runInContext('agendaPublicView()',ctx),/Confirmar horário gratuitamente/);
vm.runInContext('agendaRuntime.rescheduleId="";',ctx);
assert.match(vm.runInContext('agendaPublicView()',ctx),/Confirmar horário gratuitamente/);
vm.runInContext('agendaRuntime.mine=[{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",starts_at:"2026-11-23T14:00:00Z",ends_at:"2026-11-23T14:45:00Z",status:"confirmed",page_title:"Barbearia Centro",service_title:"Corte",staff_title:"Ana",reschedule_count:0,slug:"barbearia-centro"}];',ctx);
assert.match(vm.runInContext('agendaMyBookingsView()',ctx),/Remarcar/);
assert.match(vm.runInContext('agendaMyBookingsView()',ctx),/Ana/);
assert.match(vm.runInContext('agendaIcsContent({...agendaRuntime.mine[0],reschedule_count:2},"Corte")',ctx),/SEQUENCE:2/);
const operations=readFileSync('supabase/migrations/20261117135108_agenda_operacao_v1_1051.sql','utf8');
for(const word of ['agenda_waitlist_participants_read','agenda_staff_blocks_owner_read',
 'agenda_join_waitlist','agenda_close_waitlist','agenda_add_staff_block',
 'agenda_remove_staff_block','agenda_mark_attendance','agenda_staff_block_booking_guard',
 'agenda_booking_events','AGENDA_BLOCK_HAS_BOOKINGS','AGENDA_STAFF_BLOCKED',
 'AGENDA_WAITLIST_NOT_ALLOWED','AGENDA_ATTENDANCE_INVALID'])
 assert.match(operations,new RegExp(word));
assert.doesNotMatch(operations,/mercadopago|mp_access_token|pix|payment_attempt|split_payments/i);
for(const handler of ['agendaAddBlock','agendaRemoveBlock','agendaJoinWaitlist',
 'agendaCloseWaitlist','agendaMarkAttendance','agendaMyWaitingView'])
 assert.match(source,new RegExp(handler));
assert.match(source,/consent/);
assert.match(source,/sem disparos automáticos/);
assert.match(css,/agenda-block-form|agenda-waitlist/);
vm.runInContext('agendaRuntime.waiting=[{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",customer_name:"Carla",customer_phone:"+5555999999999",day:"2026-11-25"}]',ctx);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Lista de espera/);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Marcar como contatado/);
vm.runInContext('agendaRuntime.myWaiting=[{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",day:"2026-11-25"}]',ctx);
assert.match(vm.runInContext('agendaMyWaitingView()',ctx),/Sair da lista/);
vm.runInContext('agendaRuntime.selectedStart="";agendaRuntime.slots=[];agendaRuntime.slotBusy=false;agendaRuntime.dayClosed=false;',ctx);
assert.match(vm.runInContext('agendaPublicView()',ctx),/Entrar na lista de espera/);
assert.match(vm.runInContext('agendaLocalHourToInstant("2026-11-23","12:30")',ctx),/2026-11-23T15:30:00.000Z/);
const qrLibrary=readFileSync('js/qr-generator.js','utf8');
vm.runInContext(qrLibrary,ctx,{filename:'js/qr-generator.js'});
const qrSvg=vm.runInContext('agendaQrSvg("barbearia-centro")',ctx);
assert.match(qrSvg,/<svg/);
assert.match(qrSvg,/path|rect/);
assert.match(source,/agendaDownloadQr|agendaSharePublicLink|agendaToggleQr/);
assert.match(source,/\/js\/qr-generator\.js/);
assert.doesNotMatch(source,/https?:\/\/[^\s"']+qrcode/i);

const depositMigration=readFileSync('supabase/migrations/20261117160000_agenda_sinal_finance_guard_v1_1052.sql','utf8');
for(const expected of ['agenda_service_deposit_settings','agenda_set_deposit_policy',
 'agenda_deposit_quote','agenda_payment_control','agenda_payment_holds',
 'agenda_payment_attempts','agenda_payment_refunds','agenda_hold_disabled_guard',
 'AGENDA_PAYMENTS_NOT_HOMOLOGATED','refunds_homologated','provider_webhook_homologated'])
 assert.match(depositMigration,new RegExp(expected));
assert.match(source,/agendaDepositQuoteView|agendaSaveDepositPolicy|agenda_deposit_quote/);
assert.match(source,/Sem cobrança antecipada nesta versão/);
assert.match(source,/cobrança antecipada permanece desligada/);
vm.runInContext('agendaRuntime.paymentQuote={service_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",price_cents:6000,percent:25,deposit_cents:1500,remaining_cents:4500,charges_enabled:false,policy_text:"Reembolso de acordo com a lei."};',ctx);
const planned=vm.runInContext('agendaPublicView()',ctx);
assert.match(planned,/Sinal planejado: 25%/);
assert.match(planned,/Sem cobrança antecipada nesta versão/);
assert.match(planned,/R\$ 15,00/);
assert.match(planned,/R\$ 45,00/);
vm.runInContext('agendaRuntime.depositSettings=[{service_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",percent:25,policy_text:"A política de cancelamento atende os direitos do consumidor."}]',ctx);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Condições de sinal dos serviços/);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Sinal estimado/);
console.log('PASS: Agenda sinal estimado, sem checkout, OAuth pendente, valores e políticas.');

