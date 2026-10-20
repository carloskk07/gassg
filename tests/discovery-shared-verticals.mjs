import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('supabase/migrations/20261018131000_discovery_shared_verticals.sql');
const sql=source.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const tables=[
 'discovery_vertical_cities','discovery_listings','discovery_professional_details',
 'discovery_ride_details','discovery_stay_details','discovery_advertising_terms',
 'discovery_advertising_daily_ledger','discovery_moderation_log'
];
for(const table of tables){
 assert.match(sql,new RegExp('create table public\\.'+table+'\\b'),table+' missing');
 assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security'),
   table+' must have RLS enabled');
 assert.match(sql,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated'),
   table+' must start closed to browser');
}
assert.match(sql,/vertical in \('professionals','rides','stays'\)/,
  'three verticals must share one canonical catalog');
assert.match(sql,/primary key \(vertical,state_code,city_key\)/,
  'city enablement must be independent per vertical');
assert.match(sql,/enabled boolean not null default false/,
  'no city or advertising should be opened by schema installation');
assert.match(sql,/owner_id uuid not null default auth\.uid\(\)/,
  'publisher must be bound to authenticated user');
assert.match(sql,/not u\.is_anonymous/,
  'anonymous accounts must never publish');
assert.match(sql,/u\.email_confirmed_at is not null or u\.phone_confirmed_at is not null/,
  'verified permanent identity required');
assert.match(sql,/create policy discovery_owner_draft_insert[\s\S]*status='draft'/,
  'users may only insert drafts');
assert.match(sql,/grant update \(title,description,state_code,city_key,city_name,/,
  'published and administrative fields must not be directly writable');
assert.doesNotMatch(sql,/grant update \([^)]*status[^)]*\) on public\.discovery_listings/i,
  'no direct self-promotion of publication status');
assert.match(sql,/where a\.user_id=v_actor and a\.active and a\.admin_role='superadmin'/,
  'only the existing owner authority may activate verticals');
assert.match(sql,/city_vertical_disabled/,
  'publishing must check separately enabled cities');
assert.match(sql,/discovery_verified_photo_paths/,
  'owner-provided photos require real storage metadata');
assert.match(sql,/o\.owner_id=l\.owner_id::text/,
  'another user cannot reuse media');
assert.match(sql,/file_size_limit,allowed_mime_types/,
  'bucket limits mime and size');
assert.match(sql,/real_photo_required/,
  'review and publication require a verified photo');
assert.match(sql,/expired_or_full_ride/,
  'a past or full ride cannot reappear as available');
assert.match(sql,/if p_next_status=v_listing\.status then return/,
  'duplicate review transition must be idempotent');
assert.match(sql,/primary key \(listing_id,billable_day\)/,
  'duplicate advertisement day charges must be structurally impossible');
assert.doesNotMatch(sql,/insert into public\.discovery_advertising_daily_ledger/i,
  'schema must never generate real charges automatically');
assert.doesNotMatch(sql,/update public\.platform_launch_control|update public\.market_cities/i,
  'discovery must never open current product marketplace');
assert.doesNotMatch(sql,/sb_secret_|service_role\s*=|\bsecret\b\s*=/i,
  'no secret is allowed in versioned schema');
assert.match(sql,/create function public\.discovery_public_search\(/,
  'public vertical search must have one canonical implementation');
assert.match(sql,/language sql stable security invoker/,
  'public search must respect RLS of the caller');
assert.match(sql,/where l\.status='published'/,
  'public search must not expose draft or unapproved listings');
assert.match(sql,/c\.city_key=l\.city_key and c\.enabled/,
  'public search must respect vertical/city activation');
assert.match(sql,/r\.departure_at>statement_timestamp\(\) and r\.seats_available>0/,
  'rides past departure or with no seats must stay out of results');
assert.doesNotMatch(sql,/grant select \(owner_id\) on public\.discovery_listings/,
  'browser must not expose publisher UUID');
// New browse capabilities remain SQL-bound and strictly tied to moderated rows.
for(const contract of [
 "p_occupation_query text default null",
 "p_min_seats integer default null",
 "p_property_type text default null",
 "p_max_price_cents integer default null",
 "p_listing_id uuid default null",
 "l.id=p_listing_id",
 "r.seats_available>=p_min_seats",
 "st.property_type=p_property_type",
 "st.price_from_brl_cents<=p_max_price_cents",
 "pro.service_area,pro.years_experience,r.proposed_cost_share_cents,st.amenities"
])assert.ok(sql.includes(contract),'missing secure public discovery contract: '+contract);
assert.match(sql,/position\\(lower\\(btrim\\(p_occupation_query\\)\\) in lower\\(pro\\.occupation\\)\\)>0/,
 'occupation search must compare fixed substrings, not interpolate wildcards');
assert.match(sql,/grant execute on function public\\.discovery_public_search\\([\\s\\S]*?to anon,authenticated/,
 'only callable public RPC, no owner bypass');
assert.match(sql,/create function public\.discovery_owner_can_edit_details\(/,
  'detail editing authorization must verify ownership server-side');
for(const vertical of ['professionals','rides','stays']){
 assert.ok(sql.includes("discovery_owner_can_edit_details(listing_id,'"+vertical+"')"),
   vertical+' must enforce data ownership in its own details table');
}
console.log('Discovery schema: RLS, city isolation, owner controls, no autopublishing and no autocharges — PASS');
