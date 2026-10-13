import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013235900_ads_placement_gate_v1_236.sql');
const offers=read('supabase/functions/get-offers/index.ts');
const frontend=read('js/customer.js');
const backend=read('js/backend.js');
const admin=read('js/admin-acquisition.js');
const adminOps=read('supabase/functions/admin-ops/index.ts');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(frontend,{filename:'customer.js'});
new vm.Script(backend,{filename:'backend.js'});
new vm.Script(admin,{filename:'admin-acquisition.js'});
for(const part of [
 'public.ads_placement_controls_v1_236',
 'public_enabled boolean not null default false check(public_enabled=false)',
 'billing_enabled boolean not null default false check(billing_enabled=false)',
 'verified_delivery_enabled boolean not null default false check(verified_delivery_enabled=false)',
 'alter table public.ads_placement_controls_v1_236 enable row level security',
 'revoke all on public.ads_placement_controls_v1_236',
 'ads_internal_v1_236.select_sponsored_slot',
 'security definer',
 'security invoker',
 'coalesce(v_enabled,false) is distinct from true',
 "'source','ads_sponsored_slot_v1_236'",
 "'sponsoredSlot',null",
 "c.status='approved_creative'",
 "c.target_city=v_city and c.target_state=v_state",
 "c.merchant_id=any(p_offer_merchants)",
 "m.status='active' and m.online=true",
 "i.merchant_id=c.merchant_id and i.interested",
 "pr.product_code=any(p_product_codes)",
 "'label','Patrocinado'",
 "'nonBillable',true",
 "'clickUrl',null",
 "public.admin_ads_placement_readiness_v1_236",
 "'readyToSell',false",
 "'organicRankingUnaffected',true",
 "'billableImpressions',0",
 "'adsRevenueCents',0",
 'ADS_PLACEMENT_ACL_DRIFT'
])assert.ok(sql.includes(part),'Missing rollout invariant: '+part);
assert.doesNotMatch(sql,/grant (select|insert|update|delete|all) on public\.ads_placement_controls_v1_236 to service_role/i);
assert.doesNotMatch(sql,/alter table.*drop constraint/i);
for(const part of [
 'const chosen = chooseOffers(candidates)',
 'const quotedMerchantIds:string[]=[]',
 'quotedMerchantIds.push(candidate.merchantId)',
 'ads_sponsored_slot_v1_236',
 'p_offer_merchants:quotedMerchantIds',
 'p_product_codes:items.map(x=>x.productCode)',
 'placement?.publicEnabled===true',
 'placement?.billingEnabled===false',
 'placement?.verifiedDeliveryEnabled===false',
 'sponsoredSlot,',
 'offers:publicOffers,'
])assert.ok(offers.includes(part),'Offer isolate missing: '+part);
const rank=offers.indexOf('const chosen = chooseOffers(candidates)');
const placement=offers.indexOf('ads_sponsored_slot_v1_236');
const output=offers.indexOf('return json({\n      offers:publicOffers,');
assert.ok(rank>=0&&placement>rank&&output>placement,'Placement must run only after ranking and quote generation');
for(const part of [
 'function checkoutSponsoredEditorial()',
 "slot.label!=='Patrocinado'",
 'aria-label="Publicidade patrocinada"',
 'checkoutSponsoredEditorial()',
 'checkoutOfferCards(all)',
 'checkoutOfferComparison(all)'
])assert.ok(frontend.includes(part),'Editorial display missing: '+part);
for(const part of [
 'sponsoredSlot:null',
 'liveRuntime.sponsoredSlot=null',
 'const paid=data?.sponsoredSlot',
 "paid.nonBillable===true",
 "paid.city===String(data.serviceCity||'').trim()"
])assert.ok(backend.includes(part),'Frontend response containment missing: '+part);
for(const part of [
 'adminAdsPlacementSection()',
 "adminInvoke({action:'ads-placement-readiness'})",
 'data.publicEnabled!==false',
 'data.billingEnabled!==false',
 'data.verifiedDeliveryEnabled!==false',
 'O banco impede ativação pública'
])assert.ok(admin.includes(part),'Admin gate display missing: '+part);
for(const part of [
 '"ads-placement-readiness"',
 'if(action==="ads-placement-readiness")',
 'admin_ads_placement_readiness_v1_236',
 'p_actor:user.id',
 'data?.publicEnabled!==false',
 'data?.adsRevenueCents!==0'
])assert.ok(adminOps.includes(part),'Admin endpoint missing: '+part);
assert.match(workflow,/- name: TAMÃO Ads V1\.236 separate sponsored slot safety\s+run: node tests\/ads-placement-v1-236\.mjs/);
console.log('V1.236 PASS — no public ad, isolated editorial placement, no ranking/billing effects');
