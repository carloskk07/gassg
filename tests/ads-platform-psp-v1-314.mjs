import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016080000_ads_platform_psp_v1_314.sql');
const cancellationGuard=read('supabase/migrations/20261016081000_ads_psp_cancellation_guard_v1_314.sql');
const a=read('supabase/functions/admin-ops/index.ts');
const m=read('supabase/functions/merchant-ops/index.ts');
const admin=read('js/admin-activations.js');
const merchant=read('js/merchant.js');
new vm.Script(admin,{filename:'admin-activations.js'});
new vm.Script(merchant,{filename:'merchant.js'});
for(const t of [
 'platform_ads_psp_checkouts_v1_314','platform_ads_psp_events_v1_314',
 'enable row level security','revoke all on public.platform_ads_psp_checkouts_v1_314',
 'revoke all on public.platform_ads_psp_events_v1_314',
 "a.admin_role='superadmin'","mm.member_role in ('owner','manager')",
 "status='bilateral_accepted'","v_r.status not in ('issued','canceled')",
 'ADS_PSP_DOCUMENT_HASH_MISMATCH','ADS_PSP_CHECKOUT_VERSION_CONFLICT',
 'ADS_PSP_REQUEST_REUSE','ADS_PSP_APPROVAL_NOT_PROVEN',
 "'approved'","'accredited'","'refunded'","'charged_back'",
 'ADS_PSP_DIFFERENT_PAYMENT_ID','p_payment_data','external_reference',
 "v_c.amount_cents::text","v_c.collector_id",
 "status in ('reserved','checkout_ready','payment_approved','payment_reversed')",
 "'adsLive',false","'merchantBillingSeparate',true",
 "v_r.due_date>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date",
 'platform_admin_audit'
]){
 const must=t==='ADS_PSP_DOCUMENT_HASH_MISMATCH'?'ADS_PSP_INSTRUMENT_OR_STATEMENT_INVALID':t;
 assert.ok(sql.includes(must),'SQL invariant '+must);
}
for(const t of ['ads_receivable_external_checkout_guard_v1_314',
 "old.status='issued'","new.status='canceled'",
 "'reserved','checkout_ready','payment_approved'",
 'ADS_RECEIVABLE_EXTERNAL_CHECKOUT_REQUIRES_PROVIDER_REVIEW',
 'before update on public.platform_ads_receivables_v1_313'
])assert.ok(cancellationGuard.includes(t),'Cancellation safety gate: '+t);
assert.ok(a.includes('expires:true'));
assert.ok(a.includes('expiration_date_to:expiresAt.toISOString()'));
assert.ok(a.includes('expiration_date_from:new Date().toISOString()'));
assert.ok(a.indexOf('const expiresAt=new Date(')<a.indexOf('p_operation:"reserve"'),
 'Due date must be checked before a PSP reservation can strand the payment');
assert.ok(!/insert into public\.(merchant_billing_payment_requests|merchant_billing_payment_events|merchant_billing_provider_charges)/.test(sql));
assert.ok(!/update public\.(ads_placement_controls|merchant_ads_campaigns|merchant_billing)/.test(sql));
for(const t of [
 '"ads-psp-read"','if(action==="ads-psp-read")',
 'if(action==="ads-psp-action")','admin_ads_psp_read_v1_314',
 'admin_ads_psp_action_v1_314','String(adminAccess.admin_role||"")!=="superadmin"',
 'ADS_MP_CHECKOUT_ENABLED','ADS_MP_ACCESS_TOKEN','ADS_MP_SELLER_ID',
 'https://api.mercadolibre.com/users/me',
 'identity?.id','mercadoPagoFetch("/checkout/preferences"',
 'mercadoPagoFetch("/v1/payments/"+paymentId',
 'safeMercadoPagoUrl','moneyToCents','external_reference',
 'ADS_PSP_ALREADY_RESERVED','ADS_PSP_PREFERENCE_UNCONFIRMED',
 'status==="approved"&&detail==="accredited"',
 '["refunded","charged_back"]','adsLive:false'
])assert.ok(a.includes(t),'Admin PSP invariant '+t);
for(const t of [
 '"ads-psp"','if(action==="ads-psp")',
 'merchant_ads_psp_view_v1_314','data.adsLive!==false',
 'data.merchantBillingSeparate!==true'
])assert.ok(m.includes(t),'Merchant PSP invariant '+t);
assert.ok(admin.includes('adminAdsPspView()'));
assert.ok(admin.includes("['adsPsp','ads-psp-read','admin_ads_psp_v1_314']"));
assert.ok(merchant.includes('merchantAdsPspSection(m)'));
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const checkout={
 status:'checkout_ready',amountCents:15900,currency:'BRL',externalReference:'tamao-ads-'+merchantId.replaceAll('-','')+'-v2',
 checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=official',
 paymentApproved:false,providerStatus:null,verifiedAt:null
};
let role='owner',phase=0;const rt={merchant:{merchantId,memberRole:role}};
const tail=merchant.slice(merchant.indexOf('// V1.314 — merchant can open'));
const ctx=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async()=>({
  source:'merchant_ads_psp_view_v1_314',merchantId,readOnly:true,adsLive:false,
  merchantBillingSeparate:true,checkout:phase===0?null:checkout
 }),toast:()=>{},render:()=>{},esc:s=>String(s),Number,String,Promise
});
vm.runInContext(tail+'\nthis.readCheckout=merchantAdsPspLoad;this.showCheckout=merchantAdsPspSection;',ctx);
assert.equal((await ctx.readCheckout()).checkout,null);
phase=1;assert.equal((await ctx.readCheckout()).checkout?.status,'checkout_ready');
const section=ctx.showCheckout(rt.merchant);
assert.match(section,/159,00/);
assert.match(section,/mercadopago.com.br/);
assert.match(section,/rel="noopener noreferrer"/);
assert.match(section,/não prova o recebimento/);
rt.merchant.memberRole='support';assert.equal(ctx.showCheckout(rt.merchant),'');
console.log('V1.314 PASS — platform-only provider checkout; account/amount checks, founder gate, no callback-based paid state.');
