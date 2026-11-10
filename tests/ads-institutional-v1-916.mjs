import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin-ads-independent.js'),display=read('js/ads-display.js');
const edge=read('supabase/functions/ads-independent/index.ts');
const server=read('supabase/functions/admin-ops/index.ts');
const migration=read('supabase/migrations/20261109190000_ads_institutional_owner_v1_916.sql');
for(const [name,source] of Object.entries({admin,display}))
 assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));
for(const t of [
 'CREATE TABLE public.ads_institutional_campaigns_v1_916',
 'ads_institutional_challenges_v1_916','ads_institutional_signals_v1_916',
 'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
 'view_limit IN (100,500,1000)',
 'CREATE FUNCTION public.admin_ads_institutional_manage_v1_916',
 'CREATE FUNCTION public.admin_ads_institutional_read_v1_916',
 'CREATE FUNCTION public.ads_institutional_issue_v1_916',
 'CREATE FUNCTION public.ads_institutional_confirm_v1_916',
 'GRANT EXECUTE ON FUNCTION public.admin_ads_institutional_manage_v1_916',
 'TO service_role'
]) assert.ok(migration.includes(t),'Institutional schema/RLS/ACL missing '+t);
assert.doesNotMatch(migration,/INSERT INTO public.ads_independent_checkouts_v1_886|UPDATE public.ads_independent_sales_controls_v1_886|INSERT INTO public.ads_independent_payment_events_v1_886/);
for(const t of [
 'if(action==="ads-institutional-read")','if(action==="ads-institutional-manage")',
 'admin_ads_institutional_read_v1_916','admin_ads_institutional_manage_v1_916',
 'paymentCreated!==false','billingEnabled!==false'
]) assert.ok(server.includes(t),'Edge Admin RPC validation missing '+t);
assert.match(edge,/admin\.rpc\("ads_institutional_issue_v1_916"/);
assert.match(edge,/admin\.rpc\("ads_institutional_confirm_v1_916"/);
assert.match(edge,/if\(data\.slot\)return respond\(data,200,origin\)/);
assert.match(edge,/institutional\.recognized===true/);
assert.match(display,/INSTITUCIONAL • TAMÃO/);
assert.match(display,/nofollow noopener noreferrer sponsored/);
assert.match(display,/institutional\?'nofollow noopener noreferrer'/);
assert.match(admin,/adminPerform\('ads-institutional-manage'/);
assert.match(admin,/adminInvoke\(\{action:'ads-institutional-read'\}\)/);
assert.match(admin,/adminIndependentAdsHomologationAction/);
assert.match(admin,/Autorizar uma compra real de R\$ 19,90/);
assert.match(admin,/Abrir laboratório Pix \(sem gerar cobrança\)/);
assert.match(admin,/adminSetFinanceWorkspace\('lab'\)/);
const ctx=vm.createContext({
 adminRuntime:{section:'ads',session:{user:{id:'owner'}}},
 adminCurrentRole:()=> 'superadmin',adminRoleCanSection:()=>true,
 adminReady:()=>true,adminAdsWorkspaceTab:'campaigns',adminIndependentAdsPane:'institutional',
 adminSetSection:s=>{ctx.section=s},adminSetFinanceWorkspace:s=>{ctx.finance=s},
 document:{getElementById:()=>null},esc:x=>String(x),adminMoney:n=>String(n),
 formatDateTime:s=>s,render:()=>{},Date,Number,String,console
});
vm.runInContext(admin+';this.showAds=adminAdsIndependentSection;this.openLab=adminAdsOpenFinanceLab;this.choosePane=adminIndependentAdsOpenPane;',ctx);
vm.runInContext("adminIndependentAdsState.loadedFor='owner';adminIndependentAdsState.rows=[];adminInstitutionalAdsState.loadedFor='owner';adminInstitutionalAdsState.status='ready';adminInstitutionalAdsState.rows=[];",ctx);
let page=ctx.showAds();
assert.match(page,/Institucional — grátis, exclusivo do TAMÃO/);
assert.match(page,/Criar campanha gratuita para revisão/);
assert.match(page,/Cupons e benefícios/);
ctx.choosePane('finance');
assert.equal(ctx.adminIndependentAdsPane,'finance');
page=ctx.showAds();
assert.match(page,/Teste financeiro de publicidade dentro do Admin/);
assert.match(page,/Autorizar uma compra real de R\$ 19,90/);
assert.match(page,/sem gerar cobrança/);
assert.equal(ctx.openLab(),true);
assert.equal(ctx.section,'finance');
assert.equal(ctx.finance,'lab');
const target={innerHTML:'',textContent:'',querySelector:()=>null};
const displayCtx=vm.createContext({document:{getElementById:()=>target},
 esc:x=>x,String,Number,URL});
vm.runInContext(display+';this.draw=tamaoAdsDraw;',displayCtx);
const slot={label:'Institucional',advertiser:'TAMÃO',
 campaignId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 challenge:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 title:'Conheça o TAMÃO',description:'Explore os serviços da cidade.',
 city:'São Gabriel',state:'RS',url:'https://tamao.com.br/'};
displayCtx.draw('sponsor-ad-live-slot',slot);
assert.match(target.innerHTML,/INSTITUCIONAL • TAMÃO/);
assert.match(target.innerHTML,/Conhecer o TAMÃO/);
assert.doesNotMatch(target.innerHTML,/rel="[^"]*sponsored/);
displayCtx.draw('sponsor-ad-live-slot',{...slot,advertiser:'Outra Marca',url:'https://example.org/'});
assert.equal(target.textContent,'');
assert.match(read('.github/workflows/audit.yml'),/tests\/ads-institutional-v1-916\.mjs/);
assert.match(read('.github/workflows/isolated-supabase-integration.yml'),/tests\/isolated-ads-institutional-v1-916\.mjs/);

const controls={
 'ads-institutional-template':{value:'home'},
 'ads-institutional-duration':{value:'15'},
 'ads-institutional-limit':{value:'500'},
 'ads-institutional-ack':{checked:true}
};
const requests=[];
const retryCtx=vm.createContext({
 adminRuntime:{section:'ads',session:{user:{id:'owner'}}},
 adminCurrentRole:()=> 'superadmin',adminReady:()=>true,adminRoleCanSection:()=>true,
 adminAdsWorkspaceTab:'campaigns',adminIndependentAdsPane:'campaigns',
 document:{getElementById:id=>controls[id]||null},
 window:{confirm:()=>true},
 crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
 adminPerform:async(action,payload)=>{
  assert.equal(action,'ads-institutional-manage');
  requests.push({...payload});
  if(requests.length===1)throw Error('reply-lost-after-commit');
  return {source:'admin_ads_institutional_manage_v1_916',
   status:'approved',paymentCreated:false,billingEnabled:false};
 },
 adminInvoke:async({action})=>{
  if(action==='ads-independent-read')return {source:'admin_ads_independent_read_v1_884',
   billingEnabled:false,revenueCents:0,independentlyAuditedImpressions:0,rows:[]};
  if(action==='ads-independent-refunds-read')return {
   source:'admin_ads_independent_refunds_read_v1_887',refundMoneyMoved:false,rows:[]};
  if(action==='ads-institutional-read')return {
   source:'admin_ads_institutional_read_v1_916',
   readOnly:true,billingEnabled:false,paymentCreated:false,rows:[]};
  throw Error('Unexpected action: '+action);
 },
 toast:()=>{},render:()=>{},Date,Number,String,console
});
vm.runInContext(admin+
 ';this.createFree=adminInstitutionalAdsCreate;this.getFree=()=>adminInstitutionalAdsState;this.refreshPaid=adminIndependentAdsRefresh;',retryCtx);
vm.runInContext("adminInstitutionalAdsState.loadedFor='owner';adminInstitutionalAdsState.status='ready';",retryCtx);
assert.equal(await retryCtx.createFree(),false);
assert.equal(requests.length,1);
assert.equal(retryCtx.getFree().requestId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
controls['ads-institutional-template'].value='benefits';
assert.equal(await retryCtx.createFree(),undefined);
assert.equal(requests.length,1,'Changed retry options must not send another create request');
controls['ads-institutional-template'].value='home';
assert.equal(await retryCtx.createFree(),true);
assert.equal(requests.length,2);
assert.deepEqual(requests[0],requests[1],'An ambiguous reply must use the same idempotency key and options');
assert.equal(retryCtx.getFree().requestId,null);
await retryCtx.refreshPaid();
assert.equal(retryCtx.adminIndependentAdsPane,'campaigns',
 'An ordinary refresh must preserve a deliberately selected paid tab');
// The read above also schedules a separate institutional refresh. Drain it first,
// then emulate a genuinely new workspace load with no cached institutional state.
await new Promise(resolve=>setImmediate(resolve));
retryCtx.adminIndependentAdsPane='campaigns';
retryCtx.getFree().loadedFor=null;
await retryCtx.refreshPaid();
assert.equal(retryCtx.adminIndependentAdsPane,'institutional',
 'Initial founder workspace should select the free institutional campaign tab');

// V1.918: one financial-homologation workspace reuses existing read-only
// provider checks and Pix Lab. No request is issued merely by opening it.
const financeShell=read('js/admin.js');
assert.doesNotThrow(()=>new vm.Script(financeShell));
assert.match(financeShell,/id":"homologation","label":"Homologação"/);
assert.match(financeShell,/finance-homologation',section:'finance',tab:'homologation'/);
assert.match(financeShell,/adminCurrentRole\(\)==='superadmin'\)\?selected:'summary'/);
assert.match(financeShell,/Homologação financeira',\(\)=>adminFinanceHomologationView\(d\)/);
assert.match(financeShell,/function adminFinanceHomologationToggleLab\(\)/);
assert.match(financeShell,/function adminFinanceHomologationOpenAds\(pane\)/);
assert.match(admin,/adminOpenFinanceHomologation\(\)/);
const financeStart=financeShell.indexOf('function adminFinanceHomologationCatalog(){');
const financeEnd=financeShell.indexOf('function adminFinanceWorkspaceCurrent(){',financeStart);
assert.ok(financeStart>0&&financeEnd>financeStart);
let readCalls=0,chargeCalls=0,adsNavigation=null;
const financeCtx=vm.createContext({
 adminRuntime:{status:'ready',section:'finance',financeWorkspace:'homologation',
  session:{user:{id:'owner'}},financeHomologationLabOpen:false,
  financeLab:{live:null}},
 adminCurrentRole:()=> 'superadmin',adminReady:()=>true,adminRoleCanSection:()=>true,
 adminAdsIndependentSection:()=>'<div>Ads panel</div>',
 adminIndependentAdsState:{loadedFor:'owner',rows:[],fixedFeeSalesEnabled:false},
 adminIndependentAdsProviderPreflight:null,
 adminLatestBillingWebhookProbe:()=>null,
 adminFinanceLabView:()=>{chargeCalls++;return '<div>Laboratório Pix existente</div>';},
 adminFinanceRenderPart:(_label,fn)=>fn(),
 adminFinanceWorkspaceCurrent:()=> 'homologation',
 adminFinanceLabReadinessFromUi:async()=>{readCalls++},
 adminFinanceLabLiveReadinessFromUi:async()=>{readCalls++},
 adminAdsWorkspaceTab:'campaigns',adminIndependentAdsPane:'campaigns',
 adminSetSection:section=>{adsNavigation=section},
 render:()=>{},esc:x=>String(x),Date,Number,String
});
vm.runInContext(financeShell.slice(financeStart,financeEnd)+
 ';this.testView=adminFinanceHomologationView;this.testToggle=adminFinanceHomologationToggleLab;'+
 'this.testToAds=adminFinanceHomologationOpenAds;this.testOpen=adminOpenFinanceHomologation;',financeCtx);
let financeHtml=financeCtx.testView({});
assert.match(financeHtml,/Testes financeiros/);
assert.match(financeHtml,/Verificar conexão e webhook/);
assert.match(financeHtml,/Abrir teste Pix do módulo escolhido/);
assert.doesNotMatch(financeHtml,/Campanhas aptas ao teste/,
  'Paid Ads must not crowd the view for unrelated modules');
vm.runInContext("adminFinanceHomologationEvidenceState().selected='advertising'",financeCtx);
const adsFinanceHtml=financeCtx.testView({});
assert.match(adsFinanceHtml,/Publicidade comercial/);
assert.match(adsFinanceHtml,/Campanhas aptas ao teste de R\$ 19,90 por 7 dias: <strong>0<\/strong>/);
assert.doesNotMatch(financeHtml,/Laboratório Pix existente/);
assert.equal(chargeCalls,0);
assert.equal(readCalls,0);
assert.equal(financeCtx.testToggle(),true);
assert.equal(financeCtx.adminRuntime.financeHomologationLabOpen,true);
assert.match(financeCtx.testView({}),/Laboratório Pix existente/);
assert.equal(readCalls,2);
assert.equal(financeCtx.testToAds('finance'),true);
assert.equal(adsNavigation,'ads');
assert.equal(financeCtx.adminIndependentAdsPane,'finance');
assert.equal(financeCtx.testToAds('refunds'),false);
assert.equal(financeCtx.testOpen(),true);
assert.equal(financeCtx.adminRuntime.financeWorkspace,'homologation');
financeCtx.adminCurrentRole=()=> 'finance';
assert.match(financeCtx.testView({}),/somente ao superadmin/);
assert.equal(financeCtx.testToggle(),false);
assert.equal(financeCtx.testToAds('finance'),false);
assert.equal(financeCtx.testOpen(),false);

console.log('V1.916 PASS: founder institutional ads, paid unchanged, branded labels, Admin financial lab, zero charges.');
