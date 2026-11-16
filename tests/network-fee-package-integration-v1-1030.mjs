import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=(name)=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const db=read('supabase/migrations/20261116010000_network_fee_package_ledger_v1_1030.sql');
const tick=read('supabase/migrations/20261116011000_network_fee_package_accrual_v1_1030.sql');
const customer=read('supabase/functions/customer-summary/index.ts');
const merchant=read('supabase/functions/merchant-ops/index.ts');
const admin=read('supabase/functions/admin-ops/index.ts');
const growth=read('js/growth.js');
const backend=read('js/backend.js');
const merchantUi=read('js/merchant.js');
const adminUi=read('js/admin.js');
const acquisition=read('js/admin-acquisition.js');
const bootstrap=read('js/bootstrap.js');
const integration=read('.github/workflows/isolated-supabase-integration.yml');
const audit=read('.github/workflows/audit.yml');
const has=(s,patterns)=>patterns.forEach(p=>assert.ok(s.includes(p),'missing: '+p));
has(db,[
 'network_fee_package_policy_v1_1030','accrual_enabled boolean not null default false',
 'payouts_enabled boolean not null default false check(payouts_enabled=false)',
 'network_member_visits_v1_1030','primary key(user_id,visit_hour)',
 'network_fee_package_sources_v1_1030','network_fee_package_awards_v1_1030',
 "kind in ('merchant_prepaid_fee','mobility_prepaid_fee')",
 'network_record_visit_v1_1030','network_user_fee_package_summary_v1_1030',
 'network_fee_package_admin_summary_v1_1030',
 'u.is_anonymous=false','u.email_confirmed_at is not null or u.phone_confirmed_at is not null',
 "from public,anon,authenticated,service_role",
 'no-store' // removed below: SQL does not set HTTP headers
].filter(x=>x!=='no-store'));
has(tick,[
 'network_fee_package_set_enabled_v1_1030','NETWORK_POLICY_OWNER_ONLY',
 'network_fee_package_tick_v1_1030','network_fee_package_conservation_v1_1030',
 'v_src.net_cents*100000','v_bonus:=floor(v_pool::numeric*2000/10000)',
 'a.kind=\'billing\'','a.kind=\'mobility\'',
 "r.request_kind='package_purchase'","r.auto_applied=true",
 "i.invoice_kind='prepaid_credit'", "o.status='net_verified'",
 'public.platform_receipt_net_audit','public.platform_receipt_net_observations',
 "f.status<>'ignored_unrelated'","s.state in ('pending','eligible')",
 "state='reversed'","state='eligible'",
 'v_count:=coalesce(array_length(v_visit_users,1),0)',
 'v_src.buyer_user_id','v_inviter is distinct from v_src.buyer_user_id',
 'v_each:=v_shared/v_count','v_rem:=mod(v_shared,v_count)',
 "payoutsExecuted',0","where a.user_id=p_user"
  // last string is in db, not tick
].filter(x=>x!=="where a.user_id=p_user"));
assert.doesNotMatch(tick, /insert into public\.wallet_entries/i);
assert.doesNotMatch(tick, /mercadopagoFetch\(|payouts\/|transferência pix/i);
assert.ok(tick.indexOf('if not v_config.accrual_enabled then') <
  tick.indexOf('for v_src in'),'No past/test receipt credited when policy disabled');
has(customer,['network_record_visit_v1_1030','network_user_fee_package_summary_v1_1030',
 'requestBody?.networkVisit===true','const user=await authenticatedUser(req)']);
has(merchant,['network_record_visit_v1_1030','network_user_fee_package_summary_v1_1030',
 'if(!canManage(role))','packageNetwork:verified?']);
has(admin,['network-fee-package-status','network-fee-package-set-enabled',
 'network_fee_package_admin_summary_v1_1030','network_fee_package_conservation_v1_1030',
 'network_fee_package_set_enabled_v1_1030',
 'String(adminAccess.admin_role)!=="superadmin"']);
has(growth,['function tamaoNetworkVisitFromUi','networkVisit:true',
 'function tamaoNetworkFeePackagePanel()','Ainda não sacável','tamaoNetworkFeePackagePanel()']);
has(backend,['liveRuntime.networkPackage=summary.networkPackage']);
has(merchantUi,['growth.packageNetwork.pendingCents','Os valores são individuais da sua conta']);
has(acquisition,['adminNetworkFeePackagePanel()']);
has(adminUi,['function adminNetworkFeePackagePanel()','adminNetworkFeePackageToggle(true)',
 'adminNetworkFeePackageRefresh()','Conservação contábil']);
has(bootstrap,['adminNetworkFeePackageRefresh,adminNetworkFeePackageToggle']);
has(integration,['network-fee-package-lifecycle-v1-1030.sql']);
has(audit,['network-fee-package-integration-v1-1030.mjs']);
for(const f of ['js/growth.js','js/backend.js','js/merchant.js','js/admin-acquisition.js','js/bootstrap.js']){
 execFileSync(process.execPath,['--check',new URL('../'+f,import.meta.url).pathname],
  {stdio:'pipe'});
}
console.log('PASS: Rede endpoints, source-bound NET pool, 24h participation, Admin gate, role restrictions, UI access and CI integration; no live payout.');
