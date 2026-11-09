import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin-activations.js');
assert.doesNotThrow(()=>new vm.Script(source,{filename:'admin-activations.js'}));
for(const required of [
 "action:'clube-coupon-commercial-status'","action:'ads-independent-read'",
 "coupon?.source==='clube_commercial_release_status_v1_819'",
 "independent?.source==='admin_ads_independent_read_v1_884'",
 "independent?.billingEnabled===false","independent?.revenueCents===0",
 "independent?.independentlyAuditedImpressions===0",
 "typeof coupon?.commercialEnabled==='boolean'",
 "typeof independent?.fixedFeeSalesEnabled==='boolean'",
 "role==='superadmin'?adminInvoke"
]) assert.ok(source.includes(required),'Missing authenticated, explicit modern read contract: '+required);
const beginning=source.indexOf('function adminActivationGo(key){');
const ending=source.indexOf('// V1.308 —',beginning);
assert.ok(beginning>=0&&ending>beginning);
const calls=[],role={value:'superadmin'};
const box={
 adminAdsWorkspaceTab:'diagnostics',
 adminIndependentAdsPane:'campaigns',
 adminActivationDesk:{actor:'id1',role:'superadmin',checkedAt:new Date().toISOString(),
  data:{
    paidCoupons:{enabled:true,emergencyStop:false},
    independentAds:{salesEnabled:false,deliveryEnabled:false,campaignCount:0},
    ads:{approvedCreatives:0},clube:{activeInterests:0},
    governance:null,push:null
  },loading:false,error:null},
 adminReady:()=>true,adminCurrentRole:()=>role.value,
 adminRoleCanSection:()=>true,adminRuntime:{session:{user:{id:'id1'}}},
 adminSetSection:section=>calls.push(section),
 requestAnimationFrame:fn=>fn(),document:{querySelector:()=>null},
 formatDateTime:x=>x,esc:x=>String(x),Date,Number,
 adminAdsLaunchReadinessView:()=>'',adminAdsLeadsView:()=>'',adminAdsAssistanceView:()=>'',adminAdsContactsView:()=>'',
 adminAdsFeedbackView:()=>'',adminAdsFeedbackReturnsView:()=>'',adminAdsReturnExecutionView:()=>'',adminAdsReturnCloseoutView:()=>'',
 adminMarketingIntakeView:()=>'',adminAdsSalesPlansView:()=>'',adminAdsDossiersView:()=>'',adminAdsInstrumentsView:()=>'',adminAdsReceivablesView:()=>'',adminAdsPspView:()=>'',adminAdsMpInboxView:()=>'',adminAdsMpTriageView:()=>'',adminAdsPspFreshnessView:()=>'',adminAdsPspMerchantReviewsView:()=>''
};
vm.runInNewContext(source.slice(beginning,ending)+'\nthis.go=adminActivationGo;this.view=adminActivationDeskView;',box);
let html=box.view({launchReadiness:{commerceEnabled:false},commercialPolicy:{policy_version:1},
 merchants:[{status:'pending'},{status:'active'},{status:'pending'}]});
assert.match(html,/1 revenda\(s\) ativa\(s\), 2 aguardando habilitação/);
assert.match(html,/Finalizações comerciais por módulo/);
assert.match(html,/Clube — cupons pagos/);
assert.match(html,/Autorizado/);
assert.match(html,/Publicidade independente/);
assert.match(html,/Contratação desabilitada/);
assert.match(html,/Pedidos físicos aguardam oferta real/);
assert.match(html,/Hospedagens seguem suspensas/);
assert.match(html,/Propostas legadas e governança/);
assert.doesNotMatch(html,/Clube e patrocínios<\/strong><span class="status-pill">Vendas bloqueadas/);
assert.match(html,/muda de seção, sem ativar vendas/);
box.go('paidCoupons');box.go('independentAds');box.go('merchant');
box.go('mobility');box.go('discovery');
assert.equal(JSON.stringify(calls),JSON.stringify(['finance','ads','enablement','orders','discovery']));
assert.equal(box.adminRuntime.financeWorkspace,'policy',
 'Clube shortcut must open the real Financeiro commercial-policy workspace');
assert.equal(box.adminAdsWorkspaceTab,'campaigns');
assert.equal(box.adminIndependentAdsPane,'finance',
 'Ads shortcut must open the existing financial provider verification task');
const before=calls.length;box.go('bad');assert.equal(calls.length,before);
box.adminActivationDesk.data={paidCoupons:{enabled:true,emergencyStop:true},
 independentAds:{salesEnabled:true,deliveryEnabled:true,campaignCount:3}};
html=box.view({launchReadiness:{commerceEnabled:true}});
assert.match(html,/Suspensão emergencial/);
assert.match(html,/Contratação habilitada/);
assert.match(html,/Pedidos físicos habilitados/);
box.adminActivationDesk.data={paidCoupons:null,independentAds:null};
html=box.view({});
assert.match(html,/Sem consulta financeira confirmada/);
assert.match(html,/Sem consulta comercial confirmada/);
assert.match(html,/Conferir liberação/);
assert.match(html,/Cadastro de revendas ainda não confirmado/);
box.adminActivationDesk.checkedAt='2000-01-01T00:00:00Z';
html=box.view({launchReadiness:{commerceEnabled:false}});
assert.match(html,/Não confirmado/,'stale evidence should never be represented as an active sale');
assert.match(read('.github/workflows/audit.yml'),/tests\/commercial-control-v1-915\.mjs/);
console.log('V1.915 PASS: signed modern commercial evidence, no legacy false blocks, emergency stop, stale roles, one-click navigation only.');
