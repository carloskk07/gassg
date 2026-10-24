import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261010163000_merchant_enablement_diagnostic_v1_157.sql');
const canonical=read('supabase/migrations/20261010150000_multicity_commerce_boundary_v1_152.sql');
const backend=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin.js');
const ui=read('js/admin-acquisition.js');
assert.ok(sql.includes('function public.admin_merchant_enablement_v1_157(p_limit integer default 80)'));
assert.ok(sql.includes('stable security definer'));
assert.ok(sql.includes('revoke all on function public.admin_merchant_enablement_v1_157(integer)'));
assert.ok(sql.includes('from public,anon,authenticated'));
assert.ok(sql.includes('grant execute on function public.admin_merchant_enablement_v1_157(integer)'));
assert.ok(sql.includes('to service_role'));
assert.ok(sql.includes('limit least(greatest(coalesce(p_limit,80),1),100)'), 'bounded read');
assert.ok(sql.includes('public.market_city_offer_scope(t.city,t.state)'), 'quote scope remains authority');
for(const g of [
  "c.status='active'","c.online","c.accepts_citywide",
  "c.last_seen_at>=statement_timestamp()-interval '10 minutes'",
  "c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'",
  "c.global_commerce_enabled","c.mode_allowed","c.finance_ok",
  "c.cnpj_ok","c.anp_ok","c.city_not_paused",
  "c.stock_price_ok","c.payment_method_ok","c.payment_route_ok"
])assert.ok(sql.includes(g),'must explain '+g);
for(const gate of ['merchant_allowed_in_operation_mode','merchant_cnpj_compliance_current',
  'merchant_anp_compliance_current','merchant_financial_sales_allowed','catalog_items',
  'merchant_payment_methods','merchant_payment_routes','market_cities','platform_launch_control']){
  assert.ok(sql.includes(gate), 'missing real authority condition '+gate);
  assert.ok(canonical.includes(gate)||['merchant_cnpj_compliance_current','merchant_anp_compliance_current'].includes(gate),
    'mismatch with canonical scope '+gate);
}
assert.ok(!/update public\.(merchants|market_cities|platform_launch_control)/i.test(sql));
assert.ok(!/insert into public\./i.test(sql),'no fake readiness data');
assert.ok(backend.includes('"merchant-enablement"'));
assert.ok(backend.includes('admin.rpc("admin_merchant_enablement_v1_157",{p_limit:80})'));
assert.ok(backend.includes('readOnly:true'));
assert.ok(backend.includes('source:"market_city_offer_scope"'));
assert.ok(backend.includes('["superadmin","operations","compliance","readonly"]'));
for(const str of ["enablement:new Set(['superadmin','readonly','operations','compliance'])",
  "adminMenuButton('enablement','Habilitação'",
  "adminPanel('enablement',sectionActive('enablement')?(typeof adminEnablementSection==='function'?adminEnablementSection(d):adminExpansionFallbackView()):'')",
  "if(['prospects','enablement'].includes(next))adminExpansionLoadOnDemand().catch"]){
  assert.ok(admin.includes(str),str);
}
assert.ok(ui.includes("async function adminLoadEnablement()"));
assert.ok(ui.includes("function adminEnablementMerchantCard(entry)"));
assert.ok(ui.includes("function adminEnablementCheckRow(check)"));
assert.ok(ui.includes('Revalidar agora'));
assert.ok(admin.includes('adminRuntime.enablementMerchants=[]'),'signout/auth failure must clear privileged diagnostics');
assert.ok(ui.includes("String(adminRuntime.session?.user?.id||'')!==requestingUser"),'drop responses after identity changes');
assert.ok(ui.includes('Sem liberações automáticas.'));
assert.ok(!ui.includes("adminPerform('merchant-enablement'"));
const cut=(source,name)=>{const begin=source.indexOf('function '+name+'(');assert.ok(begin>=0);const end=source.indexOf('\n}',begin);assert.ok(end>begin);return source.slice(begin,end+2);};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const merchantId='11111111-2222-4333-8444-555555555555';
const sandbox={esc,adminRoleCanSection:()=>true,
 adminRuntime:{data:{merchants:[{id:merchantId}]}}};
vm.runInNewContext(cut(ui,'adminEnablementCheckRow')+
 '\n'+cut(ui,'adminEnablementActionPlan')+
 '\n'+cut(ui,'adminEnablementMerchantCard')+
 ';this.card=adminEnablementMerchantCard;this.plan=adminEnablementActionPlan;',sandbox);
const output=sandbox.card({merchant_name:'<img src=x onerror=alert(1)>',city:'Santa Maria',
  state:'RS',cnpj:'12345678000190',merchant_status:'pending',ready:false,
  checks:[{key:'payment_route',label:'<script>alert(1)</script>',ok:false,
    action:'<svg onload=alert(1)>',owner:'merchant',scope:'merchant'}]});
assert.ok(output.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(output.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(output.includes('&lt;svg onload=alert(1)&gt;'));
assert.ok(!output.includes('<script>')&&!output.includes('<img'));
assert.ok(output.includes('1 bloqueio(s)'));
assert.ok(output.includes('Próxima ação'));
assert.ok(output.includes('Revenda: informações operacionais'));
assert.ok(!output.includes('Abrir validações desta revenda no Admin'),
 'an unverified merchant id must never create a navigation action');
const realistic=sandbox.card({merchant_id:merchantId,merchant_name:'Revenda de teste',
 merchant_status:'pending',ready:false,checks:[
  {key:'global_commerce',owner:'admin',scope:'global',ok:false,
   label:'Operação comercial',action:'Rever o modo de lançamento'},
  {key:'merchant_status',owner:'admin',scope:'merchant',ok:false,
   label:'Cadastro',action:'Validar cadastro e autorização'},
  {key:'payment_method',owner:'merchant',scope:'merchant',ok:true,
   label:'Pagamento',action:'Ativar pagamento'},
  {key:'inventory',owner:'merchant',scope:'merchant',ok:false,
   label:'Estoque',action:'Confirmar preço e estoque'},
  {key:'quote_authority',owner:'system',scope:'realtime',ok:false,
   label:'Cotação',action:'O sistema valida a oferta'}
 ]});
assert.ok(realistic.includes('Admin: cadastro e autorização (1)'));
assert.ok(realistic.includes('Revenda: informações operacionais (1)'));
assert.ok(realistic.includes('Plataforma e cidade (1)'));
assert.ok(realistic.includes('Abrir validações desta revenda no Admin'));
assert.ok(realistic.includes("adminMerchantReturnToControls('"+merchantId+"')"),
 'navigation must reuse the audited Admin controls for exactly this merchant');
assert.ok(!realistic.includes('Ativar pagamento'),
 'a verified payment method must not be presented as a pending action');
assert.ok(realistic.indexOf('Validar cadastro e autorização')<realistic.indexOf('Rever o modo de lançamento'),
 'prioritize actionable merchant work before the platform global gate');
assert.ok(!realistic.includes("adminPerform("),'diagnostic stays read-only');
const grouped=sandbox.plan([{key:'global_commerce',owner:'admin',scope:'global',ok:false},
 {key:'online',owner:'merchant',scope:'realtime',ok:false},
 {key:'quote_authority',owner:'system',scope:'realtime',ok:false}]);
assert.equal(grouped.platform.length,1);
assert.equal(grouped.merchant.length,1);
assert.equal(grouped.system.length,1);
sandbox.adminRoleCanSection=()=>false;
assert.ok(!sandbox.card({merchant_id:merchantId,ready:false,checks:[
 {key:'merchant_status',ok:false,owner:'admin',scope:'merchant'}
]}).includes('Abrir validações desta revenda no Admin'),
 'readonly users without Partner permission must not see inaccessible actions');
const done=sandbox.card({merchant_name:'Revenda Exemplo',city:'São Gabriel',state:'RS',
  merchant_status:'active',ready:true,checks:[{key:'stock',label:'Estoque',ok:true}]});
assert.ok(done.includes('Apta para cotação'));
assert.ok(done.includes('Conforme'));
// A first merchant must be able to supply a REAL address without receiving
// automatic compliance, ANP, status, or payment approval.
const merchantPortal=read('js/merchant.js');
const ownerOps=read('supabase/functions/merchant-ops/index.ts');
const readOrders=read('supabase/functions/merchant-orders/index.ts');
const profileMigration=read('supabase/migrations/20261023222508_merchant_self_service_business_details.sql');
const bsc={esc};
const formPreludeStart=merchantPortal.indexOf('let merchantBusinessUnsavedDraft=null;');
const formPreludeEnd=merchantPortal.indexOf('function merchantBusinessProfileView(rt){',formPreludeStart);
assert.ok(formPreludeStart>=0&&formPreludeEnd>formPreludeStart,
 'business form requires the real owner-scoped in-memory draft helpers');
vm.runInNewContext(merchantPortal.slice(formPreludeStart,formPreludeEnd)+
 '\n'+cut(merchantPortal,'merchantBusinessProfileView')+
 ';this.profile=merchantBusinessProfileView;',bsc);
const escapedProfile=bsc.profile({merchant:{memberRole:'owner',status:'pending',
 businessDetails:{legalName:'Empresa <script>alert(1)</script>',
 city:'São Gabriel',state:'RS',postalCode:'97300000',addressText:'Rua de Teste'}},actionPending:false});
assert.ok(escapedProfile.includes('Empresa &lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(!escapedProfile.includes('<script>'));
assert.ok(escapedProfile.includes('merchantBusinessProfileSaveFromUi()'));
assert.equal(bsc.profile({merchant:{memberRole:'manager'},businessDetails:{}}),'',
 'manager must not view the owner identity form');
assert.equal(bsc.profile({merchant:{memberRole:'driver'},businessDetails:{}}),'',
 'driver must not view the owner identity form');
assert.ok(ownerOps.includes('if(action==="update-business-details")'));
assert.ok(ownerOps.includes('if(role!=="owner")'));
assert.ok(readOrders.includes('if(selected.member_role==="owner")'));
assert.ok(profileMigration.includes("if v_role<>'owner'"));
assert.ok(profileMigration.includes('MERCHANT_CONFIG_BASELINE_DRIFT_BLOCKED'));
assert.ok(profileMigration.includes('pendingAdministrativeVerification'));
assert.ok(!profileMigration.includes('UPDATE public.platform_launch_control'));
assert.ok(!profileMigration.includes("status='active'"));
assert.ok(merchantPortal.includes('O envio não aprova CNPJ'));

const guideCalls=[];
const guided={
 esc,merchantTimestampFresh:()=>false,
 merchantBusinessProfileFocus:()=>guideCalls.push('business'),
 go:key=>guideCalls.push('go:'+key),
 merchantRevealControl:selector=>{guideCalls.push('reveal:'+selector);return true;},
 toast:message=>guideCalls.push('toast:'+message)
};
vm.runInNewContext(cut(merchantPortal,'merchantSetupSnapshot')+
 '\n'+cut(merchantPortal,'merchantSetupView')+
 '\n'+cut(merchantPortal,'merchantSetupGo')+
 '\n'+cut(merchantPortal,'merchantFirstRunModel')+
 '\n'+cut(merchantPortal,'merchantFirstRunView')+
 ';this.snapshot=merchantSetupSnapshot;this.setup=merchantSetupView;this.goto=merchantSetupGo;this.first=merchantFirstRunView;',guided);
const incomplete={status:'ready',merchant:{memberRole:'owner',merchantId:merchantId,
 status:'pending',businessDetails:null,paymentMethods:{cash:true},acceptsCitywide:false},
 catalog:[],paymentRoutes:[]};
const firstSteps=guided.snapshot(incomplete);
assert.equal(firstSteps.length,4,'owner needs address as an actual first setup step');
assert.equal(firstSteps[0].key,'business');
assert.equal(firstSteps[0].done,false);
const freshGuide=guided.first(incomplete,false);
assert.ok(freshGuide.includes('0 de 4 configurados'));
assert.ok(freshGuide.includes("merchantSetupGo('business')"));
assert.ok(freshGuide.includes('Informe o endereço e os dados reais'));
assert.equal((freshGuide.match(/merchantBusinessProfileFocus/g)||[]).length,0,
 'do not duplicate the profile CTA outside the canonical setup step');
assert.ok(guided.setup(incomplete).includes('0 de 4 preenchidos'));
guided.goto('business');
assert.deepEqual(guideCalls,['business'],'address CTA reuses the existing protected owner form');
const declared={...incomplete,merchant:{...incomplete.merchant,businessDetails:{
 city:'São Gabriel',state:'RS',postalCode:'97300000',addressText:'Rua informada pelo proprietário'
}}};
const declaredSteps=guided.snapshot(declared);
assert.equal(declaredSteps[0].done,true);
assert.match(declaredSteps[0].detail,/aguardando conferência/);
assert.ok(guided.setup(declared).includes('1 de 4 preenchidos'));
assert.ok(!guided.setup(declared).includes('Aprovado pela ANP'),
 'self-declared business address cannot authorize regulated commerce');
const manager={...incomplete,merchant:{...incomplete.merchant,memberRole:'manager'}};
assert.equal(guided.snapshot(manager).length,3,
 'manager must not receive an action reserved for the permanent owner');
assert.ok(!guided.setup(manager).includes('Dados e endereço'));
assert.ok(guided.first(manager,false).includes('0 de 3 configurados'));
assert.ok(!guided.setup(manager).includes("merchantSetupGo('business')"));

const activeNoEdit={...incomplete,merchant:{...incomplete.merchant,status:'active'}};
assert.equal(guided.snapshot(activeNoEdit).length,3,'approved merchant must not be offered an impossible identity step');
assert.ok(!guided.setup(activeNoEdit).includes("merchantSetupGo('business')"));
assert.ok(!guided.first(activeNoEdit,false).includes("merchantSetupGo('business')"));
const blockedApproved=bsc.profile({merchant:{memberRole:'owner',status:'active',
 businessDetails:{legalName:'Empresa Legal',city:'São Gabriel'}}});
assert.ok(blockedApproved.includes('solicite revisão ao TAMÃO'));
assert.ok(!blockedApproved.includes('merchantBusinessProfileSaveFromUi()'));
assert.ok(ownerOps.includes('MERCHANT_BUSINESS_REVIEW_REQUIRED'));
const reviewGuard=read('supabase/migrations/20261023231017_merchant_business_review_after_activation.sql');
assert.ok(reviewGuard.includes("v_merchant.status<>'pending'"));
assert.ok(reviewGuard.includes('MERCHANT_BUSINESS_GUARD_BASELINE_DRIFT_BLOCKED'));

console.log('V1.157 passou: SQL restrito, equivalência operacional, sem ativação, painel XSS e status reais');
