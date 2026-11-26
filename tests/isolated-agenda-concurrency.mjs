import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
// Dedicated last step of disposable integration only. No provider calls or hosted DB.
assert.equal(process.env.CI,'true');
assert.equal(process.env.TAMAO_DISPOSABLE_CONCURRENCY,'1');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const env={...process.env,PGPASSWORD:'postgres',PGHOSTADDR:'127.0.0.1',PGCONNECT_TIMEOUT:'10',PGSSLMODE:'disable'};
// libpq treats even an empty PGSERVICEFILE as an explicit path.
delete env.PGSERVICE;
delete env.PGSERVICEFILE;
const args=q=>['--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+q];
const sql=q=>execFileSync('psql',args(q),{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
const run=promisify(execFile);
const asyncSql=q=>run('psql',args(q),{env,encoding:'utf8',timeout:30000});
const owner=randomUUID(),page=randomUUID(),service=randomUUID();
const buyers=Array.from({length:8},()=>({id:randomUUID(),request:randomUUID()}));
const ids=[owner,...buyers.map(b=>b.id)];
sql(`begin;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',id::text||'@example.org',now(),false,now(),now()
from unnest(array[${ids.map(id=>"'"+id+"'::uuid").join(',')}]) as t(id);
-- Use the same verified owner context required by the existing Agenda SQL tests.
set local "request.jwt.claim.sub"='${owner}';
do $owner_check$ begin if not public.discovery_verified_account() then raise exception 'AGENDA_CI_OWNER_NOT_VERIFIED'; end if; end $owner_check$;
insert into public.agenda_pages(id,owner_id,slug,title,about,city,published)
values('${page}','${owner}','ci-race-${page}','Agenda concorrência CI','Fixture descartável','São Gabriel',true);
insert into public.agenda_services(id,page_id,owner_id,title,duration_min,price_cents)
values('${service}','${page}','${owner}','Corte CI',45,6000);
insert into public.agenda_hours(page_id,owner_id,weekday,opens_min,closes_min)
values('${page}','${owner}',extract(dow from ((now() at time zone 'America/Sao_Paulo')::date+2))::int,540,1080);
commit;`);
const slot=sql(`select starts_at from public.agenda_available_slots('${service}',(now() at time zone 'America/Sao_Paulo')::date+2) where label='10:00' limit 1;`);
assert.ok(/^\d{4}-\d{2}-\d{2} /.test(slot),'fixture slot must be offered');
const booking=b=>`begin; set local statement_timeout='15s'; set local role authenticated;
set local "request.jwt.claim.sub"='${b.id}';
select public.agenda_book_slot('${service}','${slot}'::timestamptz,'Cliente CI','+5555999999999','${b.request}')::text;
commit;`;
const outcomes=await Promise.allSettled(buyers.map(b=>asyncSql(booking(b))));
const winners=outcomes.flatMap((o,i)=>o.status==='fulfilled'?[{buyer:buyers[i],value:JSON.parse(o.value.stdout.trim())}]:[]);
assert.equal(winners.length,1,'exactly one of eight independent database sessions must win');
assert.equal(winners[0].value.status,'confirmed');
for(const o of outcomes.filter(o=>o.status==='rejected')) assert.match(String(o.reason.stderr||o.reason.message),/AGENDA_SLOT_ALREADY_TAKEN/,'only an expected slot conflict is allowed');
const count=()=>sql(`select count(*) from public.agenda_appointments where page_id='${page}';`);
assert.equal(count(),'1','no duplicate or orphan appointments');
const repeats=await Promise.all(Array.from({length:4},()=>asyncSql(booking(winners[0].buyer))));
for(const r of repeats) assert.equal(JSON.parse(r.stdout.trim()).id,winners[0].value.id,'same request must return original booking');
assert.equal(count(),'1','parallel retries must not create duplicates');
console.log('PASS: 8 concurrent sessions, one booking, 7 slot conflicts, 4 safe replays. No live users or payments.');

 
// Candidate RPC is installed only on this guarded disposable localhost stack.
// Independent sessions cannot share a rollback-only transaction; fixtures
// are synthetic and the disposable stack is destroyed by the workflow.
const atomicOwner=randomUUID(),atomicSlug='ci-atomic-'+randomUUID();
const signature='public.agenda_create_atomic(text,text,text,text,integer,integer,text)';
const candidate=readFileSync(new URL('../supabase/proposals/agenda_atomic_onboarding.sql',import.meta.url),'utf8');
sql(candidate);
try{
 sql(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
 values('${atomicOwner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${atomicOwner}@example.org',now(),false,now(),now());`);
 const create=i=>`begin; set local statement_timeout='15s'; set local role authenticated;
 set local "request.jwt.claim.sub"='${atomicOwner}';
 select public.agenda_create_atomic('${atomicSlug}','Agenda CI ${i}','São Gabriel','Corte CI',45,6000,'week_sat')::text;
 commit;`;
 const results=await Promise.all(Array.from({length:8},(_,i)=>asyncSql(create(i))));
 const rows=results.map(r=>JSON.parse(r.stdout.trim()));
 const created=rows.filter(r=>r.created===true);
 assert.equal(created.length,1,'exactly one initial creation');
 const id=created[0].id;
 assert.ok(/^[0-9a-f-]{36}$/.test(id));
 assert.ok(rows.every(r=>r.id===id&&r.published===true&&r.slug===atomicSlug),'all sessions return same published page');
 assert.equal(sql(`select count(*) from public.agenda_pages where owner_id='${atomicOwner}';`),'1');
 assert.equal(sql(`select count(*) from public.agenda_services where page_id='${id}' and owner_id='${atomicOwner}';`),'1');
 assert.equal(sql(`select count(*) from public.agenda_hours where page_id='${id}' and owner_id='${atomicOwner}';`),'6');
 console.log('PASS: eight independent atomic onboarding sessions; one creation, seven safe replays, one service and six days.');
}finally{
 sql(`drop function ${signature};`);
}
