import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20261021030000_mobility_live_tracking.sql',import.meta.url),'utf8');
const category=fs.readFileSync(new URL(
 '../supabase/migrations/20261101213000_mobility_service_category_integrity_v1_493.sql',
 import.meta.url),'utf8');
assert.match(category,/create trigger mobility_enforce_service_category[\s\S]*?before insert or update of service,listing_id,driver_id/);
assert.match(category,/when d\.occupation ~\* '[^']*motot[^']*' then 'moto'/);
assert.match(category,/when d\.occupation ~\* '[^']*(motorista|taxista)[^']*' then 'carro'/);
assert.match(category,/v_category is distinct from new\.service/);
assert.match(category,/l\.owner_id=new\.driver_id/);
assert.match(category,/l\.status='published'/);
assert.match(category,/revoke all on function public\.mobility_service_category_guard\(\)/);
assert.doesNotMatch(category,/grant execute on function public\.mobility_service_category_guard/);

for(const fn of [
 'mobility_create_request','mobility_transition','mobility_start_position',
 'mobility_publish_position','mobility_stop_position','mobility_snapshot',
 'mobility_my_requests'
]){
 assert.ok(sql.includes('create function public.'+fn+'('),'missing '+fn);
 assert.ok(sql.includes('revoke all on function public.'+fn+'('),'missing revoke '+fn);
}
assert.equal((sql.match(/enable row level security/g)||[]).length,2);
assert.ok(sql.includes('to authenticated using ((select auth.uid())=rider_id'));
assert.ok(sql.includes("r.status='en_route' and r.tracking_enabled"));
assert.ok(sql.includes('grant select on public.mobility_requests to authenticated'));
assert.ok(!sql.includes('grant select on public.mobility_live_positions to authenticated'));
assert.ok(!sql.includes('create policy mobility_position_live_participants'));
assert.ok(sql.includes('alter table public.mobility_live_positions enable row level security'));
assert.ok(sql.includes("interval '45 seconds'"));
assert.ok(sql.includes("interval '3 minutes'"));
assert.ok(sql.includes("create function public.mobility_start_position"));
assert.ok(sql.includes('set search_path=pg_catalog as $mobility_start$'));
assert.ok(sql.includes('end $mobility_start$;'));
assert.ok(sql.includes('not r.tracking_enabled or r.expires_at'));
assert.equal((sql.match(/update public.mobility_requests set tracking_enabled=true/g)||[]).length,1,
 'only explicit driver opt-in may enable GPS');
assert.ok(sql.includes("cron.schedule('tamao-mobility-gps-cleanup'"));
assert.ok(sql.includes("revoke all on function public.mobility_cleanup_expired()"));
assert.ok(sql.includes("delete from public.mobility_live_positions where request_id=r.id"));
assert.ok(sql.includes("delete from public.mobility_live_positions where request_id=p_request_id"));
assert.ok(!sql.includes('grant select on public.mobility_live_positions to anon'));
assert.ok(!sql.includes('grant insert on public.mobility_requests to authenticated'));
assert.ok(!sql.includes('grant update on public.mobility_requests to authenticated'));
assert.ok(sql.includes("l.status='published'"));
assert.ok(sql.includes('and c.city_key=l.city_key and c.enabled'));
assert.ok(sql.includes("p_service='moto'")&&sql.includes("p_service='carro'"));
assert.ok(sql.includes("not public.discovery_verified_account()"));
assert.equal((sql.match(/not public.discovery_verified_account\(\)/g)||[]).length,4,
 'Account verification must protect request, transitions, GPS start and each publish');
assert.equal((sql.match(/l.status='published'/g)||[]).length>=3,true,
 'GPS may only start/publish for still-published provider listings');
assert.ok(sql.includes("not exists(select 1 from public.discovery_listings l"),
 'Queued requests cannot be accepted after the provider listing is removed');
assert.match(sql,/create function public\.mobility_start_position[\s\S]*?or not exists\(select 1 from public\.discovery_listings l[\s\S]*?c\.enabled/,
 'Driver starting GPS must verify listing publication and city authorization');
assert.match(sql,/create function public\.mobility_publish_position[\s\S]*?or not exists\(select 1 from public\.discovery_listings l[\s\S]*?c\.enabled/,
 'Every GPS packet must revalidate provider listing and city');
assert.ok(sql.includes('left join public.mobility_live_positions p on p.request_id=r.id'),
 'Only the participant-bound snapshot can read precise coordinates');
assert.match(sql,/create function public\.mobility_snapshot[\s\S]*?l\.status='published' and exists\([\s\S]*?c\.city_key=l\.city_key and c\.enabled[\s\S]*?r\.expires_at>statement_timestamp\(\)/,
 'Participant-only snapshot must hide GPS if listing or city is withdrawn');
assert.ok(sql.includes("perform 1 from auth.users where id=v_user for update"));
assert.doesNotMatch(sql,/alter publication|create policy .+ to anon/);
console.log('PASS: private GPS scoped to an active ride, explicit start, revocation and TTL');

// The rider must lose GPS access when Admin disables the city.
assert.match(sql,/create function public\.mobility_snapshot[\s\S]*?c\.city_key=l\.city_key and c\.enabled/);
assert.match(sql,/create function public\.mobility_start_position[\s\S]*?join public\.discovery_vertical_cities c[\s\S]*?c\.enabled/);
