import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013213000_growth_network_admin_overview_v1_227.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const audit=read('.github/workflows/audit.yml');
for(const token of [
 'admin_growth_network_overview_v1_227(',
 "a.admin_role in ('superadmin','operations','readonly','compliance')",
 'join public.prelaunch_leads l on l.id=a.lead_id',
 "l.status='converted'","inviter_kind='merchant'",
 "'source','growth_network_server_v1_227'",
 "'noPayout',true","'noPersonalData',true",
 "'crmConversionIsNotOrderSettlement',true",
 "'leadScope','consented_prelaunch_leads_only'",
 'revoke all on function public.admin_growth_network_overview_v1_227(uuid)',
 'grant execute on function public.admin_growth_network_overview_v1_227(uuid)'
])assert.ok(sql.includes(token),'Missing role-guarded growth contract '+token);
assert.ok(!/security definer|create table|alter table|grant select|insert into |update public|delete from/i.test(sql));
assert.ok(edge.includes('admin.rpc("admin_growth_network_overview_v1_227"'));
assert.ok(edge.includes('p_actor_user_id:actorUserId'));
assert.ok(edge.includes("growthNetwork={available:true,valid:false}"));
assert.ok(edge.includes("data?.noPayout===true"));
assert.ok(edge.includes('    growthNetwork,'));
assert.ok(edge.includes('growthNetwork:{available:false,valid:false}'));
assert.ok(ui.includes('adminGrowthNetworkOverviewView(data?.growthNetwork)'));
assert.ok(audit.includes('node tests/growth-admin-network-v1-227.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
const start=ui.indexOf('function adminGrowthNetworkOverviewView(');
const end=ui.indexOf('function adminPrelaunchLeadsSection(',start);
assert.ok(start>=0&&end>start);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
.replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const ctx=vm.createContext({Number,String,Array,esc});
vm.runInContext(ui.slice(start,end)+'\nthis.view=adminGrowthNetworkOverviewView;',ctx);
const good={
  available:true,valid:true,source:'growth_network_server_v1_227',
  readOnly:true,noPayout:true,noPersonalData:true,
  leadScope:'consented_prelaunch_leads_only',
  crmConversionIsNotOrderSettlement:true,
  attributedLeads:3,customerInvitedLeads:1,merchantInvitedLeads:2,
  customerInterests:2,merchantInterests:1,crmConvertedLeads:1,
  last30d:3,merchantsWithInviteCode:1,
  merchantBreakdown:[{merchantId:'m1',name:'Revenda <teste>',
    customerInterests:1,merchantInterests:1,crmConvertedLeads:1}]
};
const html=ctx.view(good);
assert.ok(html.includes('Novos contatos indicados'));
assert.ok(html.includes('Origem: revendas'));
assert.ok(html.includes('Sem créditos de indicação de revendas habilitados'));
assert.ok(html.includes('&lt;teste&gt;'));
assert.ok(!html.includes('<teste>'));
assert.ok(ctx.view({available:true,valid:false}).includes('indisponível'));
for(const v of [
 {...good,attributedLeads:5},
 {...good,customerInterests:4},
 {...good,noPayout:false},
 {...good,crmConversionIsNotOrderSettlement:false},
 {...good,merchantBreakdown:new Array(13).fill(good.merchantBreakdown[0])},
 {...good,customerInvitedLeads:-1},
 {...good,source:'fake'}
])assert.ok(ctx.view(v).includes('indisponível'),'Invalid numbers not shown as real');
assert.equal(ctx.view({available:false}),'');
console.log('V1.227 PASS — private aggregate analytics, role boundaries, no invented conversion or payout, escaped merchant names.');
