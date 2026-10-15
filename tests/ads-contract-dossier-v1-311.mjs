import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016050000_ads_contract_dossiers_v1_311.sql');
const adminApi=read('supabase/functions/admin-ops/index.ts');
const merchantApi=read('supabase/functions/merchant-ops/index.ts');
const adminUI=read('js/admin-activations.js');
const merchantUI=read('js/merchant.js');
new vm.Script(adminUI);new vm.Script(merchantUI);
for(const t of [
 'platform_ads_contract_dossiers_v1_311','platform_ads_dossier_actions_v1_311',
 'enable row level security','revoke all on public.platform_ads_contract_dossiers_v1_311',
 'revoke all on public.platform_ads_dossier_actions_v1_311',
 "a.admin_role='superadmin'","a.admin_role in ('superadmin','operations','readonly')",
 "mm.member_role in ('owner','manager')","v_role<>'owner'","p_confirmed is distinct from true",
 "status='interested'","status='approved_creative'",
 "'shared_for_review'","'reviewed'","'changes_requested'",
 "'paymentRequestCreated',false","'contractSigned',false","'adsLive',false",
 "v_pack.version<>p_expected_version","ADS_DOSSIER_REQUEST_REUSE",
 "ADS_DOSSIER_OWNER_CONFIRMATION_REQUIRED","ADS_DOSSIER_OFFER_NOT_INTERESTED",
 'platform_admin_audit',"p_expected_version integer"
])assert.ok(sql.includes(t),'SQL security invariant: '+t);
assert.ok(!/insert into public\.(orders|payments|merchant_billing_payment_requests)/.test(sql));
assert.ok(!/update public\.(ads_placement_controls|merchant_ads_campaigns)/.test(sql));
for(const t of [
 '"ads-dossiers-read"','if(action==="ads-dossiers-read")','if(action==="ads-dossier-action")',
 'admin_ads_dossiers_read_v1_311','admin_ads_dossier_action_v1_311',
 'String(adminAccess.admin_role||"")!=="superadmin"',
 'data.paymentRequestCreated!==false','data.contractSigned!==false'
])assert.ok(adminApi.includes(t),'admin edge: '+t);
for(const t of [
 '"ads-dossier"','if(action==="ads-dossier")','role!=="owner"',
 'admin.rpc("merchant_ads_dossier_v1_311"',
 'data.reviewOnly!==true','data.contractSigned!==false','data.paymentRequestCreated!==false'
])assert.ok(merchantApi.includes(t),'merchant edge: '+t);
assert.ok(adminUI.includes('adminAdsDossiersView()'));
assert.ok(adminUI.includes("['adsDossiers','ads-dossiers-read','admin_ads_dossiers_v1_311']"));
assert.ok(merchantUI.includes('merchantAdsDossierSection(m)'));
let role='owner',consent=false,approval=true,packStatus='shared_for_review',version=1;
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let invocations=[],messages=[];
const rt={merchant:{merchantId,memberRole:role}};
const merchantTail=merchantUI.slice(merchantUI.indexOf('// TAMÃO V1.311 — view and acknowledge'));
const env=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async(_name,body)=>{
  invocations.push(body);
  if(body.operation==='view')return {
   source:'merchant_ads_dossier_v1_311',merchantId,readOnly:true,reviewOnly:true,
   noCharge:true,adsLive:false,contractSigned:false,paymentRequestCreated:false,
   dossier:{status:packStatus,version,priceCents:12900,durationDays:14,dueDays:7,
    serviceScope:'Divulgação local planejada para região e período definidos mediante condições comerciais aprovadas.',
    cancellationTerms:'Revisão dos termos de cancelamento será feita por ambas as partes antes do contrato final.'}};
  packStatus=body.operation;version++;
  return {source:'merchant_ads_dossier_v1_311',merchantId,recorded:true,version,status:packStatus,
   noCharge:true,adsLive:false,contractSigned:false,paymentRequestCreated:false};
 },
 document:{getElementById:()=>({checked:consent})},
 toast:x=>messages.push(x),render:()=>{},confirm:()=>approval,
 crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 esc:s=>String(s),Number,String,Promise
});
vm.runInContext(merchantTail+
 '\nthis.loadDossier=merchantAdsDossierLoad;this.respondDossier=merchantAdsDossierRespond;this.dossierView=merchantAdsDossierSection;',env);
assert.equal((await env.loadDossier()).dossier.status,'shared_for_review');
assert.match(env.dossierView(rt.merchant),/129,00/);
assert.match(env.dossierView(rt.merchant),/Confirmar que revisei/);
assert.equal(await env.respondDossier('reviewed'),false);
assert.equal(invocations.filter(x=>x.operation==='reviewed').length,0);
consent=true;approval=false;
assert.equal(await env.respondDossier('reviewed'),false);
approval=true;
assert.equal(await env.respondDossier('reviewed'),true);
assert.equal(version,2);
assert.equal(packStatus,'reviewed');
assert.match(env.dossierView(rt.merchant),/sem assinatura/);
role='manager';rt.merchant.memberRole=role;
assert.equal(await env.respondDossier('request_changes'),false);
role='support';rt.merchant.memberRole=role;
assert.equal(env.dossierView(rt.merchant),'');
console.log('V1.311 PASS — founder-owned dossier, owner review and explicit confirmation, version audit, zero billing or signatures.');
