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
assert.equal(vm.runInContext('agendaShareLink("barbearia-sg")',ctx),'https://tamao.com.br/agenda/barbearia-sg');
assert.equal(vm.runInContext('agendaShareLink("barbearia-são-gabriel")',ctx),'');
ctx.location.pathname='/agenda/barbearia-do-joao';
ctx.location.hash='#agenda';
assert.equal(vm.runInContext('agendaSlug()',ctx),'barbearia-do-joao','Direct friendly link must open professional');
ctx.location.pathname='/agenda/barbearia-do-joao/';
assert.equal(vm.runInContext('agendaSlug()',ctx),'barbearia-do-joao','Trailing slash must work');
ctx.location.pathname='/agenda/';
ctx.location.hash='#agenda?profissional=barbearia-sg';
assert.equal(vm.runInContext('agendaSlug()',ctx),'barbearia-sg','Old shared links must remain readable');
ctx.location.pathname='/';
assert.equal(vm.runInContext('agendaSlug()',ctx),'barbearia-sg','Old shop hash links must remain readable');
assert.match(landing,/href="\/css\/agenda\.css"/);
assert.match(landing,/src="\/js\/agenda\.js"/);
assert.doesNotMatch(landing,/["']\.\.\/(js|css|icons)\//);
const standaloneBoot=readFileSync('js/agenda-boot.js','utf8');
assert.match(standaloneBoot,/DOMContentLoaded',render/);
assert.match(standaloneBoot,/addEventListener\('popstate',render\)/);
const swSource=readFileSync('sw.js','utf8');
assert.match(swSource,/\^\\\/agenda\(\?:\\\/\|\$\)/,'Direct Agenda paths must never replace storefront offline HTML');
assert.match(source,/history\.pushState\(null,'',next\.pathname\)/);
assert.match(source,/history\.replaceState\(null,'',new URL\(agendaShareLink\(returnSlug\)\)\.pathname\)/);
assert.doesNotMatch(standaloneBoot,/history\.replaceState\(null,'',location\.pathname/);

const builderSource=readFileSync('scripts/build-live-portals.mjs','utf8');
const nativeRoutes=readFileSync('scripts/cloudflare-native-routes-v1-1073.mjs','utf8');
assert.match(builderSource,/role==='customer'\?TAMAO_CLOUDFLARE_NATIVE_ROUTES/);
assert.doesNotMatch(nativeRoutes,/\/agenda\/:slug\/ \/agenda\/\?profissional=:slug 302/,
 'Only Cloudflare Pages Functions may serve real Agenda deep links');
const nativeHandler=readFileSync('functions/agenda/[slug].js','utf8');
assert.match(nativeHandler,/nativePageRoute\(context,'agenda'\)/);
const functionRoutes=readFileSync('scripts/cloudflare-functions-routes-v1-1074.mjs','utf8');
assert.match(functionRoutes,/include:\['\/p\/\*','\/agenda\/\*'\]/);
assert.match(functionRoutes,/\/agenda\/exemplo\/\*/,'Illustrative premium example stays static');
assert.doesNotMatch(nativeRoutes,/\/\* \/index\.html 200/,'Generic SPA fallback must never override Agenda pages');

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
assert.match(source,/Não há atendimento neste dia/);
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

const depositMigration=readFileSync('supabase/migrations/20261117160314_agenda_sinal_finance_guard_v1_1052.sql','utf8');
for(const expected of ['agenda_service_deposit_settings','agenda_set_deposit_policy',
 'agenda_deposit_quote','agenda_payment_control','agenda_payment_holds',
 'agenda_payment_attempts','agenda_payment_refunds','agenda_hold_disabled_guard',
 'AGENDA_PAYMENTS_NOT_HOMOLOGATED','refunds_homologated','provider_webhook_homologated'])
 assert.match(depositMigration,new RegExp(expected));
assert.match(source,/agendaDepositQuoteView|agendaSaveDepositPolicy|agenda_deposit_quote/);
assert.match(source,/Agendamento gratuito, sem sinal antecipado/);
assert.match(source,/cobrança antecipada permanece desligada/);
vm.runInContext('agendaRuntime.paymentQuote={service_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",price_cents:6000,percent:25,deposit_cents:1500,remaining_cents:4500,charges_enabled:false,policy_text:"Reembolso de acordo com a lei."};',ctx);
const planned=vm.runInContext('agendaPublicView()',ctx);
assert.match(planned,/Agendamento gratuito, sem sinal antecipado/);
assert.doesNotMatch(planned,/Sinal planejado: 25%/);
assert.doesNotMatch(planned,/R\$\s*15,00/);
vm.runInContext('agendaRuntime.depositSettings=[{service_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",percent:25,policy_text:"A política de cancelamento atende os direitos do consumidor."}]',ctx);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Condições de sinal dos serviços/);
assert.match(vm.runInContext('agendaOwnerEditor()',ctx),/Sinal estimado/);
console.log('PASS: Agenda sinal estimado, sem checkout, OAuth pendente, valores e políticas.');

// V1.1053 — the owner is not forced through eight separate forms.
const quickHtml=vm.runInContext('agendaQuickStartView()',ctx);
assert.match(quickHtml,/Crie sua agenda grátis/);
assert.match(quickHtml,/Criar e publicar minha agenda/);
assert.match(quickHtml,/Primeiro serviço/);
assert.doesNotMatch(quickHtml,/Condições de sinal dos serviços|Equipe e agendas simultâneas/);
assert.match(css,/agenda-quick-start|agenda-date-shortcuts|agenda-more/);
assert.match(source,/const \[slots,closed\]=await Promise\.all/);
assert.doesNotMatch(source,/rpc\('agenda_deposit_quote'/);
const savedPage=vm.runInContext('agendaOwnerEditor()',ctx);
assert.ok(savedPage.indexOf('MINHA AGENDA')<savedPage.indexOf('Serviços e preços'));
assert.ok(savedPage.indexOf('Serviços e preços')<savedPage.indexOf('Personalizar página, equipe e ajustes opcionais'));
assert.match(savedPage,/<details class="agenda-more"/);
assert.match(savedPage,/<summary>Horários de atendimento/);
assert.match(source,/ontoggle="agendaRememberPanel/);
vm.runInContext('agendaRememberPanel("advanced",true);agendaRememberPanel("hours",true)',ctx);
assert.equal(vm.runInContext('agendaRuntime.advancedOpen && agendaRuntime.hoursOpen',ctx),true);
const expanded=vm.runInContext('agendaOwnerEditor()',ctx);
assert.match(expanded,/class="agenda-more" open/);
assert.match(expanded,/class="agenda-hours-wrap" open/);
vm.runInContext('agendaRememberPanel("advanced",false);agendaRememberPanel("hours",false)',ctx);

assert.match(vm.runInContext('agendaPublicView()',ctx),/Hoje/);
assert.match(vm.runInContext('agendaPublicView()',ctx),/Amanhã/);
assert.match(vm.runInContext('agendaPublicView()',ctx),/Ver horários do dia seguinte/);

// One form creates a DRAFT, then service, weekly hours and finally publishes.
ctx.FormData=class{constructor(form){this.form=form}get(name){return this.form[name]??null}};
ctx.quickEvents=[];
const quickPage={
 id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',slug:'barbearia-centro-11111111',
 title:'Barbearia Centro',city:'São Gabriel',published:false,photo_paths:[]
};
const quickClient={
 from(table){return {
  insert(record){
   ctx.quickEvents.push({step:'insert',table,record});
   return {select(){return {single:async()=>({data:table==='agenda_pages'?quickPage:
    {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},error:null})}}};
  },
  update(record){
   ctx.quickEvents.push({step:'publish',table,record});
   return {eq(){return {select(){return {single:async()=>({data:{...quickPage,published:true},error:null})}}}}};
  }
 }},
 rpc(name,args){
  ctx.quickEvents.push({step:'hours',name,args});
  return Promise.resolve({data:args.p_hours.length,error:null});
 }
};
ctx.quickClient=quickClient;
vm.runInContext('agendaRefreshOwner=async()=>{};agendaRefreshDirectory=async()=>{};agendaRuntime.client=quickClient;agendaRuntime.page=null;agendaRuntime.ownerMode=true;agendaRuntime.busy=false;agendaRuntime.user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"};',ctx);
await vm.runInContext('agendaQuickCreate({preventDefault(){},target:{business:"Barbearia Centro",city:"São Gabriel",service:"Corte",duration:"30",price:"35.00",schedule:"week_sat"}})',ctx);
assert.deepEqual(ctx.quickEvents.map(x=>x.step),['insert','insert','hours','publish']);
assert.equal(ctx.quickEvents[0].record.published,false,'Draft must precede service and weekly hours');
assert.equal(ctx.quickEvents[0].record.slug,'barbearia-centro','Friendly slug should use business name without random suffix when available');
assert.equal(ctx.quickEvents[1].record.price_cents,3500);
assert.equal(ctx.quickEvents[2].args.p_hours.length,6);
assert.equal(ctx.quickEvents[2].args.p_hours.find(h=>h.weekday===6).closes_min,780);
assert.equal(ctx.quickEvents[3].record.published,true);
assert.equal(vm.runInContext('agendaRuntime.page.published',ctx),true);

const collisionEvents=[];
ctx.collisionClient={
 from(table){return {
  insert(record){
   collisionEvents.push({table,record});
   if(table==='agenda_pages'&&collisionEvents.filter(x=>x.table==='agenda_pages').length===1)
    return {select(){return {single:async()=>({data:null,error:{code:'23505',message:'slug already used'}})}}};
   return {select(){return {single:async()=>({data:table==='agenda_pages'?quickPage:
    {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},error:null})}}};
  },
  update(record){return {eq(){return {select(){return {single:async()=>({data:{...quickPage,published:true},error:null})}}}}};}
 }},
 rpc(name,args){return Promise.resolve({data:args.p_hours.length,error:null});}
};
vm.runInContext('agendaRuntime.page=null;agendaRuntime.busy=false;agendaRuntime.client=collisionClient;',ctx);
await vm.runInContext('agendaQuickCreate({preventDefault(){},target:{business:"Barbearia Centro",city:"São Gabriel",service:"Corte",duration:"30",price:"35.00",schedule:"week_sat"}})',ctx);
assert.equal(collisionEvents.filter(x=>x.table==='agenda_pages').length,2,'Conflict must retry only the slug');
assert.equal(collisionEvents[0].record.slug,'barbearia-centro');
assert.match(collisionEvents[1].record.slug,/^barbearia-centro-[a-f0-9]{6}$/);
assert.equal(collisionEvents[1].record.published,false,'Never publish on conflict retry');
assert.equal(vm.runInContext('agendaRuntime.page.published',ctx),true,'After safe collision retry user can publish');

assert.match(vm.runInContext('agendaRuntime.notice',ctx),/publicada/);

// Browser email-link navigation retains a slot, but NEVER confirms a booking.
const store=new Map();
ctx.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),
 removeItem:key=>store.delete(key)};
const nextDay=vm.runInContext('agendaToday(2)',ctx);
const slot=vm.runInContext('agendaLocalHourToInstant("'+nextDay+'","12:00")',ctx);
ctx.slotClient={
 rpc(name,args){
  ctx.quickEvents.push({step:'read',name,args});
  if(name==='agenda_public_page')return Promise.resolve({data:{
   id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',slug:'barbearia-sg',title:'Barbearia SG',
   city:'São Gabriel',services:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',title:'Corte',duration_min:30,price_cents:3500}],
   staff:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Ana'}]},error:null});
  if(name==='agenda_available_staff_slots')return Promise.resolve({data:[{starts_at:slot,label:'12:00'}],error:null});
  if(name==='agenda_day_is_closed')return Promise.resolve({data:false,error:null});
  throw Error('Unexpected RPC '+name);
 }
};
vm.runInContext('agendaRuntime.user=null;agendaRuntime.client=slotClient;agendaRuntime.publicProfile=null;agendaRuntime.rescheduleId="";agendaRuntime.serviceId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";agendaRuntime.staffId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";agendaRuntime.day="'+nextDay+'";agendaRuntime.slots=[{starts_at:"'+slot+'",label:"12:00"}];',ctx);
vm.runInContext('agendaSelectSlot("'+slot+'")',ctx);
assert.match(store.get('tamao-agenda-pending-v1'),/barbearia-sg/);
assert.doesNotMatch(store.get('tamao-agenda-pending-v1'),/phone|email|customer_name/);
vm.runInContext('agendaRuntime.user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"};',ctx);
await vm.runInContext('agendaRefreshPublic()',ctx);
assert.equal(vm.runInContext('agendaRuntime.selectedStart',ctx),slot);
assert.equal(store.size,0,'Resume must erase the locally stored slot');
assert.equal(ctx.quickEvents.filter(x=>x.name==='agenda_book_staff_slot').length,0);
assert.equal(ctx.quickEvents.filter(x=>x.name==='agenda_available_staff_slots').length,1);
assert.equal(ctx.quickEvents.filter(x=>x.name==='agenda_day_is_closed').length,1);
assert.equal(ctx.quickEvents.filter(x=>x.name==='agenda_deposit_quote').length,0);

// No approval if a service could not be saved: leave an unpublished draft.
ctx.quickEvents=[];
ctx.failedClient={
 from(table){return {
  insert(record){
   ctx.quickEvents.push({step:'insert',table,record});
   return {select(){return {single:async()=>table==='agenda_services'?
    {data:null,error:{code:'400',message:'temporary failed service'}}:
    {data:quickPage,error:null}}}};
  },
  update(){throw Error('No publication permitted after partial failure')}
 }},
 rpc(){throw Error('No weekly hours after service failure')}
};
vm.runInContext('agendaRuntime.page=null;agendaRuntime.busy=false;agendaRuntime.client=failedClient;',ctx);
await vm.runInContext('agendaQuickCreate({preventDefault(){},target:{business:"Barbearia Centro",city:"São Gabriel",service:"Corte",duration:"30",price:"35.00",schedule:"week_sat"}})',ctx);
assert.equal(ctx.quickEvents.length,2);
assert.equal(vm.runInContext('agendaRuntime.page.published',ctx),false);
assert.match(vm.runInContext('agendaRuntime.error',ctx),/rascunho/);
console.log('PASS: Agenda V1.1053 rápida, RLS-only signup, draft-first publication, dates, login continuity, minimal calls, partial failure safely unpublished.');




// Latest request wins even if the visitor returns to the same date (A-B-A).
// Transport failures must not be presented as confirmed lack of availability.
const slotCtx=vm.createContext({
 URL,URLSearchParams,location:{origin:'https://tamao.com.br',pathname:'/agenda/barbearia-sg',hash:'',search:''},
 route:()=> 'agenda',render(){},shell:s=>s,esc:s=>String(s??''),
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
});
vm.runInContext(source+';this.runtime=agendaRuntime;this.load=agendaLoadSlots;this.publicView=agendaPublicView;',slotCtx);
const slotRt=slotCtx.runtime,requests=[];
const day=vm.runInContext('agendaToday()',slotCtx),otherDay=vm.runInContext('agendaToday(1)',slotCtx);
slotRt.client={rpc:(name,args)=>new Promise(resolve=>requests.push({name,args,resolve}))};
slotRt.slug='barbearia-sg';slotRt.serviceId='service-1';slotRt.day=day;
slotRt.publicProfile={title:'Agenda de teste',services:[{id:'service-1',title:'Serviço',duration_min:30,price_cents:1000}],staff:[]};
const first=slotCtx.load();slotRt.day=otherDay;const second=slotCtx.load();
slotRt.day=day;const third=slotCtx.load();
const resolvePair=(offset,data,error=null)=>{
 requests[offset].resolve({data,error});requests[offset+1].resolve({data:false,error:null});
};
resolvePair(0,[{starts_at:day+'T12:00:00Z',label:'09:00'}]);
await first;assert.equal(slotRt.slotBusy,true);assert.equal(slotRt.slots.length,0);
resolvePair(2,null,Error('old request failed'));
await second;assert.equal(slotRt.slotError,'');assert.equal(slotRt.slotBusy,true);
resolvePair(4,[{starts_at:day+'T13:00:00Z',label:'10:00'}]);
await third;assert.equal(slotRt.slotBusy,false);assert.equal(slotRt.slots[0].label,'10:00');
const failure=slotCtx.load();resolvePair(6,null,Error('network'));await failure;
assert.equal(slotRt.slotBusy,false);assert.match(slotRt.slotError,/Não foi possível consultar/);
const errorView=slotCtx.publicView();
assert.match(errorView,/Tentar novamente/);
assert.doesNotMatch(errorView,/Não há horários livres|Quer entrar na lista de espera/);
const retry=slotCtx.load();resolvePair(8,[]);await retry;
assert.equal(slotRt.slotError,'');
assert.match(slotCtx.publicView(),/Não há horários livres/);
assert.match(slotCtx.publicView(),/Quer entrar na lista de espera/);
console.log('PASS: Agenda slot query recovery, A-B-A race protection and accurate no-availability copy.');


// An ambiguous booking write is confirmed only by the exact persisted evidence.
const bookCtx=vm.createContext({
 URL,URLSearchParams,location:{pathname:'/agenda/barbearia-sg',hash:'',search:''},
 route:()=> 'agenda',render(){},FormData:class{constructor(t){this.t=t}get(k){return this.t[k]}},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
});
vm.runInContext(source+';this.rt=agendaRuntime;this.book=agendaBook;',bookCtx);
const bookRt=bookCtx.rt;
const evidence={id:'22222222-2222-4222-8222-222222222222',status:'confirmed',
 request_id:'11111111-1111-4111-8111-111111111111',customer_id:'33333333-3333-4333-8333-333333333333',
 service_id:'44444444-4444-4444-8444-444444444444',staff_id:'55555555-5555-4555-8555-555555555555',
 starts_at:'2026-12-01T12:00:00Z'};
let stored={...evidence},writeError=true,readError=false,writes=0,reads=0;
const client={rpc:async(name,args)=>{assert.equal(name,'agenda_book_staff_slot');assert.equal(args.p_request_id,evidence.request_id);writes++;return writeError?{error:Error('network')}:{data:{id:evidence.id,status:'confirmed'}};},
 from(table){assert.equal(table,'agenda_appointments');const filters={};
  const q={select(fields){assert.match(fields,/request_id,customer_id,service_id,staff_id/);return q;},
   eq(k,v){filters[k]=v;return q;},async maybeSingle(){reads++;assert.equal(filters.customer_id,evidence.customer_id);assert.equal(filters.request_id,evidence.request_id);return {data:stored,error:readError?Error('read failed'):null};}};return q;}};
bookCtx.agendaRefreshOwner=async()=>{throw Error('refresh unavailable')};
bookCtx.agendaLoadSlots=async()=>{};
const prepare=()=>Object.assign(bookRt,{client,user:{id:evidence.customer_id},busy:false,slotBusy:false,slotError:'',
 serviceId:evidence.service_id,staffId:evidence.staff_id,selectedStart:evidence.starts_at,requestKey:evidence.request_id,
 slots:[{starts_at:evidence.starts_at}],publicProfile:{staff:[{id:evidence.staff_id}]},notice:'',error:''});
const submit=()=>bookCtx.book({preventDefault(){},target:{name:'Pessoa Teste',phone:'55999998888'}});
for(const mismatch of [{starts_at:'2026-12-01T13:00:00Z'},{service_id:'other'},{staff_id:null},{customer_id:'other'},{request_id:'other'},{status:'cancelled'}]){
 prepare();stored={...evidence,...mismatch};await submit();
 assert.equal(bookRt.notice,'');assert.equal(bookRt.requestKey,evidence.request_id);assert.equal(bookRt.busy,false);
}
prepare();stored={...evidence};readError=true;await submit();assert.equal(bookRt.notice,'');assert.equal(bookRt.requestKey,evidence.request_id);
readError=false;prepare();await submit();assert.match(bookRt.notice,/Horário confirmado/);assert.equal(bookRt.requestKey,'');assert.equal(bookRt.error,'');
writeError=false;prepare();await submit();assert.match(bookRt.notice,/Horário confirmado/);
assert.equal(writes,9);assert.equal(reads,9);
console.log('PASS: exact persisted booking confirmation on normal and ambiguous writes, mismatches rejected, refresh failure preserves proof.');


// Recover ambiguous cancellation without claiming success from an RPC ack alone.
const cancelCtx=vm.createContext({URL,URLSearchParams,location:{pathname:'/agenda/',hash:'',search:''},
 route:()=> 'agenda',render(){},confirm:()=>true});
vm.runInContext(source+';this.rt=agendaRuntime;this.cancel=agendaCancel;',cancelCtx);
const cancelRt=cancelCtx.rt,cancelId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 cancelActor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',otherActor='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cancelBooking={id:cancelId,status:'confirmed'};
let cancelRow={id:cancelId,status:'cancelled',customer_id:cancelActor,owner_id:otherActor};
let cancelWrites=0,cancelReads=0,cancelReadError=false,cancelWriteError=true;
const cancelClient={rpc:async(name,args)=>{assert.equal(name,'agenda_cancel_booking');assert.equal(args.p_appointment_id,cancelId);
 cancelWrites++;if(cancelWriteError)throw Error('network');return {data:true};},
 from(table){assert.equal(table,'agenda_appointments');const q={select(fields){assert.match(fields,/customer_id,owner_id/);return q},
 eq(k,v){assert.equal(k,'id');assert.equal(v,cancelId);return q},async maybeSingle(){cancelReads++;return {data:cancelRow,error:cancelReadError?Error('network'):null}}};return q;}};
cancelCtx.agendaRefreshOwner=async()=>{throw Error('list unavailable')};
const prepareCancel=()=>Object.assign(cancelRt,{client:cancelClient,user:{id:cancelActor},busy:false,mine:[{...cancelBooking}],
 bookings:[],serviceId:'',notice:'',error:'',rescheduleId:cancelId});
prepareCancel();await cancelCtx.cancel(cancelId);
assert.equal(cancelRt.notice,'Horário cancelado.');assert.equal(cancelRt.mine.length,0);assert.equal(cancelRt.rescheduleId,'');
assert.equal(cancelRt.busy,false);
cancelWriteError=false;
for(const row of [{id:cancelId,status:'confirmed',customer_id:cancelActor},
 {id:cancelId,status:'cancelled',customer_id:otherActor,owner_id:otherActor},
 {id:otherActor,status:'cancelled',customer_id:cancelActor},null]){
 prepareCancel();cancelRow=row;await cancelCtx.cancel(cancelId);
 assert.equal(cancelRt.notice,'');assert.equal(cancelRt.mine.length,1);assert.match(cancelRt.error,/Não foi possível confirmar/);
}
prepareCancel();cancelRow={id:cancelId,status:'cancelled',owner_id:cancelActor,customer_id:otherActor};
cancelReadError=true;await cancelCtx.cancel(cancelId);assert.equal(cancelRt.mine.length,1);assert.equal(cancelRt.notice,'');
cancelReadError=false;prepareCancel();cancelRt.bookings=cancelRt.mine;cancelRt.mine=[];
await cancelCtx.cancel(cancelId);assert.equal(cancelRt.notice,'Horário cancelado.');assert.equal(cancelRt.bookings.length,0);
const callsBefore=cancelWrites;prepareCancel();cancelRt.mine=[];
await cancelCtx.cancel(cancelId);assert.equal(cancelWrites,callsBefore);
assert.equal(cancelReads,cancelWrites);
console.log('PASS: cancellation reconciles exact authorized record, lost write response, stale status, unavailable reads and owner access.');


// Rescheduling must preserve the original booking unless the exact new slot
// is independently read back for the same authorized customer or owner.
const moveCtx=vm.createContext({URL,URLSearchParams,location:{pathname:'/agenda/barbearia-sg',hash:'',search:''},
 route:()=> 'agenda',render(){},BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})});
vm.runInContext(source+';this.rt=agendaRuntime;this.move=agendaConfirmReschedule;',moveCtx);
const moveRt=moveCtx.rt,moveOld='2026-12-01T12:00:00Z',moveNew='2026-12-02T12:00:00Z';
const moveId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',moveUser='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 moveOwner='cccccccc-cccc-4ccc-8ccc-cccccccccccc',movePage='dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 moveService='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',moveStaff='ffffffff-ffff-4fff-8fff-ffffffffffff';
const moveBooking={id:moveId,status:'confirmed',page_id:movePage,service_id:moveService,staff_id:moveStaff,
 starts_at:moveOld,ends_at:'2026-12-01T12:30:00Z',reschedule_count:0};
const moveEvidence={...moveBooking,customer_id:moveUser,owner_id:moveOwner,starts_at:moveNew,
 ends_at:'2026-12-02T12:30:00Z',reschedule_count:1};
let moveRow=moveEvidence,moveReadError=false,moveWriteError=true,moveWrites=0,moveReads=0;
const moveClient={rpc:async(name,args)=>{assert.equal(name,'agenda_reschedule_booking');assert.equal(args.p_appointment_id,moveId);
 assert.equal(args.p_expected_starts_at,moveOld);assert.equal(args.p_new_starts_at,moveNew);moveWrites++;
 if(moveWriteError)throw Error('network');return {data:{id:moveId,status:'confirmed',starts_at:moveNew}};},
 from(table){assert.equal(table,'agenda_appointments');const q={select(fields){assert.match(fields,/customer_id,owner_id,page_id,service_id,staff_id/);return q},
 eq(k,v){assert.equal(k,'id');assert.equal(v,moveId);return q;},async maybeSingle(){moveReads++;return {data:moveRow,error:moveReadError?Error('read failed'):null}}};return q;}};
moveCtx.agendaRefreshOwner=async()=>{throw Error('list unavailable')};
moveCtx.agendaLoadSlots=async()=>{};
const prepareMove=()=>Object.assign(moveRt,{client:moveClient,user:{id:moveUser},busy:false,slotBusy:false,slotError:'',
 mine:[{...moveBooking}],bookings:[],publicProfile:{id:movePage},serviceId:moveService,staffId:moveStaff,
 rescheduleId:moveId,selectedStart:moveNew,slots:[{starts_at:moveNew}],notice:'',error:''});
for(const mismatch of [{id:moveOwner},{page_id:moveOwner},{service_id:moveOwner},{staff_id:null},
 {customer_id:moveOwner},{status:'cancelled'},{starts_at:moveOld},{ends_at:moveNew},{reschedule_count:0}]){
 prepareMove();moveRow={...moveEvidence,...mismatch};await moveCtx.move();
 assert.equal(moveRt.notice,'');assert.equal(moveRt.mine[0].starts_at,moveOld);
 assert.equal(moveRt.rescheduleId,moveId);assert.equal(moveRt.busy,false);
}
prepareMove();moveRow=moveEvidence;moveReadError=true;await moveCtx.move();
assert.equal(moveRt.notice,'');assert.equal(moveRt.mine[0].starts_at,moveOld);
moveReadError=false;prepareMove();await moveCtx.move();
assert.match(moveRt.notice,/Horário remarcado/);assert.equal(moveRt.mine[0].starts_at,moveNew);
assert.equal(moveRt.mine[0].reschedule_count,1);assert.equal(moveRt.rescheduleId,'');
moveWriteError=false;prepareMove();moveRt.user={id:moveOwner};moveRt.bookings=moveRt.mine;moveRt.mine=[];
await moveCtx.move();assert.match(moveRt.notice,/Horário remarcado/);assert.equal(moveRt.bookings[0].starts_at,moveNew);
const priorMoveWrites=moveWrites;prepareMove();moveRt.slotError='Falha na consulta';await moveCtx.move();
assert.equal(moveWrites,priorMoveWrites);assert.equal(moveReads,moveWrites);
console.log('PASS: rescheduling reconciles exact authorized persisted booking, preserves original on mismatch, and keeps confirmed calendar metadata.');


// Waitlist confirmation is scoped to the exact customer, service, staff and day.
// Closing an already closed entry must report the actual persisted outcome.
const waitCtx=vm.createContext({URL,URLSearchParams,location:{pathname:'/agenda/barbearia-sg',hash:'',search:''},
 route:()=> 'agenda',render(){},FormData:class{constructor(t){this.t=t}get(k){return this.t[k]}}});
vm.runInContext(source+';this.rt=agendaRuntime;this.join=agendaJoinWaitlist;this.close=agendaCloseWaitlist;',waitCtx);
const waitRt=waitCtx.rt,waitId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 waitUser='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',waitOwner='cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 waitPage='dddddddd-dddd-4ddd-8ddd-dddddddddddd',waitService='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const waitEvidence={id:waitId,page_id:waitPage,service_id:waitService,staff_id:null,
 customer_id:waitUser,owner_id:waitOwner,day:'2026-12-01',status:'waiting',created_at:'2026-11-25T12:00:00Z'};
let waitRow=waitEvidence,waitReadError=false,waitCalls=0;
const waitClient={rpc:async()=>{waitCalls++;throw Error('lost response')},
 from(table){assert.equal(table,'agenda_waitlist');const q={select(){return q},eq(){return q},is(){return q},
 async maybeSingle(){return {data:waitRow,error:waitReadError?Error('read failed'):null}}};return q;}};
waitCtx.agendaRefreshOwner=async()=>{throw Error('list unavailable')};
const prepareWait=()=>Object.assign(waitRt,{client:waitClient,user:{id:waitUser},busy:false,slotBusy:false,slotError:'',
 dayClosed:false,slots:[],rescheduleId:'',publicProfile:{id:waitPage},serviceId:waitService,staffId:'',
 day:waitEvidence.day,myWaiting:[],waiting:[],notice:'',error:''});
const joinWait=()=>waitCtx.join({preventDefault(){},target:{name:'Pessoa Teste',phone:'55999998888',consent:'on'}});
for(const mismatch of [{customer_id:waitOwner},{page_id:waitOwner},{service_id:waitOwner},{staff_id:waitOwner},
 {day:'2026-12-02'},{status:'withdrawn'}]){
 prepareWait();waitRow={...waitEvidence,...mismatch};await joinWait();
 assert.equal(waitRt.notice,'');assert.equal(waitRt.myWaiting.length,0);assert.equal(waitRt.busy,false);
}
prepareWait();waitRow=waitEvidence;waitReadError=true;await joinWait();assert.equal(waitRt.myWaiting.length,0);
waitReadError=false;prepareWait();await joinWait();assert.match(waitRt.notice,/Pedido de contato registrado/);
assert.equal(waitRt.myWaiting[0].id,waitId);
const beforeWait=waitCalls;prepareWait();waitRt.slotError='Falha';await joinWait();assert.equal(waitCalls,beforeWait);
const closedRow={...waitEvidence,status:'withdrawn',closed_at:'2026-11-25T13:00:00Z'};
prepareWait();waitRt.myWaiting=[{id:waitId}];waitRow=closedRow;await waitCtx.close(waitId,false);
assert.match(waitRt.notice,/Participação retirada/);assert.equal(waitRt.myWaiting.length,0);
prepareWait();waitRt.user={id:waitOwner};waitRt.waiting=[{id:waitId}];await waitCtx.close(waitId,true);
assert.match(waitRt.notice,/já foi retirada/);assert.equal(waitRt.waiting.length,0);
prepareWait();waitRt.myWaiting=[{id:waitId}];waitRow={...closedRow,status:'contacted'};await waitCtx.close(waitId,false);
assert.match(waitRt.notice,/já foi encerrada com contato/);
prepareWait();waitRt.myWaiting=[{id:waitId}];waitRow={...closedRow,customer_id:waitOwner};await waitCtx.close(waitId,false);
assert.equal(waitRt.notice,'');assert.equal(waitRt.myWaiting.length,1);
prepareWait();waitRt.myWaiting=[{id:waitId}];waitRow=closedRow;waitReadError=true;await waitCtx.close(waitId,false);
assert.equal(waitRt.notice,'');assert.equal(waitRt.myWaiting.length,1);
console.log('PASS: Agenda waitlist verifies exact persisted participation and actual closing status.');


// QR generation is optional: a failed script must not block sharing forever.
const qrTimers=new Map(),qrScripts=[];
let qrTimer=0,qrAppendFail=false;
const qrCtx=vm.createContext({URL,URLSearchParams,location:{pathname:'/agenda/',hash:'',search:''},
 route:()=> 'agenda',render(){},
 setTimeout(fn,ms){assert.equal(ms,15000);qrTimers.set(++qrTimer,fn);return qrTimer;},
 clearTimeout(id){qrTimers.delete(id)},
 document:{createElement(){return {remove(){this.removed=true}}},
 querySelector(){return {src:'https://tamao.com.br/js/agenda.js?v=1244'}},
 head:{appendChild(script){if(qrAppendFail)throw Error('append failed');qrScripts.push(script);}}}});
vm.runInContext(source+';this.rt=agendaRuntime;this.load=agendaLoadQr;this.toggle=agendaToggleQr;',qrCtx);
const qrRt=qrCtx.rt;
qrRt.user={id:'owner'};qrRt.page={id:'page',slug:'barbearia-centro',published:true};
const pendingQr=qrCtx.toggle();
assert.equal(qrRt.qrBusy,true);
await qrCtx.toggle();assert.equal(qrScripts.length,1);
assert.equal(qrScripts[0].src,'/js/qr-generator.js?v=1244');
assert.equal(qrTimers.size,1);
const timeoutFn=[...qrTimers.values()][0];timeoutFn();await pendingQr;
assert.equal(qrRt.qrBusy,false);assert.equal(qrRt.qrOpen,false);
assert.equal(qrScripts[0].removed,true);assert.equal(qrTimers.size,0);
assert.match(qrRt.error,/Tente novamente/);
qrAppendFail=true;await qrCtx.toggle();assert.equal(qrRt.qrBusy,false);assert.equal(qrTimers.size,0);
qrAppendFail=false;
const retryQr=qrCtx.toggle();assert.equal(qrScripts.length,2);
qrScripts[0].onload();assert.equal(qrRt.qrBusy,true);
vm.runInContext(qrLibrary,qrCtx);
qrScripts[1].onload();await retryQr;
assert.equal(qrRt.qrOpen,true);assert.equal(qrRt.qrBusy,false);assert.equal(qrTimers.size,0);
await qrCtx.toggle();assert.equal(qrRt.qrOpen,false);
await qrCtx.toggle();assert.equal(qrRt.qrOpen,true);assert.equal(qrScripts.length,2);
console.log('PASS: Agenda QR bounded download, duplicate guard, retry, late callback and real SVG generation.');
