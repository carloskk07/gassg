import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// V1.1084 — actual LOCAL Supabase Auth + Edge + PostgREST + PostgreSQL.
// The requested participant is a disposable BARBERSHOP, not a production user.
// No external PSP, real invitation, remote Supabase access or live commerce.
assert.equal(process.env.CI,'true','CI-only destructive local fixture');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
assert.ok(!process.env.TAMAO_PRODUCTION_DATABASE_URL);
const output=execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
});
const env=Object.fromEntries(output.split('\n').map(s=>{
 const m=s.match(/^([A-Z_]+)=(.*)$/);
 return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const base=(env.API_URL||env.SUPABASE_URL||'').replace(/\/$/,'');
const anon=env.ANON_KEY||env.SUPABASE_ANON_KEY||'';
const service=env.SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321$/);
assert.ok(anon.length>25&&service.length>25);
const origin='https://tamao.com.br';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sql=q=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+q
],{encoding:'utf8',timeout:30000,env:{...process.env,PGPASSWORD:'postgres'}}).trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const prefix='ci-virtual-barbearia-'+randomUUID().slice(0,8);
const initial={
 pages:Number(sql('select count(*) from public.participant_pages_v1_1072')),
 appointments:Number(sql('select count(*) from public.agenda_appointments')),
 financial:Number(sql('select count(*) from public.merchant_billing_payment_requests')),
 orders:Number(sql('select count(*) from public.orders'))
};
const trace={scenario:'virtual_barbershop_isolated_v1_1084',backend:'real localhost Auth, Edge, Data API and SQL',
 productionWrites:0, financialWrites:0, events:[],initial};
const record=(step,details={})=>{trace.events.push({step,ok:true,...details});console.log('PASS '+step)};
const actors=[];
let agendaPage=null,serviceId=null,personalPage=null;
async function request(path,{method='POST',token=null,body,headers={}}={}){
 assert.ok(path.startsWith('/'),'Only relative local path supported');
 const response=await fetch(base+path,{
  method,headers:{apikey:anon,Authorization:'Bearer '+(token||anon),
   Origin:origin,'Content-Type':'application/json',...headers},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(105000)
 });
 const payload=await response.text();
 let data;try{data=payload?JSON.parse(payload):null}catch{data=payload}
 return {status:response.status,data,headers:response.headers};
}
async function actor(role){
 const email=prefix+'-'+role+'@example.invalid',password='LocalOnly!'+randomUUID();
 const res=await fetch(base+'/auth/v1/admin/users',{
  method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,
    'Content-Type':'application/json'},
  body:JSON.stringify({email,password,email_confirm:true}),signal:AbortSignal.timeout(30000)
 });
 assert.ok([200,201].includes(res.status),'Local test identity: '+role);
 const obj=await res.json(),id=obj.id||obj.user?.id;
 assert.match(id,UUID);
 const signed=await request('/auth/v1/token?grant_type=password',{
  method:'POST',body:{email,password}
 });
 assert.equal(signed.status,200,'Real Auth password login: '+role);
 assert.equal(signed.data.user?.id,id);
 assert.ok(signed.data.access_token?.length>100);
 const user={id,token:signed.data.access_token,role};
 actors.push(user);
 return user;
}
const post=(slug,body,token)=>request('/functions/v1/'+slug,{body,token});
const rest=(resource,{method,body,token=null,prefer=null}={})=>request(
 '/rest/v1/'+resource,{method:method||(body!==undefined?'POST':'GET'),body,token,
 headers:prefer?{Prefer:prefer}:{}});
const oneRow=async (result,label)=>{
 assert.ok(result.status>=200&&result.status<300,
  label+': HTTP '+result.status+' '+JSON.stringify(result.data).slice(0,420));
 assert.ok(Array.isArray(result.data)&&result.data.length===1,label+' row required');
 return result.data[0];
};
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'});
const futureDay=()=>{
 const next=new Date(today()+'T12:00:00.000Z');next.setUTCDate(next.getUTCDate()+3);
 return next.toISOString().slice(0,10);
};
try{
 const owner=await actor('titular'),customer=await actor('cliente'),other=await actor('outra-conta');
 record('Local Auth signup and verified login for owner/customer/other (3 users)');
 // Genuine signup must provision a proper, non-TMR customer referral code.
 const referral=sql('select referral_code from public.profiles where user_id='+quote(owner.id)+'::uuid');
 assert.match(referral,/^[A-Z0-9]{5,40}$/,'Verified owner must receive a real invitation code');
 assert.ok(!/^TMR[A-F0-9]{24}$/.test(referral));
 record('Verified owner has original customer referral', {referralCodeValid:true});
 const notSigned=await post('participant-pages',{action:'mine',kind:'customer'});
 assert.equal(notSigned.status,401);
 assert.equal(notSigned.data.error,'LOGIN_REQUIRED');
 record('Private editor rejects anonymous sessions');
 const slug=prefix.replace('ci-','').slice(0,58);
 const draft=await oneRow(await rest('agenda_pages?select=id,slug,owner_id,published',{
  method:'POST',token:owner.token,prefer:'return=representation',
  body:{slug,title:'Barbearia Virtual TAMÃO',city:'São Gabriel',published:false}
 }),'owner official Agenda draft');
 agendaPage=draft.id;assert.equal(draft.owner_id,owner.id);assert.equal(draft.published,false);
 record('Owner creates an unpublished official Agenda using authenticated Data API');
 const pre=await post('participant-pages',{action:'save',kind:'agenda',
  subjectId:agendaPage,published:true,theme:'ocean'},owner.token);
 assert.equal(pre.status,409,'Page cannot appear before its official Agenda is ready');
 assert.equal(pre.data.error,'NOT_PUBLISHED');
 record('Microsite publication refuses an unpublished underlying Agenda');
 const service=await oneRow(await rest('agenda_services?select=id,page_id,price_cents',{
  method:'POST',token:owner.token,prefer:'return=representation',
  body:{page_id:agendaPage,title:'Corte de cabelo',duration_min:45,price_cents:6000}
 }),'real service insert');
 serviceId=service.id;
 assert.equal(service.page_id,agendaPage);
 const hours=Array.from({length:7},(_,weekday)=>({weekday,opens_min:540,closes_min:1080}));
 const schedule=await rest('rpc/agenda_replace_hours',{method:'POST',token:owner.token,
  body:{p_page_id:agendaPage,p_hours:hours}});
 assert.ok([200,204].includes(schedule.status),
  'Official weekly hours: '+schedule.status+' '+JSON.stringify(schedule.data));
 const published=await oneRow(await rest('agenda_pages?id=eq.'+agendaPage+'&select=id,published,slug',{
  method:'PATCH',token:owner.token,prefer:'return=representation',body:{published:true}
 }),'official Agenda publication');
 assert.equal(published.published,true);
 record('Owner adds priced service, weekly hours and publishes Agenda (no payment)');
 const publicAgenda=await rest('rpc/agenda_public_page',{body:{p_slug:slug}});
 assert.equal(publicAgenda.status,200);
 assert.equal(publicAgenda.data?.slug,slug);
 assert.equal(publicAgenda.data?.title,'Barbearia Virtual TAMÃO');
 record('Anonymous visitor reads the actual published Agenda and service');
 const empty=await post('participant-pages',{action:'mine',kind:'agenda',subjectId:agendaPage},owner.token);
 assert.equal(empty.status,200);
 assert.equal(empty.data.page,null);
 assert.deepEqual(empty.data.photoChoices,[]);
 const crossMine=await post('participant-pages',{action:'mine',kind:'agenda',subjectId:agendaPage},other.token);
 assert.equal(crossMine.status,403);assert.equal(crossMine.data.error,'NOT_OWNER');
 record('Premium editor opens for owner; another account is denied');
 const saved=await post('participant-pages',{action:'save',kind:'agenda',subjectId:agendaPage,
  published:true,theme:'ocean',layout:'editorial',
  headline:'Seu estilo começa aqui',tagline:'Corte com hora marcada, sem complicação.',
  showAbout:true,showGallery:true,showCatalog:false,showDiscover:false,
  heroPhotoKey:''},owner.token);
 assert.equal(saved.status,200,
  'Real Edge page publish: '+saved.status+' '+JSON.stringify(saved.data));
 assert.equal(saved.data.page?.published,true);
 assert.equal(saved.data.page?.theme,'ocean');
 assert.equal(saved.data.page?.layout,'editorial');
 personalPage=saved.data.page;
 assert.match(personalPage.url,/^https:\/\/tamao\.com\.br\/p\/[a-z0-9-]+\/$/);
 record('Real Edge saves personalized theme, layout, message, sections and stable link');
 const read=await post('participant-pages',{action:'view',slug:personalPage.slug});
 assert.equal(read.status,200,'Anonymous Edge must return published content');
 const pg=read.data;
 assert.equal(pg.slug,personalPage.slug);assert.equal(pg.theme,'ocean');
 assert.equal(pg.layout,'editorial');assert.equal(pg.headline,'Seu estilo começa aqui');
 assert.equal(pg.referralCode,referral);assert.equal(pg.agendaSlug,slug);
 assert.equal(pg.showDiscover,false);
 assert.ok(!('ownerId'in pg)&&!('customer_phone'in pg)&&!('email'in pg));
 assert.ok(!JSON.stringify(pg).includes(owner.id));
 record('Public API returns approved identity, original referral and Agenda route without private data');
 const copy=await post('participant-pages',{action:'mine',kind:'agenda',subjectId:agendaPage},owner.token);
 assert.equal(copy.status,200);assert.equal(copy.data.page?.slug,personalPage.slug);
 assert.equal(copy.data.page?.theme,'ocean');
 assert.equal(copy.data.page?.headline,'Seu estilo começa aqui');
 assert.equal(copy.data.page?.showDiscover,false);
 record('Owner reloads same saved configuration and short link');
 // Same actual Edge response drives the Cloudflare HTML social card.
 const src=fs.readFileSync(new URL('../functions/_shared/native-route.js',import.meta.url),'utf8');
 const html=fs.readFileSync(new URL('../p/index.html',import.meta.url),'utf8');
 const ctx=vm.createContext({URL,Response,Headers,AbortController,setTimeout,clearTimeout,
  fetch:async()=>new Response(JSON.stringify(pg),{status:200,headers:{'Content-Type':'application/json'}})});
 vm.runInContext(src.replace('export async function nativePageRoute','async function nativePageRoute')+
  '\nthis.route=nativePageRoute',ctx);
 const shell=await ctx.route({request:{method:'GET',url:personalPage.url},
  env:{ASSETS:{fetch:async()=>new Response(html,{
   status:200,headers:{'Content-Type':'text/html; charset=utf-8'}})}},
  next:()=>new Response('NEXT',{status:299})},'p');
 assert.equal(shell.status,200);
 assert.equal(shell.headers.get('x-robots-tag'),'index, follow');
 const social=await shell.text();
 assert.ok(social.includes('Barbearia Virtual TAMÃO • TAMÃO'));
 assert.ok(social.includes('Corte com hora marcada, sem complicação.'));
 assert.ok(social.includes('<meta property="og:url" content="'+personalPage.url+'">'));
 const dest=new URL('https://tamao.com.br/agenda/'+slug+'/');
 dest.searchParams.set('ref',referral);
 assert.match(dest.href,/^https:\/\/tamao\.com\.br\/agenda\/[a-z0-9-]+\/\?ref=/);
 record('Cloudflare-rendered HTML contains the verified participant sharing card; booking link retains referral');
 const wrongOwner=await post('participant-pages',{action:'save',kind:'agenda',subjectId:agendaPage,
  published:false,theme:'rose'},other.token);
 assert.equal(wrongOwner.status,403);
 const tamper=await post('participant-pages',{action:'save',kind:'agenda',subjectId:agendaPage,
  published:true,theme:'gold',heroPhotoKey:'https://evil.invalid/banner.png'},owner.token);
 assert.equal(tamper.status,403);
 const xss=await post('participant-pages',{action:'save',kind:'agenda',subjectId:agendaPage,
  published:true,headline:'<img src=x onerror=alert(1)>'},owner.token);
 assert.equal(xss.status,400);assert.equal(xss.data.error,'INVALID_TEXT');
 record('Foreign account, unapproved photo and HTML injection fail closed');
 const day=futureDay();
 const available=await rest('rpc/agenda_available_slots',{
  body:{p_service_id:serviceId,p_day:day}});
 assert.equal(available.status,200);
 assert.ok(Array.isArray(available.data)&&available.data.length>0,
  'Published free Agenda must yield actual available slots');
 const slot=available.data.find(x=>x.label==='10:00')||available.data[0];
 assert.ok(slot.starts_at);
 const idem=randomUUID();
 const bookingBody={p_service_id:serviceId,p_starts_at:slot.starts_at,
  p_name:'Cliente Virtual',p_phone:'+5555999999999',
  p_request_id:idem,p_staff_id:null};
 const booked=await rest('rpc/agenda_book_staff_slot',{
  body:bookingBody,token:customer.token});
 assert.equal(booked.status,200,'Real authenticated booking: '+JSON.stringify(booked.data));
 assert.match(booked.data.id,UUID);assert.equal(booked.data.status,'confirmed');
 const bookedAgain=await rest('rpc/agenda_book_staff_slot',{
  body:bookingBody,token:customer.token});
 assert.equal(bookedAgain.status,200);assert.equal(bookedAgain.data.id,booked.data.id);
 record('Customer books through real RPC; replay does not create duplicate booking');
 const customerRead=await rest('agenda_appointments?select=id,status,starts_at&id=eq.'+booked.data.id,{
  token:customer.token});
 assert.equal(customerRead.status,200);assert.equal(customerRead.data.length,1);
 assert.equal(customerRead.data[0].status,'confirmed');
 const unavailable=await rest('rpc/agenda_available_slots',{
  body:{p_service_id:serviceId,p_day:day}});
 assert.ok(!unavailable.data.some(x=>x.starts_at===slot.starts_at));
 const double=await rest('rpc/agenda_book_staff_slot',{
  body:{...bookingBody,p_request_id:randomUUID(),p_name:'Outro Cliente'},
  token:other.token});
 assert.ok(double.status>=400,'Exact occupied slot must reject another customer');
 assert.ok(String(double.data.message||'').includes('AGENDA_SLOT_ALREADY_TAKEN'));
 record('Buyer readback proves booking; occupied slot is removed and double booking rejected');
 const cancelled=await rest('rpc/agenda_cancel_booking',{token:customer.token,
  body:{p_appointment_id:booked.data.id}});
 assert.equal(cancelled.status,200);assert.equal(cancelled.data,true);
 const again=await rest('rpc/agenda_available_slots',{
  body:{p_service_id:serviceId,p_day:day}});
 assert.ok(again.data.some(x=>x.starts_at===slot.starts_at));
 const rebook=await rest('rpc/agenda_book_staff_slot',{
  body:{...bookingBody,p_request_id:randomUUID(),p_name:'Outro Cliente'},
  token:other.token});
 assert.equal(rebook.status,200);assert.equal(rebook.data.status,'confirmed');
 record('Cancellation immediately frees slot; another verified customer can book');
 const off=await post('participant-pages',{action:'save',kind:'agenda',subjectId:agendaPage,
  published:false,theme:'ocean',layout:'editorial'},owner.token);
 assert.equal(off.status,200);assert.equal(off.data.page.published,false);
 const invisible=await post('participant-pages',{action:'view',slug:personalPage.slug});
 assert.equal(invisible.status,404);
 const back=await post('participant-pages',{action:'save',kind:'agenda',subjectId:agendaPage,
  published:true,theme:'midnight',layout:'centered',headline:'Barbearia Virtual TAMÃO'},owner.token);
 assert.equal(back.status,200);
 assert.equal(back.data.page.slug,personalPage.slug,'No changed link during republication');
 const againPublic=await post('participant-pages',{action:'view',slug:personalPage.slug});
 assert.equal(againPublic.status,200);assert.equal(againPublic.data.theme,'midnight');
 assert.equal(againPublic.data.referralCode,referral);
 assert.equal(sql('select count(*) from public.participant_pages_v1_1072 where subject_id='+
  quote(agendaPage)+'::uuid'),'1','Re-publish is upsert and never duplicates pages');
 record('Unpublish returns 404, republish keeps same link/referral and updates premium style');
 // No financial side effect in a free appointment journey.
 assert.equal(Number(sql('select count(*) from public.orders')),initial.orders);
 assert.equal(Number(sql('select count(*) from public.merchant_billing_payment_requests')),initial.financial);
 assert.equal(Number(sql('select count(*) from public.agenda_payment_attempts')),0);
 record('No order, Pix, charge, commission or financial attempt generated');
}finally{
 // The entire local database is discarded by CI. Also remove the fixture here
 // to catch accidental persistence within this disposable job.
 if(agendaPage&&UUID.test(agendaPage)){
  sql('delete from public.agenda_booking_events where appointment_id in ('+
   'select id from public.agenda_appointments where page_id='+quote(agendaPage)+'::uuid);'+
   'delete from public.agenda_appointments where page_id='+quote(agendaPage)+'::uuid;'+
   'delete from public.participant_pages_v1_1072 where subject_id='+quote(agendaPage)+'::uuid;'+
   'delete from public.agenda_pages where id='+quote(agendaPage)+'::uuid;');
 }
 for(const actor of actors){
  const res=await fetch(base+'/auth/v1/admin/users/'+actor.id,{
   method:'DELETE',headers:{apikey:service,Authorization:'Bearer '+service},
   signal:AbortSignal.timeout(30000)});
  assert.ok([200,204].includes(res.status),'Remove temporary '+actor.role+' identity');
 }
 const remains={
  pages:Number(sql('select count(*) from public.participant_pages_v1_1072')),
  appointments:Number(sql('select count(*) from public.agenda_appointments')),
  financial:Number(sql('select count(*) from public.merchant_billing_payment_requests')),
  orders:Number(sql('select count(*) from public.orders'))
 };
 assert.deepEqual(remains,initial,'All virtual participant records must be removed');
 trace.cleanup={ok:true,countsRestored:true,usersRemoved:actors.length};
 fs.mkdirSync('test-results/virtual-participant',{recursive:true});
 fs.writeFileSync('test-results/virtual-participant/report.json',JSON.stringify(trace,null,2)+'\n');
}
assert.equal(trace.events.length,18,'All expected journey checkpoints must execute');
console.log('V1.1084 PASS — '+trace.events.length+
 ' connected steps in real disposable Auth/Edge/PostgreSQL + zero live data and zero payments.');
