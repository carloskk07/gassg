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
assert.match(sql,/real_photo_required/,
  'published items must have a real photo URL to review');
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
for(const vertical of ['professionals','rides','stays']){
 assert.match(sql,new RegExp("l\\.vertical='"+vertical+"'"),
   vertical+' must enforce data ownership in its own details table');
}
console.log('Discovery schema: RLS, city isolation, owner controls, no autopublishing and no autocharges — PASS');
