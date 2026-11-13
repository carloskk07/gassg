import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const acquisition=read('js/admin-acquisition.js');
const ads=read('js/admin-ads-independent.js');
const css=read('css/components.css');
for(const [name,source] of Object.entries({admin,acquisition,ads}))
  assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));

const roles=admin.slice(admin.indexOf('const ADMIN_SECTION_ROLES='),admin.indexOf('function adminRelativeTime('));
const rc=vm.createContext({adminCurrentRole:()=> 'superadmin',adminRuntime:{section:'growth'}});
vm.runInContext(roles+'\nthis.can=adminRoleCanSection;this.meta=adminSectionMeta;',rc);
for(const role of ['superadmin','operations','compliance']){
 assert.equal(rc.can('growth',role),true);
 assert.equal(rc.can('partners',role),true);
}
for(const role of ['finance','support','readonly','anonymous'])
 assert.equal(rc.can('growth',role),false);
assert.equal(rc.meta('growth').title,'Crescimento');
assert.match(rc.meta('partners').description,/Veja cadastros, documentos e o que falta/);
assert.match(admin,/adminPanel\('growth',growthContent\)/);
assert.match(admin,/const growthContent=\(sectionActive\('growth'\)\)\?adminPrelaunchLeadsSection\(d\)/);
const partners=admin.slice(admin.indexOf('const partnersContent='),admin.indexOf('const catalogContent='));
assert.doesNotMatch(partners,/adminPrelaunchLeadsSection|adminAdsIndependentSection|adminClubeCampaignSection/);
assert.match(partners,/adminMerchantNetworkView/);
assert.match(partners,/adminMerchantOperationsQueueView/);
assert.match(admin,/adminMenuButton\('ads','Publicidade'/);
assert.match(admin,/adminMenuButton\('growth','Crescimento'/);
assert.match(admin,/adminMenuButton\('partners','Revendas'/);
assert.match(admin,/adminToggleAdvancedNav/);
assert.match(admin,/adminQuickGo/);
assert.match(admin,/admin-quick-grid/);
assert.match(admin,/admin-nav-advanced" \$\{showAdvanced\?'':'hidden'\}/);
assert.match(admin,/adminAdsWorkspaceTab==='campaigns'/);
assert.match(admin,/adminAdsWorkspaceTab==='diagnostics'/);
assert.match(admin,/adminAdsIndependentLoad\(\)/);
assert.match(admin,/adminAdsCampaignSection\(\)/);
assert.match(admin,/adminAdsAudienceSection\(\)/);
assert.match(admin,/adminAdsPlacementSection\(\)/);
assert.match(css,/admin-quick-grid/);
assert.match(css,/admin-nav-advanced\[hidden\]/);
assert.match(css,/admin-task-tabs/);

// The Growth workspace renders one task at a time, without revenda/Ads blending.
const g0=acquisition.indexOf('function adminPrelaunchLeadsSection(data){');
const g1=acquisition.indexOf('\n\nfunction adminPublicRequestKindLabel(value)',g0);
assert.ok(g0>=0&&g1>g0);
const growth=acquisition.slice(g0,g1);
assert.doesNotMatch(growth,/adminAdsCampaignSection|adminAdsIndependentSection|adminAdsPlacementSection/);
const calls=[];
const items=[
 'adminAcquisitionEvidenceView','adminAcquisitionCampaigns',
 'adminGrowthNetworkOverviewView','adminGrowthApplicationFunnelView',
 'adminClubeLaunchReadinessSection','adminClubeInterestSection',
 'adminClubeCampaignSection','adminClubeTermsSection',
 'adminGrowthReferralReviewSection','adminCommercialActivationSection',
 'adminOwnerFinanceWorkspaceSection','adminOwnerFinanceFallbackView'
];
const gx={
 adminGrowthWorkspaceTab:'acquisition',
 adminCurrentRole:()=> 'superadmin',
 adminAcquisitionMetrics:()=>({total:0,new:0,staleNew24h:0}),
 adminAcquisitionAggregateVerified:()=>true,
 adminLeadPriority:()=>0,
 adminPrelaunchLeadCard:()=>'<span>LEAD</span>'
};
for(const name of items)gx[name]=()=>{calls.push(name);return '<div>'+name+'</div>'};
vm.runInNewContext(growth+'\nthis.view=adminPrelaunchLeadsSection;',gx);
let html=gx.view({prelaunchLeads:[]});assert.match(html,/Contatos recentes/);
assert.ok(calls.includes('adminAcquisitionEvidenceView'));
assert.ok(!calls.includes('adminClubeCampaignSection'));
calls.length=0;gx.adminGrowthWorkspaceTab='benefits';
html=gx.view({prelaunchLeads:[]});assert.match(html,/Benefícios e indicações/);
assert.ok(calls.includes('adminClubeCampaignSection'));
assert.ok(!calls.includes('adminAcquisitionEvidenceView'));
calls.length=0;gx.adminGrowthWorkspaceTab='budget';
html=gx.view({prelaunchLeads:[]});assert.ok(calls.includes('adminOwnerFinanceWorkspaceSection'));
assert.ok(!calls.includes('adminClubeCampaignSection'));

// An explicit selected review reason avoids mandatory typing, but wrong
// decisions and money-changing actions retain all existing server gates.
const a0=ads.indexOf('function adminIndependentAdsMarked(group){');
const a1=ads.indexOf('\nasync function adminIndependentAdsCheckProvider()',a0);
assert.ok(a0>=0&&a1>a0);
const action=ads.slice(a0,a1);
const events=[];
const row={id:'11111111-2222-4333-8444-555555555555',version:3,status:'submitted'};
let selectedDecision='approve',chosenReason='Criativo revisado e aprovado pelo administrador.';
const ax={
 adminRuntime:{session:{user:{id:'owner'}}},
 adminCurrentRole:()=> 'superadmin',
 adminIndependentAdsBusy:false,
 adminIndependentAdsState:{loadedFor:'owner',rows:[row]},
 document:{
  getElementById:id=>id.startsWith('independent-ads-reason-')?{value:''}:null,
  querySelector:selector=>selector==='input[name="independent-ads-choice-'+row.id+'"]:checked'?
   {value:selectedDecision}:null
 },
 toast:v=>events.push(['toast',v]),
 adminPerform:async(action,args)=>{
  events.push(['write',action,args]);
  return {source:'admin_ads_independent_action_v1_884',
   billingEnabled:false,paymentCreated:false};
 },
 adminIndependentAdsRefresh:async()=>{events.push(['refresh'])}
};
vm.runInNewContext(action+'\nthis.run=adminIndependentAdsAction;',ax);
await ax.run('approve',row.id,3);
assert.equal(events.filter(x=>x[0]==='write').length,1);
assert.equal(events.find(x=>x[0]==='write')[2].reason,chosenReason);
assert.equal(events.find(x=>x[0]==='write')[2].decision,'approve');
events.length=0;selectedDecision='reject';
await ax.run('approve',row.id,3);
assert.equal(events.filter(x=>x[0]==='write').length,0);
assert.match(events.find(x=>x[0]==='toast')[1],/ação marcada mudou/);
assert.match(ads,/HOMOLOGAR/);
assert.match(ads,/DEVOLVER/);
assert.match(ads,/if\(r\?\.source!=='admin_ads_independent_action_v1_884'\|\|/);
console.log('V1.895 PASS: simpler admin grouping, scoped Growth tabs, Ads separation, role checks and one-selection reason with financial protections.');
