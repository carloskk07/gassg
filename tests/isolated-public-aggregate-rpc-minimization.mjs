import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Security Advisor: all intentional public SECURITY DEFINER functions must
// return read-only anonymous storefront aggregates without identity or money
// transfer metadata. All operations target CI localhost PostgreSQL only.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=statement=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+statement
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const anonRead=name=>{
 assert.match(name,/^[a-z0-9_]+$/);
 const output=sql('BEGIN READ ONLY; SET LOCAL ROLE anon; '+
  'SELECT public.'+name+'()::text; ROLLBACK;');
 return JSON.parse(output.split('\n').find(x=>x.trim().startsWith('{'))||'null');
};
const required=['clube_coupon_home_prices_v1_820','welcome_bonus_status_v1_815',
 'agenda_available_slots','agenda_public_directory','agenda_public_page'];
const actual=JSON.parse(sql(
 "SELECT coalesce(jsonb_agg(p.proname ORDER BY p.proname),'[]'::jsonb)::text "+
 "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "+
 "WHERE n.nspname='public' AND p.prosecdef "+
 "AND has_function_privilege('anon',p.oid,'EXECUTE')"));
assert.deepEqual(actual,[...required].sort(),
 'any new public SECURITY DEFINER requires explicit review');
const coupon=anonRead('clube_coupon_home_prices_v1_820');
assert.deepEqual(Object.keys(coupon).sort(),['packages','source']);
assert.equal(coupon.source,'clube_coupon_home_prices_v1_820');
assert.ok(Array.isArray(coupon.packages));
for(const pack of coupon.packages){
 assert.deepEqual(Object.keys(pack).sort(),[
  'couponCount','databaseReleased','faceCents','key','minOrderCents',
  'priceCents','title','validDays'
 ],'public catalogue cannot leak tax IDs, user data or payment references');
 assert.equal(typeof pack.databaseReleased,'boolean');
 for(const amount of ['priceCents','faceCents','minOrderCents'])
  assert.ok(Number.isSafeInteger(pack[amount])&&pack[amount]>=0,
   'public prices must be integer cents');
}
const welcome=anonRead('welcome_bonus_status_v1_815');
assert.deepEqual(Object.keys(welcome).sort(),
 ['active','awardCents','claimed','remaining']);
assert.equal(typeof welcome.active,'boolean');
for(const key of ['awardCents','claimed','remaining'])
 assert.ok(Number.isSafeInteger(welcome[key])&&welcome[key]>=0,
  'public welcome response must contain only aggregate counts and values');
assert.equal(sql("SELECT has_function_privilege('anon',"+
 "'public.claim_welcome_bonus_v1_815()','EXECUTE')"),'f',
 'anon may read campaign status but never claim a bonus');
// Appointment discovery allows only non-identifying, published business data.
assert.equal(sql("SELECT has_table_privilege('anon','public.agenda_appointments','SELECT')"),'f');
assert.equal(sql("SELECT has_table_privilege('anon','public.agenda_pages','SELECT')"),'f');
assert.equal(sql("SELECT public.agenda_public_page('no-such-professional') IS NULL"),'t');
console.log('PASS: public definer inventory reviewed, published-page projections only, no private agenda table grants or anonymous claims.');
