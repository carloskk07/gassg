import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016170000_ads_merchant_assistance_v1_323.sql');
const a=read('supabase/functions/admin-ops/index.ts');
const m=read('supabase/functions/merchant-ops/index.ts');
const admin=read('js/admin-activations.js'),merchant=read('js/merchant.js');
new vm.Script(admin);new vm.Script(merchant);
for(const t of [
 'platform_ads_assistance_v1_323','platform_ads_assistance_actions_v1_323',
 'enable row level security','revoke all on public.platform_ads_assistance_v1_323',
 'revoke all on public.platform_ads_assistance_actions_v1_323',
 'ADS_ASSISTANCE_OWNER_CONSENT_REQUIRED',"v_role<>'owner'",
 'v_interest is distinct from true','v_active is distinct from true',
 "status not in ('closed','withdrawn')","v_record.version<>p_expected_version",
 'ADS_ASSISTANCE_REQUEST_REUSE','ADS_ASSISTANCE_FOUNDER_ONLY',
 "a.admin_role='superadmin'","a.admin_role in ('superadmin','operations','readonly')",
 "not v_interest","'consentCurrent'",'ADS_ASSISTANCE_ADMIN_VERSION_CONFLICT',
 "'noMessageSent',true","'messagesSent',0","'contactPerformed',false",
 "'noAutomaticOutreach',true","'paymentCreated',false",
 'platform_admin_audit','security definer'
])assert.ok(sql.includes(t),'Missing SQL guard '+t);
for(const t of [
 '"ads-assistance-read"','if(action==="ads-assistance-read")',
 'if(action==="ads-assistance-action")',
 'admin_ads_assistance_read_v1_323','admin_ads_assistance_action_v1_323',
 'String(adminAccess.admin_role||"")!=="superadmin"',
 'data.messagesSent!==0','data.contactPerformed!==false'
])assert.ok(a.includes(t),'Missing admin endpoint contract '+t);
for(const t of [
 '"ads-assistance"','if(action==="ads-assistance")',
 'role!=="owner"','body.consent!==true',
 'merchant_ads_assistance_v1_323','data.noMessageSent!==true'
])assert.ok(m.includes(t),'Missing merchant endpoint contract '+t);
assert.ok(admin.includes('adminAdsAssistanceView()'));
assert.ok(admin.includes("['adsAssistance','ads-assistance-read','admin_ads_assistance_v1_323']"));
assert.ok(merchant.includes('merchantAdsAssistanceSection(m)'));
assert.ok(!/insert into public\.(merchant_billing|platform_ads_psp|merchant_ads_campaigns)/.test(sql));
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let stage=null,version=0,channel='whatsapp',note='Quero orientação para iniciar publicidade TAMÃO',consent=false,confirmResponse=true,interest=true;
let calls=[],notifications=[];
const rt={merchant:{merchantId:id,memberRole:'owner'}};
const tail=merchant.slice(merchant.indexOf('// V1.323 — request human advice'));
const ctx=vm.createContext({
 merchantRuntime:rt,
 merchantInvoke:async(_fn,payload)=>{
  calls.push(payload);
  if(payload.operation==='view')return {
   source:'merchant_ads_assistance_v1_323',merchantId:id,
   readOnly:true,merchantActive:true,interestRegistered:interest,
   noMessageSent:true,noCharge:true,adsLive:false,
   request:stage===null?null:{status:stage,version,channel,note,
     requestedAt:'2026-10-16T15:00:00Z',updatedAt:'2026-10-16T15:00:00Z'}
  };
  stage=payload.operation==='request'?'requested':'withdrawn';version+=1;
  return {source:'merchant_ads_assistance_v1_323',merchantId:id,
   recorded:true,status:stage,version,noMessageSent:true,noCharge:true,adsLive:false};
 },
 document:{getElementById:k=>({
   value:k==='ads-help-channel'?channel:note,
   checked:consent
 })},
 crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 toast:t=>notifications.push(t),confirm:()=>confirmResponse,render:()=>{},
 esc:String,Number,String,Date,Promise
});
vm.runInContext(tail+'\nthis.readHelp=merchantAdsAssistanceLoad;this.actHelp=merchantAdsAssistanceAction;this.viewHelp=merchantAdsAssistanceSection;',ctx);
assert.equal((await ctx.readHelp()).request,null);
assert.match(ctx.viewHelp(rt.merchant),/Solicitar orientação do TAMÃO/);
assert.equal(await ctx.actHelp('request'),false);
assert.equal(calls.filter(x=>x.operation==='request').length,0);
consent=true;confirmResponse=false;
assert.equal(await ctx.actHelp('request'),false);
confirmResponse=true;interest=false;rt.adsAssistance.interestRegistered=false;
assert.equal(await ctx.actHelp('request'),false);
interest=true;rt.adsAssistance.interestRegistered=true;
assert.equal(await ctx.actHelp('request'),true);
assert.equal(stage,'requested');
assert.equal(calls.filter(x=>x.operation==='request').length,1);
assert.equal(calls.find(x=>x.operation==='request').consent,true);
assert.equal(await ctx.actHelp('withdraw'),true);
assert.equal(stage,'withdrawn');
assert.equal(version,2);
rt.merchant.memberRole='manager';
assert.equal(await ctx.actHelp('request'),false);
rt.merchant.memberRole='support';
assert.equal(ctx.viewHelp(rt.merchant),'');
console.log('V1.323 PASS — explicit merchant opt-in, withdrawal, founder-only internal triage, zero automatic contact or billing.');
