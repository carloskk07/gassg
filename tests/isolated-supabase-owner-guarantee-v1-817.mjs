import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
const env={...process.env,PGPASSWORD:'postgres'};
const sql=query=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+query
],{encoding:'utf8',env,timeout:60000}).trim();
const row=sql("SELECT funding_verified::text||':'||legal_terms_verified::text||':'||"+
 "redeem_settlement_verified::text||':'||sale_enabled::text "+
 "FROM public.clube_coupon_paid_packages WHERE package_key='all_products_3x5_sponsor'");
assert.equal(row,'true:false:false:false','owner guarantee may be verified while commercial approval stays closed');
assert.equal(sql("SELECT owner_guaranteed_cents||':'||reconciled_cents||':'||encumbered_cents "+
 "FROM public.platform_clube_sponsor_pool_v1_807 WHERE benefit_key='clube_coupons'"),'10000:0:0');
console.log('V1.817 PostgreSQL PASS — founder funding evidence true but cash deposit and sales false.');
