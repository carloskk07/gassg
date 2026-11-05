import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// PostgreSQL de teste descartável; nenhum dado ou token de produção é utilizado.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=query=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+query
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:60000}).trim();

const active=sql("select string_agg(plan_key||':'||platform_fee_bps||':'||coalesce(purchase_amount_cents::text,'flex')||':'||coalesce(credit_grant_cents::text,'flex'),',' order by sort_order) from public.merchant_billing_plans where active");
assert.equal(active,[
 'flex_daily:900:flex:flex','credit_01990:800:1990:1990',
 'credit_04990:750:4990:4990','credit_09990:700:9990:9990',
 'credit_19990:650:19990:19990'].join(','));

assert.equal(sql("select count(*) from public.merchant_billing_plans where plan_key in ('credit_300','credit_1000','credit_3000')"),'3','Fks e historico de planos antigos preservados');
assert.equal(sql("select count(*) from public.merchant_billing_plans where plan_key in ('credit_300','credit_1000','credit_3000') and active"),'0','Nenhum plano antigo deve ser vendido');
assert.equal(sql("select count(*) from public.merchant_billing_accounts where credit_balance_cents<>0 or credit_reserved_cents<>0"),'0','Migracao nao pode fabricar saldo');
assert.equal(sql("select count(*) from public.merchant_fee_credit_ledger"),'0','Migracao nao cria lançamentos de crédito');
assert.equal(sql("select coalesce(min(platform_fee_bps),0) >= (select variable_cost_bps + cashback_bps + direct_referral_bps + minimum_contribution_bps from public.reward_policy where policy_key='default') from public.merchant_billing_plans where active"),'t','taxa nao pode ficar abaixo do piso economico de revendas');

const negative="begin; set local role anon; select count(*) from public.merchant_billing_plans; rollback;";
let denied=false;
try{sql(negative)}catch(e){denied=/permission denied/i.test(String(e.stderr||e.message||''));}
assert.ok(denied,'catalogo financeiro nao exposto diretamente ao anon');
console.log('TAMÃO #824: catálogo de revendas e ACL comprovados em PostgreSQL real isolado.');
