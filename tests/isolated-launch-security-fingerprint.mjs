import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

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
const read=()=>JSON.parse(sql("SELECT public.platform_launch_acl_posture_v1()"));
const baseline=read();
assert.deepEqual(baseline,{
 tableDigest:'8d1723a59095686eb8b0d4a7a667f3d1',
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
