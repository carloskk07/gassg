import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261021030000_mobility_live_tracking.sql',import.meta.url),'utf8');
for(const fn of ['mobility_create_request','mobility_transition','mobility_publish_position',
'mobility_start_position','mobility_stop_position','mobility_snapshot','mobility_my_requests']){
 assert.ok(sql.includes('create function public.'+fn+'('));
 assert.ok(sql.includes('revoke all on function public.'+fn+'('));
}
assert.equal((sql.match(/enable row level security/g)||[]).length,2);
assert.ok(sql.includes('to authenticated using ((select auth.uid())=rider_id'));
assert.ok(sql.includes("r.status='en_route' and r.tracking_enabled"));
assert.ok(sql.includes("interval '45 seconds'"));
assert.ok(sql.includes("not r.tracking_enabled or r.expires_at"));
assert.ok(sql.includes("create function public.mobility_start_position"));
assert.ok(sql.includes('set search_path=pg_catalog as $mobility_start

assert.ok(sql.includes("update public.mobility_requests set tracking_enabled=true,updated_at=statement_timestamp()"));
assert.ok(sql.includes("interval '3 minutes'"));
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
assert.ok(sql.includes("perform 1 from auth.users where id=v_user for update"));
assert.doesNotMatch(sql,/alter publication|create policy .+ to anon/);
console.log('PASS — GPS participant privacy, driver-only update, throttling and no public positions');));
assert.ok(sql.includes('end $mobility_start$;'));


assert.ok(sql.includes("update public.mobility_requests set tracking_enabled=true,updated_at=statement_timestamp()"));
assert.ok(sql.includes("interval '3 minutes'"));
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
assert.ok(sql.includes("perform 1 from auth.users where id=v_user for update"));
assert.doesNotMatch(sql,/alter publication|create policy .+ to anon/);
console.log('PASS — GPS participant privacy, driver-only update, throttling and no public positions');