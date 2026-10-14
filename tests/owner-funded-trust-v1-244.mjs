import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=file('supabase/migrations/20261014040000_owner_incentive_funding_v1_244.sql');
const api=file('supabase/functions/admin-ops/index.ts');
const adm=file('js/admin-acquisition.js');
const boot=file('js/bootstrap.js');
const grow=file('js/growth.js');
const cust=file('js/customer.js');
const workflow=file('.github/workflows/audit.yml');
for(const fragment of [
 'platform_incentive_funding_plan_v1_244','platform_incentive_funding_events_v1_244',
 "'platform_owner'","'monthly'",'check(verified_deposit_cents=0)',
 'check(reserved_cents=0)','check(paid_cents=0)',
 'check(new_benefits_enabled=false)','enable row level security',
 'revoke all on public.platform_incentive_funding_plan_v1_244',
 "'superadmin'","'internally_committed'",'p_cap>p_budget',
 'FUNDING_STALE_VERSION','FUNDING_REPLAY_CONFLICT',
 'pg_advisory_xact_lock','request_signature is distinct from v_signature',
 'platform_funding_private_v1_244.save_plan',
 'public.admin_owner_funding_read_v1_244',
 'public.admin_owner_funding_save_v1_244','FUNDING_ACL_DRIFT',
 "'noExternalCommitment',true"
])assert.ok(sql.includes(fragment),'Missing finance invariant: '+fragment);
assert.ok(!/(insert\s+into|update|delete\s+from)\s+public\.(order_reward_grants|reward_policy|merchant_billing_accounts|merchant_fee_credit_ledger|orders|clube_package_drafts_v1_239|referral_reward_reviews)/i.test(sql),
 'Planning must never modify reward, order or billing state');
for(const fragment of [
 '"owner-funding-read"','if(action==="owner-funding-read")',
 'if(action==="owner-funding-save")',
 'admin_owner_funding_read_v1_244','admin_owner_funding_save_v1_244',
 'String(adminAccess.admin_role)!=="superadmin"',
 'data?.newBenefitsEnabled!==false','data?.verifiedDepositCents!==0',
 'data?.moneyPaidCents!==0','data?.moneyReservedCents!==0'
])assert.ok(api.includes(fragment),'Missing Edge condition: '+fragment);
for(const fragment of [
 'function adminOwnerFundingSection()','adminOwnerFinanceWorkspaceSection(),',
 'async function adminOwnerFundingLoadFromUi()',
 'async function adminOwnerFundingSaveFromUi(',
 'adminOwnerFundingSaving','adminOwnerFundingSaveFromUi(',
 'Novo','Incentivos financiados pelo TAMÃO','internally_committed',
 'adminOwnerFundingState','budgetCents','capCents','expectedVersion'
].filter(x=>x!=='Novo'))assert.ok(adm.includes(fragment),'Missing Admin UX: '+fragment);
for(const f of ['adminOwnerFundingLoadFromUi','adminOwnerFundingSaveFromUi'])
 assert.ok(boot.includes(f),'Missing global callback '+f);
for(const f of [
 'Cada compra pode render mais vantagens para você.',
 'Seu próximo convite pode abrir novas portas.',
 'Compre bem, compartilhe o que gosta e construa sua rede.',
 'Tudo acompanhado em um só lugar.',
 'Sua marca presente no dia a dia de quem compra e vende.',
 'Uma parceria feita para gerar valor dos dois lados.',
 'uma primeira compra elegível','primeira compra válida',
 'A comissão é calculada sobre a primeira compra válida'
])assert.ok(grow.includes(f),'Missing truthful marketing text: '+f);
for(const f of [
 'Compre com liberdade. Compartilhe vantagens. Valorize sua cidade.',
 'Mais escolhas, menos trabalho','Você sabe em que etapa está'
])assert.ok(cust.includes(f),'Missing home text: '+f);
assert.ok(!grow.includes('Saque Pix ainda não disponível</button>'),
 'Do not advertise disabled payout as a CTA');
assert.ok(!grow.includes('Isso não significa que você receberá essa quantia.'),
 'Replace repetitive negative copy with specific eligibility conditions');
assert.ok(workflow.includes('node tests/owner-funded-trust-v1-244.mjs'));
for(const [path,s] of [
 ['js/admin-acquisition.js',adm],['js/growth.js',grow],
 ['js/bootstrap.js',boot],['js/customer.js',cust]
])new vm.Script(s,{filename:path});
console.log('V1.244 PASS — founder budget draft, zero monetary actions, permissions and clearer truthful copy');
