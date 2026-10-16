import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016180000_ads_assistance_contacts_v1_324.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-activations.js');
new vm.Script(ui);
for(const token of [
 'platform_ads_assistance_contacts_v1_324',
 'enable row level security',
 'revoke all on public.platform_ads_assistance_contacts_v1_324',
 'grant select,insert on public.platform_ads_assistance_contacts_v1_324 to service_role',
 'admin_ads_contacts_read_v1_324','admin_ads_contact_record_v1_324',
 "a.status in ('requested','triaged')","v_a.status not in ('requested','triaged')",
 "m.status='active'","v_m.status<>'active'","v_interest is distinct from true",
 "p_channel<>v_a.channel","v_a.version<>p_expected_assistance_version",
 "ADS_CONTACT_FOUNDER_ONLY",
 "p_next_followup_on>v_today+30","p_next_followup_on<v_today+1",
 'cc.recorded_at>=a.requested_at','c.recorded_at>=a.requested_at',
 "coalesce(i.interested,false)",
 'ADS_CONTACT_REQUEST_REUSE','platform_admin_audit',
 "'automatedMessagesSent',0","'independentlyVerified',false",
 "'adsLive',false","'paymentCreated',false"
].filter(x=>x!=="v_role"))assert.ok(sql.includes(token),'SQL invariant '+token);
assert.ok(!/insert into public\.(merchant_billing|platform_ads_psp|merchant_ads_campaigns)/.test(sql));
for(const token of [
 '"ads-contact-reports-read"','if(action==="ads-contact-reports-read")',
 'admin_ads_contacts_read_v1_324','if(action==="ads-contact-report")',
 'admin_ads_contact_record_v1_324','adminAccess.admin_role',
 'data.deliveryIndependentlyVerified!==false',
 'data.automatedMessageSent!==false','data.paymentCreated!==false'
])assert.ok(edge.includes(token),'Edge invariant '+token);
assert.ok(ui.includes("['adsContacts','ads-contact-reports-read','admin_ads_contacts_v1_324']"));
assert.ok(ui.includes('adminAdsContactsView()'));
const actor='abc',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let outcome='conversation',note='Realizei tentativa de orientação após solicitação expressa.',allow=true;
let role='superadmin',callCount=0;
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 adminReady:()=>true,adminRoleCanSection:()=>true,
 esc:s=>String(s),Number,String,Date,Promise,
 document:{getElementById:key=>({value:key.endsWith('-outcome')?outcome:key.endsWith('-note')?note:''})},
 confirm:()=>allow,prompt:()=>null,
 adminPerform:async()=>{callCount++;return {};},render:()=>{},toast:()=>{},
 adminInvoke:async()=>null,adminLoadGovernanceGates:async()=>null,
 adminPushReliabilityLoadFromUi:async()=>null
});
vm.runInContext(ui+'\nthis.viewContacts=adminAdsContactsView;this.recordContact=adminAdsContactRecord;this.desk=adminActivationDesk;',ctx);
ctx.desk.actor=actor;ctx.desk.role=role;ctx.desk.checkedAt=new Date().toISOString();
const row={merchantId:id,merchantName:'Revenda Exemplo',assistanceVersion:2,
 status:'triaged',consentCurrent:true,preferredChannel:'whatsapp',attemptsCount:1,
 lastAttempt:{outcome:'followup_requested',channel:'whatsapp',
 note:'Cliente solicitou novo contato na próxima semana.',nextFollowupOn:'2026-10-25',
 independentlyVerified:false,recordedAt:'2026-10-16T12:00:00Z'}};
ctx.desk.data={adsContacts:{
 source:'admin_ads_contacts_v1_324',readOnly:true,totalManualReports:1,followupsDue:0,
 rows:[row],automatedMessagesSent:0,deliveryIndependentlyVerified:false,
 noAutomaticOutreach:true,adsLive:false,paymentCreated:false
}};
assert.match(ctx.viewContacts(),/Revenda Exemplo/);
assert.match(ctx.viewContacts(),/Retorno solicitado/);
assert.match(ctx.viewContacts(),/Registrar atendimento manual/);
row.consentCurrent=false;
assert.doesNotMatch(ctx.viewContacts(),/Registrar atendimento manual/);
assert.equal(await ctx.recordContact(id),false);
row.consentCurrent=true;
note='curta';assert.equal(await ctx.recordContact(id),false);
note='Realizei tentativa de orientação após solicitação expressa.';
allow=false;assert.equal(await ctx.recordContact(id),false);
assert.equal(callCount,0);
role='operations';assert.equal(await ctx.recordContact(id),false);
assert.doesNotMatch(ctx.viewContacts(),/Registrar atendimento manual/);
console.log('V1.324 PASS — founder-only, current opt-in, cycle-isolated audit, no fake delivery or billing.');
