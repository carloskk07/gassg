import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016060000_ads_electronic_instruments_v1_312.sql');
const admin=read('js/admin-activations.js');
const merchant=read('js/merchant.js');
const adminApi=read('supabase/functions/admin-ops/index.ts');
const merchantApi=read('supabase/functions/merchant-ops/index.ts');
new vm.Script(admin,{filename:'admin-activations.js'});
new vm.Script(merchant,{filename:'merchant.js'});
for(const token of [
 'platform_ads_instruments_v1_312','platform_ads_acceptance_evidence_v1_312',
 'enable row level security','revoke all on public.platform_ads_instruments_v1_312',
 'revoke all on public.platform_ads_acceptance_evidence_v1_312',
 'ads_instrument_immutable_v1_312_before_update',
 'ADS_INSTRUMENT_IMMUTABLE_DOCUMENT','extensions.digest',
 'pg_catalog.convert_to','sha256',
 "a.admin_role='superadmin'","mm.member_role in ('owner','manager')",
 "v_role<>'owner'","p_consent is distinct from true",
 "status='reviewed'","status='interested'","status='approved_creative'",
 "'offered'","'merchant_accepted'","'bilateral_accepted'",
 'ADS_INSTRUMENT_COUNTERSIGN_BLOCKED','ADS_INSTRUMENT_STALE_OR_UNAVAILABLE',
 'ADS_INSTRUMENT_REQUEST_REUSE','ADS_INSTRUMENT_MERCHANT_IDENTITY_REQUIRED',
 "'paymentRequestCreated',false","'adsLive',false",
 "'notIcpCertified',true",'platform_admin_audit'
])assert.ok(sql.includes(token),'Missing SQL security invariant '+token);
assert.ok(!/insert into public\.(merchant_billing_payment_requests|orders|payments)/.test(sql));
assert.ok(!/update public\.(merchant_ads_campaigns_v1_233|ads_placement_controls_v1_236)/.test(sql));
for(const t of [
 '"ads-instruments-read"','if(action==="ads-instruments-read")',
 'if(action==="ads-instrument-action")','admin_ads_instruments_read_v1_312',
 'admin_ads_instrument_action_v1_312','String(adminAccess.admin_role||"")!=="superadmin"',
 'data.notIcpCertified!==true','data.paymentRequestCreated!==false'
])assert.ok(adminApi.includes(t),'Admin API '+t);
for(const t of [
 '"ads-instrument"','if(action==="ads-instrument")',
 'role!=="owner"','admin.rpc("merchant_ads_instrument_v1_312"',
 'p_actor:user.id','body.consent!==true',
 'data.notIcpCertified!==true','data.paymentRequestCreated!==false'
])assert.ok(merchantApi.includes(t),'Merchant API '+t);
assert.ok(admin.includes('adminAdsInstrumentsView()'));
assert.ok(merchant.includes('merchantAdsInstrumentSection(m)'));

const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sha256='a'.repeat(64);
let role='owner',phrase='',check=false,allow=true,stage='offered',version=1;
let log=[],messages=[];const rt={merchant:{merchantId,memberRole:role}};
const merchantTail=merchant.slice(merchant.indexOf('// TAMÃO V1.312 — authenticated'));
const ctx=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async(_fn,payload)=>{
  log.push(payload);
  if(payload.operation==='view')return {source:'merchant_ads_instrument_v1_312',
   merchantId,readOnly:true,noCharge:true,adsLive:false,paymentRequestCreated:false,
   notIcpCertified:true,instrument:{sha256,version,status:stage,
   document:{schema:'ads-electronic-instrument-v1.312',platformLegalName:'Empresa Modelo',
    platformCnpj:'11111111111111',merchantLegalName:'Revenda Modelo',
    merchantCnpj:'22222222222222',priceCents:10000,durationDays:14,dueDays:7,
    serviceScope:'Escopo da publicidade',cancellationTerms:'Cancelamento e revisão',
    executionCondition:'Condições de publicação'}}};
  stage='merchant_accepted';version+=1;
  return {source:'merchant_ads_instrument_v1_312',merchantId,status:stage,version,sha256,
   recorded:true,noCharge:true,adsLive:false,paymentRequestCreated:false,notIcpCertified:true};
 },
 document:{getElementById:id=>({checked:check,value:phrase})},
 toast:t=>messages.push(t),render:()=>{},confirm:()=>allow,
 crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 esc:s=>String(s),Number,String,Promise
});
vm.runInContext(merchantTail+
 '\nthis.loadDocument=merchantAdsInstrumentLoad;this.acceptDocument=merchantAdsInstrumentAccept;this.showDocument=merchantAdsInstrumentSection;',ctx);
assert.equal((await ctx.loadDocument()).instrument.status,'offered');
assert.match(ctx.showDocument(rt.merchant),/11111111111111/);
assert.match(ctx.showDocument(rt.merchant),/Registrar meu aceite eletrônico/);
assert.equal(await ctx.acceptDocument(),false);
check=true;phrase='NOPE';assert.equal(await ctx.acceptDocument(),false);
phrase='ACEITO';allow=false;assert.equal(await ctx.acceptDocument(),false);
assert.equal(log.filter(x=>x.operation==='accept').length,0);
allow=true;assert.equal(await ctx.acceptDocument(),true);
assert.equal(version,2);assert.equal(stage,'merchant_accepted');
assert.equal(log.filter(x=>x.operation==='accept').length,1);
assert.equal(log.find(x=>x.operation==='accept').sha256,sha256);
assert.doesNotMatch(ctx.showDocument(rt.merchant),/onclick="merchantAdsInstrumentAccept/);
rt.merchant.memberRole='manager';assert.equal(await ctx.acceptDocument(),false);
rt.merchant.memberRole='support';assert.equal(ctx.showDocument(rt.merchant),'');
console.log('V1.312 PASS — immutable document, SHA integrity, founder/owner gates, 2-party acceptance, no billing/publication.');
