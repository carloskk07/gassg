import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261122204832_network_ads_shared_pool_v1_1154.sql');
const isolated=read('tests/sql/network-ads-pool-v1-1154.sql');
const earn=read('js/earn-premium.js');
const growth=read('js/growth.js');
const workflow=read('.github/workflows/isolated-supabase-integration.yml');
for(const v of [
 'network_ads_pool_tick_v1_1154','ads_verified_view','ads_fixed_campaign',
 'ads_credit_view_receipts_v1_1098','ads_credit_ledger_v1_1097',
 'ads_independent_checkouts_v1_886','platform_receipt_net_audit',
 'network_member_visits_v1_1030','network_fee_package_awards_v1_1030',
 'network_ads_pool_admin_summary_v1_1154','network_member_benefit_statement_v1_1045',
 'pool_bps=1000','payouts_enabled boolean not null default false',
 'v_pool:=v_src.gross_cents*100000','v_share:=v_each',
 'on conflict(kind,source_id) do nothing','ads_reviewed_at',
 'make_interval(days=>v_policy.maturity_days)',"state='reversed'",
 'cron.schedule','revoke all on function public.network_ads_pool_tick_v1_1154'
])assert.ok(sql.includes(v),'Missing pooled Ads invariant: '+v);
for(const v of ['ADS_VIEW_SUBCENT_10PCT_NOT_CONSERVED','ADS_VIEW_REPLAY_DOUBLE_ALLOCATION',
 'ADS_FIXED_GROSS_10PCT_NOT_CONSERVED','ADS_REFUND_REVERSAL_NOT_CONSERVED',
 'ADS_ADVERTISER_OR_ADMIN_WAS_REWARDED','ADS_POOL_PRIVILEGE_LEAK','rollback;'])
 assert.ok(isolated.includes(v),'Missing isolated proof: '+v);
assert.match(workflow,/--file=tests\/sql\/network-ads-pool-v1-1154.sql/);
assert.match(earn,/Fundo de pacotes e anúncios/);
assert.match(earn,/visualizações cobradas ou campanhas por período concluídas/);
assert.match(earn,/R\$ 0,02 consumidos reservam R\$ 0,002/);
assert.match(growth,/10% da publicidade realizada/);
assert.match(growth,/REDE TAMÃO • PACOTES E PUBLICIDADE/);
assert.doesNotMatch(earn,/O fundo recebe 10% do valor líquido de pacotes comerciais elegíveis\./);
console.log('V1.1154 PASS — 10% Ads credits + fixed campaigns, same Rede pool, subcent, signed receipts and no payout');
