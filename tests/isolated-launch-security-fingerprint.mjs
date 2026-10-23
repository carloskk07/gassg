import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

// Full migrated Supabase on disposable localhost only. This suite must never
// use production project credentials or activate the commercial marketplace.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=q=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+q
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:60000,
 stdio:['ignore','pipe','pipe']}).trim();
const read=()=>JSON.parse(sql("SELECT public.tamao_launch_acl_posture_v1()"));
// Diagnose migration/catalog divergence BEFORE the first assertion. No secrets.
console.log('LOCAL_MIGRATION_VERSION',
 sql("SELECT coalesce(string_agg(version,','),'NONE') FROM supabase_migrations.schema_migrations WHERE version='20261023154000'"));
console.log('LOCAL_ACL_FUNCTIONS',
 sql("SELECT coalesce(string_agg(proname,','),'NONE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('tamao_launch_acl_posture_v1','platform_launch_readiness')"));
console.log('LOCAL_ACL_DETAILS',
 sql("SELECT current_user||' db='||current_database()||' path='||current_setting('search_path')"));
console.log('LOCAL_ACL_REGPROCEDURE',
 sql("SELECT coalesce(to_regprocedure('public.tamao_launch_acl_posture_v1()')::text,'NULL')"));
console.log('LOCAL_ACL_CATALOG_DETAILS',
 sql("SELECT coalesce(string_agg(p.oid::regprocedure::text||':args='||p.pronargs||':kind='||p.prokind::text||':exec='||has_function_privilege(current_user,p.oid,'EXECUTE'),'|'),'NONE') FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='tamao_launch_acl_posture_v1'"));
const baseline=read();
console.log('ACTUAL_ACL_SCANNER_PARTS',JSON.stringify(baseline));
// Compare canonical catalog objects by table when local/hosted fingerprints
// differ. These hashes contain no customer data and do not modify any table.
const migration=fs.readFileSync(new URL('../supabase/migrations/20261023154000_launch_acl_exact_fingerprint.sql',import.meta.url),'utf8');
const scan=migration.match(/AS \$scan\$\n([\s\S]*?)\n\$scan\$/)?.[1];
assert.ok(scan,'reviewed migration scanner must be present');
const prefix=scan.slice(0,scan.indexOf('\nSELECT jsonb_build_object('));
assert.ok(prefix.startsWith('WITH t AS ('),'catalog statement must be well formed');
const tableRows=JSON.parse(sql("SET search_path TO pg_catalog,public; "+prefix+
 " SELECT coalesce(jsonb_agg(jsonb_build_object('name',relname,"+
 "'hash',md5(jsonb_build_object('name',relname,'rls',relrowsecurity,'table',tbl,'columns',col,'policies',policies)::text),"+
 "'policyHashes',policies) ORDER BY relname),'[]'::jsonb) "+
 "FROM t WHERE tbl<>'[]'::jsonb OR col<>'[]'::jsonb;"));
console.log('LOCAL_REVIEWED_TABLE_HASHES',JSON.stringify(tableRows));
assert.deepEqual(baseline,{
 tableDigest:'67838fe06fa43d7692e12d8e11a3de91',
 rpcDigest:'d795df150e91d9d758b6ccb4fd0386cd',
 tableCount:7,rpcCount:28
},'Local canonical migrated schema must match the reviewed hosted baseline');
const ready=()=>JSON.parse(sql("SELECT public.platform_launch_readiness()"));
const launch=ready();
assert.equal(launch.operationMode,'PRELAUNCH');
assert.equal(launch.commerceEnabled,false);
assert.equal(launch.canActivateOperation,false);
assert.equal(launch.offerReadyMerchantCount,0);
assert.ok(!launch.securityBlockers.includes('browser_sensitive_table_acl'));
assert.ok(!launch.securityBlockers.includes('admin_rpc_browser_exposure'));
const blocked=(query,code)=>{
 // Each probe opens and rolls back a transaction in this LOCAL Postgres.
 const output=sql('BEGIN; '+query+
  " SELECT (public.platform_launch_readiness()->'securityBlockers') ? '"+
  code+"'; ROLLBACK;");
 assert.equal(output.split(/\s+/).find(x=>x==='t'||x==='f'),'t',
  'A new grant, weakened policy or function MUST restore the launch block '+code);
 assert.deepEqual(read(),baseline,'transaction rollback must restore exact ACL');
};
blocked('GRANT SELECT ON public.merchants TO authenticated;',
 'browser_sensitive_table_acl');
blocked('GRANT SELECT(cnpj) ON public.merchants TO authenticated;',
 'browser_sensitive_table_acl');
blocked("ALTER POLICY discovery_public_or_owned ON public.discovery_listings USING (true);",
 'browser_sensitive_table_acl');
blocked("CREATE FUNCTION public.ci_unreviewed_launch() RETURNS integer LANGUAGE sql "+
 "SECURITY DEFINER SET search_path='pg_catalog' AS 'SELECT 1'; "+
 "REVOKE ALL ON FUNCTION public.ci_unreviewed_launch() FROM PUBLIC,anon,authenticated; "+
 "GRANT EXECUTE ON FUNCTION public.ci_unreviewed_launch() TO authenticated;",
 'admin_rpc_browser_exposure');
blocked('ALTER TABLE public.discovery_documents DISABLE ROW LEVEL SECURITY;',
 'sensitive_table_rls_disabled');
assert.equal(sql("SELECT operation_mode FROM public.platform_launch_control WHERE singleton"),'PRELAUNCH');
assert.equal(sql("SELECT commerce_enabled FROM public.platform_launch_control WHERE singleton"),'f');
console.log('PASS: current reviewed browser ACL and privileged RPC fingerprints no longer give false security blocks; 5 dangerous changes still fail closed; business launch stays PRELAUNCH.');
