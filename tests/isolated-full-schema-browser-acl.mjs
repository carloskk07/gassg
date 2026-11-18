import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Real canonical migrations, disposable localhost Postgres only. Match
// EFFECTIVE browser privileges, including grants inherited from PUBLIC.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=query=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+query
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
assert.equal(sql('SELECT current_database()'),'postgres');
const qTables=`
SELECT coalesce(jsonb_agg(z.item ORDER BY z.item->>'table'),'[]'::jsonb)
FROM (
 SELECT jsonb_build_object(
  'table',c.relname,'rls',c.relrowsecurity,
  'anon',(SELECT coalesce(jsonb_agg(priv ORDER BY priv),'[]'::jsonb)
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv
    WHERE has_table_privilege('anon',c.oid,priv)),
  'auth',(SELECT coalesce(jsonb_agg(priv ORDER BY priv),'[]'::jsonb)
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv
    WHERE has_table_privilege('authenticated',c.oid,priv)),
  'policies',(SELECT coalesce(jsonb_agg(pol.polname ORDER BY pol.polname),'[]'::jsonb)
    FROM pg_policy pol WHERE pol.polrelid=c.oid)
 ) AS item
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','p') AND
 (has_table_privilege('anon',c.oid,'SELECT')
 OR has_table_privilege('anon',c.oid,'INSERT')
 OR has_table_privilege('anon',c.oid,'UPDATE')
 OR has_table_privilege('anon',c.oid,'DELETE')
 OR has_table_privilege('authenticated',c.oid,'SELECT')
 OR has_table_privilege('authenticated',c.oid,'INSERT')
 OR has_table_privilege('authenticated',c.oid,'UPDATE')
 OR has_table_privilege('authenticated',c.oid,'DELETE'))
) z`;
const allowedTables={
 agenda_service_deposit_settings:{anon:[],auth:['SELECT'],policies:['agenda_deposit_settings_owner_read']},
 agenda_staff_blocks:{anon:[],auth:['SELECT'],policies:['agenda_staff_blocks_owner_read']},
 agenda_waitlist:{anon:[],auth:['SELECT'],policies:['agenda_waitlist_participants_read']},
 agenda_staff:{anon:[],auth:['SELECT'],policies:['agenda_staff_owner_select','agenda_staff_owner_insert','agenda_staff_owner_update']},
 agenda_closed_days:{anon:[],auth:['SELECT'],policies:['agenda_closed_days_owner_select']},
 agenda_pages:{anon:[],auth:['SELECT'],policies:['agenda_page_owner_select','agenda_page_owner_insert','agenda_page_owner_update']},
 agenda_services:{anon:[],auth:['SELECT'],policies:['agenda_services_owner_select','agenda_services_owner_insert','agenda_services_owner_update']},
 agenda_hours:{anon:[],auth:['DELETE','SELECT'],policies:['agenda_hours_owner_select','agenda_hours_owner_insert','agenda_hours_owner_update','agenda_hours_owner_delete']},
 agenda_appointments:{anon:[],auth:['SELECT'],policies:['agenda_appointments_participants_read']},
 discovery_documents:{anon:[],auth:['DELETE','SELECT'],policies:['discovery_document_owner_or_admin_read','discovery_document_owner_delete']},
 discovery_professional_details:{anon:['SELECT'],auth:['INSERT','SELECT','UPDATE'],policies:['discovery_professional_visible','discovery_professional_draft_insert','discovery_professional_draft_update']},
 discovery_ride_details:{anon:['SELECT'],auth:['INSERT','SELECT','UPDATE'],policies:['discovery_ride_visible','discovery_ride_draft_insert','discovery_ride_draft_update']},
 discovery_stay_details:{anon:['SELECT'],auth:['INSERT','SELECT','UPDATE'],policies:['discovery_stay_visible','discovery_stay_draft_insert','discovery_stay_draft_update']},
 mobility_requests:{anon:[],auth:['SELECT'],policies:['mobility_request_participants']}
};
const rows=JSON.parse(sql(qTables));
assert.deepEqual(rows.map(x=>x.table).sort(),Object.keys(allowedTables).sort(),
 'Unreviewed direct table access by browser roles');
for(const row of rows){
 const e=allowedTables[row.table];
 assert.equal(row.rls,true,row.table+' lost RLS');
 assert.deepEqual(row.anon,e.anon,row.table+' anon grant drift');
 assert.deepEqual(row.auth,e.auth,row.table+' auth grant drift');
 for(const policy of e.policies)
   assert.ok(row.policies.includes(policy),row.table+' lost '+policy);
}
// Column-level GRANTs are NOT reported by has_table_privilege(). These
// narrow SELECT/INSERT/UPDATE grants are deliberate, but a newly exposed
// column is a data leak risk even when the table-level inventory is unchanged.
const columns=JSON.parse(sql(`
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'table',tab,'rls',rls,'grants',grants) ORDER BY tab),'[]'::jsonb)
FROM (
 SELECT c.relname AS tab,c.relrowsecurity AS rls,
 jsonb_agg(role.r||':'||perm.p||':'||a.attname
   ORDER BY role.r,perm.p,a.attname) AS grants
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 CROSS JOIN (VALUES ('anon'),('authenticated')) role(r)
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) perm(p)
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 AND has_column_privilege(role.r,c.oid,a.attnum,perm.p)
 AND NOT has_table_privilege(role.r,c.oid,perm.p)
 GROUP BY c.relname,c.relrowsecurity
) t`));
const publishedColumns=[
 'city_key','city_name','created_at','description','id','photo_urls',
 'public_area','published_at','state_code','status','title','updated_at',
 'vertical','whatsapp_e164'
];
const listingInsert=[
 'city_key','city_name','description','photo_urls','public_area',
 'state_code','title','vertical','whatsapp_e164'
];
const listingUpdate=[
 'city_key','city_name','description','photo_urls','public_area',
 'state_code','title','updated_at','whatsapp_e164'
];
const expectedColumns={
 agenda_staff:[
   ...['page_id','name','active'].map(c=>'authenticated:INSERT:'+c),
   ...['name','active'].map(c=>'authenticated:UPDATE:'+c)
 ],
 agenda_pages:[
   ...['slug','title','about','city','public_area','whatsapp_e164','photo_paths','published']
     .flatMap(c=>['authenticated:INSERT:'+c,'authenticated:UPDATE:'+c])
 ],
 agenda_services:[
   ...['page_id','title','duration_min','price_cents','active'].map(c=>'authenticated:INSERT:'+c),
   ...['title','duration_min','price_cents','active'].map(c=>'authenticated:UPDATE:'+c)
 ],
 agenda_hours:[
   ...['page_id','weekday','opens_min','closes_min'].map(c=>'authenticated:INSERT:'+c),
   ...['opens_min','closes_min'].map(c=>'authenticated:UPDATE:'+c)
 ],
 discovery_documents:['kind','listing_id','object_path']
  .map(col=>'authenticated:INSERT:'+col),
 discovery_listings:[
  ...publishedColumns.flatMap(col=>['anon:SELECT:'+col,'authenticated:SELECT:'+col]),
  ...listingInsert.map(col=>'authenticated:INSERT:'+col),
  ...listingUpdate.map(col=>'authenticated:UPDATE:'+col)
 ],
 discovery_vertical_cities:
  ['city_key','city_name','enabled','state_code','vertical']
  .flatMap(col=>['anon:SELECT:'+col,'authenticated:SELECT:'+col])
};
assert.deepEqual(columns.map(x=>x.table).sort(),Object.keys(expectedColumns).sort(),
 'Unreviewed column-level browser privilege on a public table');
for(const row of columns){
 assert.equal(row.rls,true,row.table+' column grants without RLS');
 assert.deepEqual(row.grants,expectedColumns[row.table].sort(),
  row.table+' unexpectedly grants a column or removes a scoped grant');
}
const expectedFunctions=[
 'agenda_deposit_quote(p_service_id uuid)',
 'agenda_set_deposit_policy(p_service_id uuid, p_percent smallint, p_policy_text text)',
 'agenda_add_staff_block(p_staff_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)',
 'agenda_close_waitlist(p_wait_id uuid, p_contacted boolean)',
 'agenda_join_waitlist(p_service_id uuid, p_staff_id uuid, p_day date, p_name text, p_phone text, p_consent boolean)',
 'agenda_mark_attendance(p_appointment_id uuid, p_result text)',
 'agenda_remove_staff_block(p_id uuid)',
 'agenda_available_slots(p_service_id uuid, p_day date)',
 'agenda_available_staff_slots(p_service_id uuid, p_day date, p_staff_id uuid)',
 'agenda_book_slot(p_service_id uuid, p_starts_at timestamp with time zone, p_name text, p_phone text, p_request_id uuid)',
 'agenda_book_staff_slot(p_service_id uuid, p_starts_at timestamp with time zone, p_name text, p_phone text, p_request_id uuid, p_staff_id uuid)',
 'agenda_cancel_booking(p_appointment_id uuid)',
 'agenda_day_is_closed(p_service_id uuid, p_day date)',
 'agenda_my_bookings()',
 'agenda_set_closed_day(p_day date, p_closed boolean)',
 'agenda_public_directory()',
 'agenda_search_directory(p_query text, p_limit integer, p_offset integer)',
 'agenda_public_page(p_slug text)',
 'agenda_replace_hours(p_page_id uuid, p_hours jsonb)',
 'agenda_reschedule_booking(p_appointment_id uuid, p_expected_starts_at timestamp with time zone, p_new_starts_at timestamp with time zone)',
 'claim_my_pilot_partner_invite(p_application_id uuid, p_token text)',
 'discovery_admin_city_matrix(p_limit integer)',
 'discovery_admin_listing_overview(p_limit integer)',
 'discovery_admin_readiness()',
 'discovery_admin_report_queue(p_limit integer)',
 'discovery_admin_review_queue(p_limit integer)',
 'discovery_document_editable(p_listing text)',
 'discovery_document_owned(p_listing text)',
 'discovery_document_registered(p_path text)',
 'discovery_is_superadmin()',
 'discovery_my_listings()',
 'discovery_owner_can_edit_details(p_listing_id uuid, p_vertical text)',
 'discovery_photo_unreferenced(p_path text)',
 'discovery_review_report(p_report_id bigint, p_status text, p_note text)',
 'discovery_set_vertical_city(p_vertical text, p_state text, p_city_key text, p_city_name text, p_enabled boolean, p_reason text)',
 'discovery_storage_quota_ok(p_bucket text)',
 'discovery_submit_report(p_listing_id uuid, p_reason text, p_details text)',
 'discovery_transition_listing(p_listing_id uuid, p_next_status text, p_reason text)',
 'discovery_unlink_listing_photo(p_listing_id uuid, p_photo_path text)',
 'discovery_update_ride_seats(p_listing_id uuid, p_seats_available integer)',
 'discovery_verified_account()',
 'mobility_benefits_participate_v1_826(p_opt_in boolean, p_terms_version integer)',
 'mobility_billing_catalog_v1_826()',
 'mobility_fare_accept_v1_826(p_request_id uuid, p_version integer)',
 'mobility_fare_propose_v1_826(p_request_id uuid, p_fare_cents integer)',
 'mobility_create_request(p_listing_id uuid, p_service text, p_origin_area text, p_destination_area text)',
 'mobility_my_requests()',
 'mobility_publish_position(p_request_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision)',
 'mobility_snapshot(p_request_id uuid)',
 'mobility_start_position(p_request_id uuid)',
 'mobility_stop_position(p_request_id uuid)',
 'mobility_transition(p_request_id uuid, p_action text)',
 'public_city_price_board_v1_341(p_city text, p_state text)',
 'claim_welcome_bonus_v1_815()',
 'welcome_bonus_status_v1_815()',
 'clube_coupon_home_prices_v1_820()'
].sort();
const qFunctions=`
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'signature',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
 'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'safeSearchPath','search_path=pg_catalog'=ANY(p.proconfig)
) ORDER BY p.proname),'[]'::jsonb)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
AND (has_function_privilege('anon',p.oid,'EXECUTE')
 OR has_function_privilege('authenticated',p.oid,'EXECUTE'))`;
const fns=JSON.parse(sql(qFunctions));
assert.deepEqual(fns.map(x=>x.signature).sort(),expectedFunctions,
 'An unknown SECURITY DEFINER or overload was granted to the browser');
for(const fn of fns){
 assert.equal(fn.anon,['welcome_bonus_status_v1_815()','clube_coupon_home_prices_v1_820()',
  'agenda_deposit_quote(p_service_id uuid)',
  'agenda_available_slots(p_service_id uuid, p_day date)','agenda_public_directory()',
  'agenda_search_directory(p_query text, p_limit integer, p_offset integer)',
  'agenda_public_page(p_slug text)',
  'agenda_day_is_closed(p_service_id uuid, p_day date)',
  'agenda_available_staff_slots(p_service_id uuid, p_day date, p_staff_id uuid)'].includes(fn.signature),
  fn.signature+' unexpected public EXECUTE privilege');
 assert.equal(fn.auth,true,fn.signature+' lacks intended authenticated access');
 assert.equal(fn.safeSearchPath,true,fn.signature+' has an unsafe search_path');
}
// Negative mutation probes are rolled back, and only target this localhost DB.
// Their purpose is to prove the inspector would REJECT a novel dangerous grant.
const newTable=sql(`BEGIN;
CREATE TABLE public.ci_browser_acl_probe(id integer);
REVOKE ALL ON public.ci_browser_acl_probe FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ci_browser_acl_probe TO authenticated;
SELECT count(*) FROM pg_class c WHERE c.relname='ci_browser_acl_probe'
 AND c.relnamespace='public'::regnamespace
 AND has_table_privilege('authenticated',c.oid,'SELECT');
ROLLBACK;`);
assert.ok(newTable.split(/\s+/).includes('1'),'new browser table grant must be detectable');
const newColumn=sql(`BEGIN;
CREATE TABLE public.ci_column_probe(id integer, private_note text);
REVOKE ALL ON public.ci_column_probe FROM PUBLIC,anon,authenticated;
GRANT SELECT(private_note) ON public.ci_column_probe TO authenticated;
SELECT count(*) FROM pg_attribute a
 WHERE a.attrelid='public.ci_column_probe'::regclass
 AND a.attname='private_note'
 AND has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT')
 AND NOT has_table_privilege('authenticated',a.attrelid,'SELECT');
ROLLBACK;`);
assert.ok(newColumn.split(/\s+/).includes('1'),
 'column-only browser grant must be detected even if table ACL reports none');
const newDefiner=sql(`BEGIN;
CREATE FUNCTION public.ci_unreviewed_definer() RETURNS integer LANGUAGE sql
 SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1';
REVOKE ALL ON FUNCTION public.ci_unreviewed_definer() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ci_unreviewed_definer() TO authenticated;
SELECT count(*) FROM pg_proc p WHERE p.oid='public.ci_unreviewed_definer()'::regprocedure
 AND p.prosecdef AND has_function_privilege('authenticated',p.oid,'EXECUTE');
ROLLBACK;`);
assert.ok(newDefiner.split(/\s+/).includes('1'),'new privileged RPC grant must be detectable');
assert.equal(sql("SELECT count(*) FROM public.orders"),'0');
console.log('PASS: complete migrations ACL inventory and RLS policies; exact privileged RPC signatures; dangerous new-grant probes detected; no production or commercial data.');
