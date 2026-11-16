import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const get=p=>fs.readFileSync(p,'utf8');
const sql=get('supabase/migrations/20261116231500_network_member_benefit_statement_v1_1045.sql');
const edge=get('supabase/functions/customer-summary/index.ts');
const growth=get('js/growth.js');
const history=get('js/growth-benefits-statement.js');
const test=get('tests/sql/network-member-benefit-statement-v1-1045.sql');
new vm.Script(growth,{filename:'growth.js'});
new vm.Script(history,{filename:'growth-benefits-statement.js'});
assert.match(sql,/create function public\.network_member_benefit_statement_v1_1045/);
assert.match(sql,/stable security definer/);
assert.match(sql,/set search_path=pg_catalog/);
assert.match(sql,/where w\.user_id=p_user/);
assert.match(sql,/where a\.user_id=p_user/);
assert.match(sql,/where a\.inviter_user_id=p_user/);
assert.match(sql,/where v\.customer_user_id=p_user/);
assert.match(sql,/where p\.user_id=p_user/);
for(const source of ['public.wallet_entries','public.network_fee_package_awards_v1_1030',
 'public.network_module_ads_bonus_awards_v1_1041',
 'public.network_direct_module_awards_v1_1044',
 'public.clube_coupon_paid_issuances',
 'public.network_manual_payout_requests_v1_1034']){
 assert.ok(sql.includes(source),'Missing: '+source);
}
assert.match(sql,/a\.equal_microcents/);
assert.match(sql,/a\.inviter_microcents/);
assert.match(sql,/floor\(a\.equal_microcents::numeric\/1000000\)::bigint/);
assert.match(sql,/floor\(a\.inviter_microcents::numeric\/1000000\)::bigint/);
assert.match(sql,/money_type/);
assert.match(sql,/discount/);
assert.match(sql,/Movimentaç/);
assert.match(sql,/not in \('all','rede','cashback','clube'\)/);
assert.match(sql,/p_page>100/);
assert.match(sql,/p_limit>25/);
assert.match(sql,/revoke all on function public\.network_member_benefit_statement_v1_1045/);
assert.match(sql,/to service_role/);
assert.doesNotMatch(sql,/insert into|delete from|update public\.|grant execute.*authenticated/i);
assert.match(edge,/requestBody\?\.statementOnly===true/);
assert.match(edge,/network_member_benefit_statement_v1_1045/);
assert.match(edge,/p_user:user\.id,p_category:category,p_page:page,p_limit:12/);
assert.doesNotMatch(edge,/p_user:requestBody\.user/);
assert.ok(edge.indexOf('if(requestBody?.statementOnly===true)')<
 edge.indexOf('admin.rpc("customer_financial_summary"'),
 'Statement reads should not record a 24-hour visit or run the full financial overview.');
assert.match(growth,/growth-benefits-statement\.js/);
assert.match(growth,/globalThis\.tamaoBenefitsStatementPanel\?\.\(\)/);
assert.match(growth,/Meu extrato de vantagens/);
assert.match(history,/generation\+\+/);
assert.match(history,/tamaoBenefitsStatementStillCurrent/);
assert.match(history,/statementOnly:true/);
assert.match(history,/esc\(title\)/);
assert.match(history,/esc\(detail\)/);
assert.match(history,/hasMore/);
assert.match(history,/menos de R\$ 0,01/);
assert.match(history,/Cupons/);
assert.match(history,/não é um ganho novo/);
assert.match(test,/begin;[\s\S]*rollback;/);
assert.match(test,/STATEMENT_CROSS_ACCOUNT_LEAK/);
assert.match(test,/STATEMENT_SUBCENT_MUST_NOT_ROUND_TO_ONE_CENT/);
assert.match(test,/STATEMENT_PRIVILEGE_LEAK/);
assert.match(test,/STATEMENT_PAGINATION_LAST_FAILED/);
const audit=get('.github/workflows/audit.yml');
const integration=get('.github/workflows/isolated-supabase-integration.yml');
assert.ok(audit.includes('node tests/network-member-benefit-statement-v1-1045.mjs'));
assert.ok(integration.includes('tests/sql/network-member-benefit-statement-v1-1045.sql'));
console.log('V1.1045 PASS — private ledger, money separation, access controls, UI and CI');
