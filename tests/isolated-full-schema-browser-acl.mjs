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
const expectedFunctions=[
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
 'discovery_verified_account()',
 'mobility_create_request(p_listing_id uuid, p_service text, p_origin_area text, p_destination_area text)',
 'mobility_my_requests()',
 'mobility_publish_position(p_request_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision)',
 'mobility_snapshot(p_request_id uuid)',
 'mobility_start_position(p_request_id uuid)',
 'mobility_stop_position(p_request_id uuid)',
 'mobility_transition(p_request_id uuid, p_action text)',
 'public_city_price_board_v1_341(p_city text, p_state text)'
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
 assert.equal(fn.anon,false,fn.signature+' must not be publicly executable');
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
assert.ok(newTable.split(/\\s+/).includes('1'),'new browser table grant must be detectable');
const newDefiner=sql(`BEGIN;
CREATE FUNCTION public.ci_unreviewed_definer() RETURNS integer LANGUAGE sql
 SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1';
REVOKE ALL ON FUNCTION public.ci_unreviewed_definer() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ci_unreviewed_definer() TO authenticated;
SELECT count(*) FROM pg_proc p WHERE p.oid='public.ci_unreviewed_definer()'::regprocedure
 AND p.prosecdef AND has_function_privilege('authenticated',p.oid,'EXECUTE');
ROLLBACK;`);
assert.ok(newDefiner.split(/\\s+/).includes('1'),'new privileged RPC grant must be detectable');
assert.equal(sql("SELECT count(*) FROM public.orders"),'0');
console.log('PASS: complete migrations ACL inventory and RLS policies; exact privileged RPC signatures; dangerous new-grant probes detected; no production or commercial data.');
