import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016040000_ads_offers_v1_310.sql');
const a=read('supabase/functions/admin-ops/index.ts');
const m=read('supabase/functions/merchant-ops/index.ts');
const admin=read('js/admin-activations.js');
const merchant=read('js/merchant.js');
const css=read('css/components.css');
new vm.Script(admin);new vm.Script(merchant);
for(const t of [
 'platform_ads_offers_v1_310','platform_ads_offer_actions_v1_310',
 'enable row level security','revoke all on public.platform_ads_offers_v1_310',
 'revoke all on public.platform_ads_offer_actions_v1_310',
 'ADS_OFFER_FOUNDER_REQUIRED','ADS_OFFER_OWNER_CONFIRMATION_REQUIRED',
 "a.admin_role='superadmin'","mm.member_role in ('owner','manager')",
 "v_role<>'owner'","p_consent is distinct from true",
 "'approved_creative'","v_plan.version","p_expected_offer_version",
 "v_offer.version<>p_expected_version","interval '14 days'",
 'ADS_OFFER_IDEMPOTENCY_REUSE','ADS_OFFER_VERSION_CONFLICT',
 'ADS_OFFER_CREATIVE_REVOKED','ADS_OFFER_PLAN_CHANGED',"v_offer.expires_at<=clock_timestamp()",
 "'nonBinding',true","'noCharge',true","'adsLive',false",
 "'paymentCreated',false","'contractSigned',false",
 'platform_admin_audit'
])assert.ok(sql.includes(t),'Missing SQL invariant: '+t);
assert.ok(!/insert into public\.(orders|payments|merchant_billing_)/.test(sql));
assert.ok(!/update public\.merchant_ads_campaigns_v1_233/.test(sql));
for(const t of [
 'if(action==="ads-offers-read")','if(action==="ads-offer-action")',
 'String(adminAccess.admin_role||"")!=="superadmin"',
 'admin_ads_offers_read_v1_310','admin_ads_offer_action_v1_310',
 'p_actor:user.id','p_expected_offer_version:body.expectedOfferVersion',
 'data.adsLive!==false','data.merchantNotified!==false'
])assert.ok(a.includes(t),'Missing admin API contract: '+t);
for(const t of [
 '"ads-offer"','if(action==="ads-offer")',
 'role!=="owner"','admin.rpc("merchant_ads_offer_v1_310"',
 'p_actor:user.id','body.consent!==true','data.nonBinding!==true',
 'data.paymentCreated!==false','data.contractSigned!==false'
])assert.ok(m.includes(t),'Missing merchant API contract: '+t);
assert.ok(admin.includes("['adsOffers','ads-offers-read','admin_ads_offers_v1_310']"));
assert.ok(admin.includes('adminAdsOfferAction('));
assert.ok(merchant.includes('merchantAdsOfferSection(m)'));
assert.ok(css.includes('.merchant-ads-offer'));

let memberRole='owner',accept=true,check=true,callLog=[],toasts=[],status='shared',version=1;
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rt={merchant:{merchantId,memberRole},adsOffer:null,adsOfferBusy:false};
const merchantCode=merchant.slice(merchant.indexOf('// TAMÃO V1.310 — owner response'));
assert.ok(merchantCode.includes('async function merchantAdsOfferRespond('));
const ctx=vm.createContext({
 merchantRuntime:rt,
 merchantInvoke:async(_name,data)=>{
  callLog.push(data);
  if(data.operation==='view')return {
    source:'merchant_ads_offer_v1_310',merchantId,readOnly:true,
    nonBinding:true,noCharge:true,adsLive:false,contractSigned:false,paymentCreated:false,
    offer:{status,version,priceCents:9900,durationDays:14,
      sharedAt:'2026-10-15T10:00:00Z',expiresAt:'2026-10-29T10:00:00Z',expired:false}
  };
  status=data.operation;version+=1;
  return {source:'merchant_ads_offer_v1_310',merchantId,recorded:true,
    status,version,noCharge:true,adsLive:false,contractSigned:false,paymentCreated:false};
 },
 document:{getElementById:()=>({checked:check})},
 confirm:()=>accept,crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 toast:x=>toasts.push(x),render:()=>{},esc:s=>String(s),formatDateTime:s=>s,
 Number,String,Date,Promise
});
vm.runInContext(merchantCode+
 '\nthis.loadOffer=merchantAdsOfferLoad;this.respondOffer=merchantAdsOfferRespond;this.showOffer=merchantAdsOfferSection;',ctx);
assert.equal((await ctx.loadOffer()).offer.status,'shared');
assert.match(ctx.showOffer(rt.merchant),/99,00/);
assert.match(ctx.showOffer(rt.merchant),/Tenho interesse nestas condições/);
check=false;assert.equal(await ctx.respondOffer('interested'),false);
assert.equal(callLog.filter(c=>c.operation==='interested').length,0);
check=true;accept=false;assert.equal(await ctx.respondOffer('interested'),false);
accept=true;assert.equal(await ctx.respondOffer('interested'),true);
assert.equal(version,2);
assert.equal(status,'interested');
assert.ok(callLog.some(c=>c.operation==='interested'&&c.consent===true&&c.expectedVersion===1));
assert.doesNotMatch(ctx.showOffer(rt.merchant),/onclick="merchantAdsOfferRespond/);
memberRole='manager';rt.merchant.memberRole='manager';
assert.equal(await ctx.respondOffer('declined'),false);
memberRole='support';rt.merchant.memberRole='support';
assert.equal(ctx.showOffer(rt.merchant),'');
console.log('V1.310 PASS — founder/owner gates, RLS, immutable offer, explicit consent, readback, no payment or publication.');
