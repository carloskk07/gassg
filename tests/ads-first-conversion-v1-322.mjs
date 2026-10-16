import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=get('supabase/migrations/20261016160000_ads_lead_conversion_v1_322.sql');
const edge=get('supabase/functions/admin-ops/index.ts');
const admin=get('js/admin-activations.js'),merchant=get('js/merchant.js');
new vm.Script(admin);new vm.Script(merchant);
for(const t of [
 'admin_ads_leads_v1_322','security definer',"set search_path to 'pg_catalog'",
 "a.admin_role in ('superadmin','operations','readonly')",
 "i.interested is true",'merchant_ads_interest_v1_232','merchant_ads_campaigns_v1_233',
 'catalog_items','product_delivery_profiles','merchant_business_details',
 "'approved_for_planning'","'draft_ready_to_submit'","'needs_creative'",
 'marketingConsentInferred',"'contactPerformed',false","'notificationSent',false",
 "'paymentCreated',false","'adsLive',false","'noAutomaticOutreach',true",
 'revoke all on function public.admin_ads_leads_v1_322(uuid) from public,anon,authenticated',
 'grant execute on function public.admin_ads_leads_v1_322(uuid) to service_role'
])assert.ok(sql.includes(t),'DB opt-in guard: '+t);
assert.ok(!/\b(?:insert into|update|delete from)\s+public\./i.test(sql));
for(const t of ['"ads-leads-read"','if(action==="ads-leads-read")',
  'admin_ads_leads_v1_322','data.noAutomaticOutreach!==true',
  'data.contactPerformed!==false','data.marketingConsentInferred!==false'
])assert.ok(edge.includes(t),'Edge opt-in guard: '+t);
assert.ok(admin.includes("['adsLeads','ads-leads-read','admin_ads_leads_v1_322']"));
assert.ok(admin.includes('adminAdsLeadsView()'));
assert.ok(merchant.includes("onclick=\"merchantAdsFirstDraftCreate()\""));
assert.ok(merchant.includes('async function merchantAdsFirstDraftCreate()'));
assert.ok(merchant.includes("action:'ads-start-read'"));
assert.ok(merchant.includes("action:'ads-campaign',merchantId:id,operation:'save',version:0"));
assert.ok(!/merchantAdsFirstDraftCreate[\s\S]*?operation:'submit'/.test(merchant.slice(merchant.indexOf('// V1.322 — explicit FIRST Ads draft'))));
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const flags={
 source:'merchant_ads_start_read_v1_321',merchantId:id,nextAction:'prepare_creative',
 creativeStatus:null,creativeVersion:0,merchantActive:true,businessCityReady:true,
 interestRegistered:true,activeCatalogReady:true,creativeCityCurrent:true,
 noCharge:true,adsLive:false,noAutomaticEnrollment:true
};
let role='owner',allowed=true,stale=false,fail=false;
const calls=[],messages=[];const rt={merchant:{merchantId:id,memberRole:role},adsStart:{...flags}};
const ctx=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async(_fn,body)=>{
  calls.push(body);
  if(body.action==='ads-start-read')return {...flags,nextAction:stale?'register_interest':'prepare_creative'};
  if(body.operation==='save'){
   if(fail)throw Error('REMOTE_NOT_READY');
   return {source:'merchant_ads_campaign_v1_233',merchantId:id,noCharge:true,adsLive:false,
    campaign:{status:'draft',version:1,title:body.title,description:body.description}};
  }
  if(body.operation==='view')return {source:'merchant_ads_campaign_v1_233',merchantId:id,
   noCharge:true,adsLive:false,campaign:{status:'draft',version:1,
    title:'Conheça os produtos da nossa revenda',description:'Descrição aprovada pelo servidor'}};
  throw Error('UNEXPECTED_OPERATION');
 },
 crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 confirm:()=>allowed,render:()=>{},merchantAdsStartNavigate:()=>true,
 toast:m=>messages.push(m),String,Promise
});
const tail=merchant.slice(merchant.indexOf('// V1.322 — explicit FIRST Ads draft'));
vm.runInContext(tail+'\nthis.createDraft=merchantAdsFirstDraftCreate;',ctx);
allowed=false;assert.equal(await ctx.createDraft(),false);assert.equal(calls.length,0);
allowed=true;stale=true;assert.equal(await ctx.createDraft(),false);
assert.equal(calls.filter(x=>x.operation==='save').length,0);
stale=false;fail=true;rt.adsStart={...flags};
assert.equal(await ctx.createDraft(),false);
assert.equal(calls.filter(x=>x.operation==='submit').length,0);
fail=false;rt.adsStart={...flags};
assert.equal(await ctx.createDraft(),true);assert.equal(rt.adsCampaign.campaign.status,'draft');
assert.equal(calls.filter(x=>x.operation==='save').length,2);
assert.equal(calls.filter(x=>x.operation==='submit').length,0);
rt.merchant.memberRole='support';rt.adsStart={...flags};
assert.equal(await ctx.createDraft(),false);
console.log('V1.322 PASS — consent-based admin Ads pipeline; fresh merchant preflight, voluntary draft only, no charges/outreach.');
