import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261116184500_network_cross_module_benefits_v1_1041.sql');
const edge=read('supabase/functions/customer-summary/index.ts');
const backend=read('js/backend.js');
const growth=read('js/growth.js');
const audit=read('.github/workflows/audit.yml');
const isolated=read('.github/workflows/isolated-supabase-integration.yml');
new vm.Script(backend,{filename:'backend.js'});
new vm.Script(growth,{filename:'growth.js'});
const must=(source,what,label)=>assert.ok(source.includes(what),label+': '+what);
for(const tbl of ['network_module_invite_bindings_v1_1041',
 'network_module_ads_bonus_policy_v1_1041','network_module_ads_bonus_awards_v1_1041']){
 must(sql,'create table public.'+tbl,tbl);
 must(sql,'alter table public.'+tbl+' enable row level security',tbl+' RLS');
 must(sql,'revoke all on public.'+tbl+' from public,anon,authenticated',tbl+' ACL');
}
for(const key of ['products','merchants','mobility','professionals','rides','club','advertising']){
 must(growth,"['"+key+"',",'User gets '+key+' benefit tracking');
 const source={products:"public.orders",merchants:"public.merchant_applications",
   mobility:"public.mobility_fee_pix_invoices_v1_837",
   professionals:"l.vertical='professionals'",rides:"l.vertical='rides'",
   club:"public.clube_coupon_paid_invoices",advertising:"r.kind='advertising'"}[key];
 must(sql,source,'SQL must verify '+key+' from its own source');
}
must(sql,'on conflict(referred_user_id) do nothing','First valid source persists');
must(sql,"v_inviter=p_actor",'Self attribution rejected');
must(sql,"clock_timestamp()-interval '30 days'",'Old accounts cannot collect forged historic referrals');
assert.match(sql,/not coalesce\(v_policy\.enabled,false\)/);
assert.match(sql,/inviter_bps integer not null default 500 check\(inviter_bps between 0 and 500\)/);
assert.match(sql,/enabled boolean not null default false/);
assert.match(sql,/cashPayoutsEnabled',false/);
assert.match(sql,/r\.kind='advertising' and r\.resource_id=c\.campaign_id/);
assert.match(sql,/o\.status='net_verified'/);
assert.match(sql,/not exists\(select 1 from public\.ads_independent_refund_executions_v1_888/);
assert.doesNotMatch(sql,/insert into public\.(wallet_entries|network_fee_package_awards_v1_1030)/);
must(edge,'network_module_bind_invite_v1_1041','Service-only first touch from authenticated user');
must(edge,'{p_actor:user.id,p_code:hint}','Never trust client actor ID');
must(edge,'network_module_ads_bonus_refresh_v1_1041','Verified ad refresh');
must(edge,'if(requestBody?.networkVisit===true)','Only explicit network visit can refresh financial proof');
must(edge,'network_module_benefits_summary_v1_1041','Server sourced progress');
must(edge,'moduleBenefits,','Return customer-safe verified counts');
must(backend,"{referralCode:invite}",'Persist first touch with existing live customer summary');
must(backend,'liveRuntime.moduleBenefits=null;','Clear on account switch');
must(backend,'summary.moduleBenefits','Account-scoped readback');
must(growth,'tamaoNetworkModuleBenefitsPanel()','Render benefits in Rede');
must(growth,'Ainda não disponíveis para saque ou abatimento.','No false cash payout claims');
must(isolated,'network-cross-module-benefits-v1-1041.sql','Full disposable SQL proof');
must(audit,'network-cross-module-benefits-v1-1041.mjs','Audit coverage');
console.log('V1.1041 PASS: 7 vertical evidence, immutable first touch, reversible ads net proof, financial gate and session-safe UI.');
