import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261122224144_network_pool_redemption_terms_gates_v1_1155.sql');
const smoke=read('tests/sql/network-redemption-terms-v1-1155.sql');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const growth=read('js/growth.js');
const manual=read('js/growth-manual-payout.js');
const terms=read('docs/legal/draft-network-terms-2026-11-22-v1155.md');
const audit=read('.github/workflows/audit.yml');
const integration=read('.github/workflows/isolated-supabase-integration.yml');

for(const x of [
  'network_ads_pool_terms_set_v1_1155','network_source_redeemable_v1_1155',
  'redemption_terms_reference','redemption_terms_approved_at',
  'network_fee_package_policy_v1_1030','network_ads_pool_policy_v1_1154',
  'network_manual_payout_request_v1_1034','network_manual_payout_status_v1_1034',
  'network_fee_payout_status_v1_1031','network_fee_payout_reserve_v1_1031',
  'network_fee_offset_prepare_v1_1032','network_fee_offset_status_v1_1032',
  "p.kind in ('merchant_prepaid_fee','mobility_prepaid_fee')",
  'ads_verified_view', 'ads_fixed_campaign',
  'network_ads_pool_admin_summary_v1_1154',
  "grant execute on function public.network_source_redeemable_v1_1155(text) to service_role",
]) {
  // The function body explicitly branches on p_kind, not on a table column.
  if(x.startsWith('p.kind in'))continue;
  assert.ok(sql.includes(x),'Source-specific redemption must include '+x);
}
assert.match(sql,/when p_kind in \('ads_verified_view','ads_fixed_campaign'\)/);
assert.match(sql,/when p_kind in \('merchant_prepaid_fee','mobility_prepaid_fee'\)/);
assert.match(sql,/revoke all on function public.network_ads_pool_terms_set_v1_1155\(uuid,boolean,text\)/);
assert.match(sql,/where a\.user_id=p_user and s\.state='eligible' and public\.network_source_redeemable_v1_1155\(a\.kind\)/);

for(const word of ['V1155_ADS_APPROVAL_UNLOCKED_WRONG_MODULE',
 'V1155_FEE_POLICY_UNLOCKED_ADS','V1155_ADS_REVOCATION_FAILED',
 'V1155_FEES_REVOCATION_LEAK','V1155_INVENTED_FINANCIAL_TRANSFER',
 'V1155_BLOCKED_SOURCE_APPEARS_AVAILABLE','rollback;']){
  assert.ok(smoke.includes(word),'Financial test missing '+word);
}

assert.match(edge,/admin\.rpc\("network_ads_pool_admin_summary_v1_1154"/);
assert.match(edge,/if\(action==="network-ads-pool-terms-set"\)/);
assert.match(edge,/p_actor:user\.id,p_approved:body\.approved/);
assert.match(admin,/adminNetworkAdsPoolPanel\(\)/);
assert.match(admin,/adminNetworkAdsPoolTermsToggle\(approved\)/);
assert.match(admin,/Retirada pendente de termos aprovados/);
assert.match(growth,/Fundo coletivo da Rede/);
assert.match(manual,/retirada exige termos aprovados para cada modalidade/);
assert.match(terms,/MINUTA INTERNA — NÃO PUBLICADA, NÃO APROVADA, NÃO VIGENTE/);
assert.match(terms,/2% sobre cada compra elegível/);
assert.match(terms,/10% de cada receita publicitária elegível/);
assert.match(terms,/Mínimo atual de solicitação: R\$ 50,00/);
assert.match(audit,/tests\/network-redemption-terms-v1-1155\.mjs/);
assert.match(integration,/--file=tests\/sql\/network-redemption-terms-v1-1155\.sql/);
console.log('V1.1155 PASS — Ads and fee-package redemption require their own approved terms; no automatic Pix');
