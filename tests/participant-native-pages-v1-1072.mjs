import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ts=read('supabase/functions/participant-pages/index.ts');
const schema=read('supabase/migrations/20261118213900_participant_native_pages_v1_1072.sql');
const getOffers=read('supabase/functions/get-offers/index.ts');
const backend=read('js/backend.js'),customer=read('js/customer.js'),bootstrap=read('js/bootstrap.js');
const merchant=read('js/merchant.js'),discoveryOwner=read('js/discovery-owner.js'),growth=read('js/growth.js');
const page=read('p/page.js'),html=read('p/index.html'),css=read('p/style.css');
const owner=read('js/participant-native-owner.js'),ownerCss=read('css/participant-native-owner.css');
const build=read('scripts/build-live-portals.mjs'),staticBuild=read('scripts/build-public-site.mjs');
const sw=read('sw.js'),cfg=read('supabase/config.toml');
for(const [name,source] of Object.entries({
 'js/backend.js':backend,'js/bootstrap.js':bootstrap,'js/customer.js':customer,
 'js/growth.js':growth,'js/merchant.js':merchant,'js/discovery-owner.js':discoveryOwner,
 'js/participant-native-owner.js':owner,'p/page.js':page
}))new vm.Script(source,{filename:name});
assert.match(schema,/create table if not exists public\.participant_pages_v1_1072/);
assert.match(schema,/enable row level security/);
assert.match(schema,/revoke all on public\.participant_pages_v1_1072 from public, anon, authenticated/);
assert.match(schema,/grant select on public\.participant_pages_v1_1072 to authenticated/);
assert.match(schema,/for select to authenticated/);
assert.match(schema,/owner_id=\(select auth\.uid\(\)\)/);
assert.doesNotMatch(schema,/grant (insert|update|delete|all) on public\.participant_pages_v1_1072 to authenticated/i);
for(const name of ['merchant','customer','listing','agenda'])assert.ok(ts.includes('"'+name+'"'));
assert.match(ts,/await auth\.auth\.getUser\(token\)/);
assert.match(ts,/session|is_anonymous/);
assert.match(ts,/\.eq\("user_id",actor\)\.eq\("active",true\)/);
assert.match(ts,/\.in\("member_role",\["owner","manager"\]\)/);
assert.match(ts,/l\.owner_id!==actor/);
assert.match(ts,/a\.owner_id!==actor/);
assert.match(ts,/published&&!\(await refFor\(kind,subject,source\.ownerId\|\|actor\)\)/);
assert.match(ts,/from\("growth_merchant_invites_v1_226"\)/);
assert.match(ts,/from\("profiles"\)/);
assert.match(ts,/data\.user\.is_anonymous===true/);
assert.match(ts,/\.eq\("published",true\)/);
assert.match(ts,/\.eq\("active",true\)/);
assert.match(ts,/m\.status!=="active"/);
assert.match(ts,/discovery_public_search/);
assert.match(ts,/p_listing_id:page\.subject_id/);
assert.match(ts,/if\(!listing\)throw new PageError\("NOT_FOUND"/);
assert.match(ts,/if\(publishing&&!a\.published\)/);
assert.match(ts,/if\(publishing&&m\.status!=="active"\)/);
assert.match(ts,/if\(publishing&&l\.status!=="published"\)/);
assert.match(ts,/NO_REFERRAL_CODE/);
assert.match(ts,/no-store/);
assert.doesNotMatch(ts,/create-order|wallet_entries|commission_ledger|payment_intents|price_cents|available_stock/);
assert.match(cfg,/\[functions\.participant-pages\]\s*verify_jwt = false/);
assert.match(getOffers,/requestedMerchantId=body\.directMerchantId==null/);
assert.match(getOffers,/candidates\.filter\(candidate=>candidate\.merchantId===requestedMerchantId\)/);
assert.match(getOffers,/INVALID_MERCHANT_CHOICE/);
assert.match(getOffers,/market_city_offer_scope/);
assert.match(getOffers,/create_quote_snapshot_v3/);
assert.match(getOffers,/market_filter_delivery_payment_merchants/);
assert.match(getOffers,/filter_delivery_compatible_merchants/);
const start=getOffers.indexOf('    if(requestedMerchantId){\n      const selectedCandidates=');
const end=getOffers.indexOf('\n    if (!chosen.length)',start);
assert.ok(start>0&&end>start);
const excerpt=getOffers.slice(start,end).replace(/ as Array<.*>;/s,';');
assert.match(excerpt,/if\(requestedMerchantId\)/);
for(const [selected,ids] of [
 ['',["one","two"]],
 ['one',["one"]],
 ['bogus',[]]
]){
 const ctx=vm.createContext({requestedMerchantId:selected,candidates:[{merchantId:'one'},{merchantId:'two'}],
  chooseOffers:xs=>xs.map(candidate=>({candidate,label:'selected'}))});
 vm.runInContext(excerpt+';this.ids=chosen.map(x=>x.candidate.merchantId);',ctx);
 assert.deepEqual([...ctx.ids],ids,'Only selected merchant, normal broad market unchanged');
}
assert.match(backend,/function tamaoDirectSellerId\(\)/);
assert.match(backend,/directMerchantId:tamaoDirectSellerId\(\)/);
assert.match(backend,/TAMAO_DIRECT_SELLER_UUID\.test\(tamaoDirectSellerId\(\)\)/);
assert.match(backend,/url\.searchParams\.delete\('seller'\)/);
assert.match(bootstrap,/function tamaoDirectSellerCartEntry\(\)/);
assert.match(bootstrap,/if\(.*hasCartItems\(\)\)return false/);
assert.match(customer,/Você está comprando pela página de uma revenda/);
assert.match(customer,/Ver opções de todas as revendas/);
assert.match(owner,/tamaoNativePageAuthenticated/);
assert.match(owner,/tamaoNativePagePublicLink/);
assert.match(owner,/tamaoNativePageSessionId/);
assert.match(owner,/source:'participant_native_page_v1_1072'|data\?\.source!=='participant_native_page_v1_1072'/);
assert.match(growth,/tamaoParticipantNativePanel\('customer',''\)/);
assert.match(merchant,/tamaoParticipantNativePanel\('merchant',merchantId\)/);
assert.match(discoveryOwner,/tamaoParticipantNativePanel\('listing',id\)/);
assert.match(build,/copyDir\(path\.join\(ROOT,'p'\),path\.join\(target,'p'\)\)/);
assert.match(build,/\/p\/\* \/p\/index\.html 200/);
assert.match(staticBuild,/fs\.cpSync\(path\.join\(root,'p'\)/);
assert.match(sw,/\/p\(\?:\\\/\|\$\)/);
assert.match(html,/id="main-action"/);
assert.match(html,/id="catalog"/);
assert.match(css,/@media\(max-width:760px\)/);
assert.match(ownerCss,/@media\(max-width:520px\)/);
assert.match(page,/https:\/\/tamao\.com\.br/);
assert.match(page,/data\.merchantId/);
assert.match(page,/seller,item/);
assert.match(page,/referralCode/);
assert.match(page,/data\.agendaSlug/);
assert.match(page,/data\.listingId/);
assert.match(page,/document\.createElement\("img"\)/);
assert.doesNotMatch(page,/innerHTML\s*=/);
console.log('V1.1072 PASS — verified native participant pages, RLS, no private identity leak, seven legacy flows untouched, merchant-specific quote, no silent fallback, native listing and Agenda links.');
