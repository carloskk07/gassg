import {readAdsIndependentCheckoutSource} from './helpers/mercadopago-webhook-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {verifiedIndependentAdsPreference} from '../supabase/functions/_shared/ads-independent-preference.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const checkout=readAdsIndependentCheckoutSource();
const sql=read('supabase/migrations/20261108034000_ads_independent_checkout_recovery_v1_890.sql');
const admin=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-ads-independent.js');
const now=1762560000000;
const campaignId='11111111-2222-4333-8444-555555555555';
const reference='tamao-ads-ind-'+campaignId.replaceAll('-','');
const expiry=new Date(now+72*3600_000).toISOString();
const base={
 id:'123456789-a2201f8d-11cb-443f-adf6-de5a42eed67d',
 collector_id:123456789,external_reference:reference,
 items:[{id:'tamao-ads-independent-'+campaignId,currency_id:'BRL',quantity:1,unit_price:19.9}],
 expiration_date_to:expiry,preference_expired:false,
 init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123456789-a2201f8d-11cb-443f-adf6-de5a42eed67d'
};
const opt={reference,campaignId,sellerId:'123456789',amountCents:1990,expiresAt:expiry,nowMs:now};
const check=(p,o=opt)=>verifiedIndependentAdsPreference(p,o);
assert.equal(check(base)?.id,base.id);
for(const invalid of [
 {collector_id:999999999},
 {external_reference:'tamao-ads-ind-'+ '0'.repeat(32)},
 {items:[{...base.items[0],unit_price:49.9}]},
 {items:[{...base.items[0],quantity:2}]},
 {items:[{...base.items[0],currency_id:'USD'}]},
 {items:[{...base.items[0],id:'tamao-ads-independent-'+ '0'.repeat(36)}]},
 {preference_expired:true},{expiration_date_to:new Date(now+20_000).toISOString()},
 {expiration_date_to:new Date(now+48*3600_000).toISOString()},
 {init_point:'https://www.mercadopago.com.br.evil.example/checkout'},
 {init_point:'https://evil.example/pay'},
 {init_point:'http://www.mercadopago.com.br/pay'},
 {init_point:'https://user:pass@mercadopago.com.br/pay'},
 {id:'not valid'},{items:[]},{items:[base.items[0],base.items[0]]}
])assert.equal(check({...base,...invalid}),null,'Must reject forged PSP proof '+Object.keys(invalid));
assert.match(sql,/interval '72 hours'/);
assert.match(sql,/'expiresAt',v_checkout\.expires_at/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.ads_independent_checkout_reserve_v1_886/);
assert.match(checkout,/\/checkout\/preferences\/search\?external_reference=/);
assert.match(checkout,/providerPreferenceProof\(token/);
assert.match(checkout,/reused:true,recovered:true,viewChargesCents:0/);
assert.match(checkout,/prepareAdsPix/);
assert.match(checkout,/ADS_PREFERENCE_PENDING/);
assert.match(checkout,/ADS_CHECKOUT_EXPIRED/);
assert.match(checkout,/providerPreferenceProof\(token,String\(all\[0\]\.id/);
assert.equal((checkout.match(/mercadoPagoFetch\("\/checkout\/preferences",/g)||[]).length,0,
 'Repeated or orphaned checkouts must not send a second create-preference POST.');
assert.match(admin,/if\(action==="ads-independent-psp-preflight"\)/);
assert.match(admin,/readyForFinancialHomologation/);
assert.match(admin,/liveWebhookDeliveryVerified:false/);
assert.match(admin,/realPaymentHomologated:false/);
assert.match(admin,/realRefundHomologated:false/);
assert.match(admin,/if\(action==="ads-independent-sales-action"\)/);
assert.match(admin,/ADMIN_READ_ACTIONS=new Set\(\[[^\n]*"ads-independent-psp-preflight"/);
assert.ok(admin.indexOf('if(action==="ads-independent-psp-preflight")') <
 admin.indexOf('const idempotencyKey='),'read-only provider check may not require a financial mutation key');
assert.doesNotThrow(()=>new vm.Script(ui));
assert.match(ui,/adminIndependentAdsCheckProvider/);
assert.match(ui,/Conferir conta e webhook do TAMÃO Ads/);
console.log('V1.890 PASS: provider preference facts, no double checkout, 72h deadline and private read-only PSP preflight.');
