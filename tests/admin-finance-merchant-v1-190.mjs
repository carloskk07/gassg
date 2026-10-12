import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
function cut(name){
  const a=source.indexOf('function '+name+'(');
  assert.ok(a>0,'Missing '+name);
  const b=source.indexOf('\n}',a);
  assert.ok(b>a,'No close '+name);
  return source.slice(a,b+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const money=c=>'R$ '+(c/100).toFixed(2).replace('.',',');
const merchant={
  merchantId:'11111111-1111-4111-8111-111111111111',
  merchantName:"Revenda <B> &' Leste",merchantStatus:'active',
  city:'São Gabriel',state:'RS',planKey:'flex_daily',salesHold:true,
  creditBalanceCents:50000,creditReservedCents:7000,
  recordedFees30dCents:17000,openReceivablesCents:1200,
  openStatementCount:3,openStatementCents:9000,
  overdueStatementCount:2,overdueStatementCents:3000,
  approvedPaymentCount:4,approvedDailyCents:5000,
  approvedPackagesCents:20000,approvedRecoveriesCents:1000,
  pendingPaymentCount:1,pendingPaymentCents:9000,
  unverifiableApprovedCount:0,linkedRefundCount:1,linkedRefundCents:300
};
const data={source:'database_complete_per_merchant',generatedAt:new Date().toISOString(),
  totalMerchants:1,rowLimit:200,rows:[merchant]};
const empty={...data,totalMerchants:0,rows:[]};
let role='finance',calls=0,remote=async()=>data,resolveRemote;
const rt={status:'ready',session:{id:1},section:'finance',
  merchantFinance:{data:null,loading:false,error:null,checkedAt:null}};
const items=[{dataset:{search:'revenda são gabriel rs'},hidden:false},
  {dataset:{search:'outra loja porto alegre rs'},hidden:false}];
const label={textContent:''},noMatch={hidden:true};
const document={
  querySelectorAll:()=>items,
  getElementById:id=>id==='admin-merchant-finance-visible'?label:noMatch
};
const ctx=vm.createContext({
  adminRuntime:rt,Date,adminMoney:money,esc,formatDateTime:()=> '12/10/2026',
  adminCurrentRole:()=>role,
  adminRoleCanSection:s=>s==='finance'&&['superadmin','finance'].includes(role),
  adminInvoke:async()=>{calls++;return remote();},
  render:()=>{},document
});
const names=['adminMerchantFinanceIsFresh','adminMerchantFinanceValidate',
 'adminLoadMerchantFinance','adminMerchantFinanceFilter','adminMerchantFinanceView'];
vm.runInContext(names.map(n=>(n==='adminLoadMerchantFinance'?'async ':'')+cut(n)).join('\n')+
  ';this.fresh=adminMerchantFinanceIsFresh;this.validate=adminMerchantFinanceValidate;this.load=adminLoadMerchantFinance;this.filter=adminMerchantFinanceFilter;this.view=adminMerchantFinanceView;',ctx);
assert.equal(ctx.validate(data),true);
assert.equal(ctx.validate(empty),true);
await ctx.load();
assert.equal(calls,1);
assert.ok(ctx.fresh(rt.merchantFinance));
const html=ctx.view();
for(const label of ['CONTROLADORIA POR REVENDA','São Gabriel / RS','D+1 em aberto',
  'D+1 vencido','Taxas registradas','Crédito pré-pago','R$ 170,00','R$ 90,00',
  'R$ 30,00','R$ 500,00','Pacotes aprovados','não é extrato bancário']){
  assert.ok(html.toLowerCase().includes(label.toLowerCase()),'Missing '+label);
}
assert.ok(html.includes('Revenda &lt;B&gt; &amp;&#39; Leste'));
assert.ok(!html.includes('Revenda <B>'));
assert.ok(!html.includes('onclick="adminFinancial'),'View must be read-only');
assert.ok(html.includes('1 com alerta de atraso ou bloqueio'));
await ctx.load();
assert.equal(calls,1,'10-minute cache prevents repeated full database query');
await ctx.load({force:true});
assert.equal(calls,2);
rt.merchantFinance.checkedAt=new Date(Date.now()-11*60000).toISOString();
assert.equal(ctx.fresh(rt.merchantFinance),false);
assert.ok(ctx.view().includes('desatualizado'));
remote=async()=>({source:'browser_sample'});
await ctx.load({force:true});
assert.ok(rt.merchantFinance.error.includes('inconsistentes'));
assert.ok(rt.merchantFinance.data,'Keep prior data with error');
remote=async()=>empty;
await ctx.load({force:true});
assert.ok(ctx.view().includes('Nenhuma revenda cadastrada'));
remote=async()=>data;
const invalid=[null,{...data,source:'recent_list'},{...data,rowLimit:300},
  {...data,totalMerchants:0},{...data,generatedAt:'invalid'},
  {...data,rows:[{...merchant,creditReservedCents:60000}]},
  {...data,rows:[{...merchant,overdueStatementCents:9001}]},
  {...data,rows:[{...merchant,overdueStatementCount:4}]},
  {...data,rows:[{...merchant,approvedDailyCents:-1}]},
  {...data,rows:[{...merchant,pendingPaymentCents:'9000'}]},
  {...data,rows:[{...merchant,merchantId:'not-a-uuid'}]},
  {...data,totalMerchants:2,rows:[merchant,merchant]},
  {...data,rows:[{...merchant,merchantName:null}]}];
for(const v of invalid)assert.equal(ctx.validate(v),false);
ctx.filter(' SÃO Gabriel ');
assert.equal(items[0].hidden,false);
assert.equal(items[1].hidden,true);
assert.equal(label.textContent,'1');
ctx.filter('inexistente');
assert.equal(noMatch.hidden,false);
ctx.filter('');
assert.equal(noMatch.hidden,true);
role='readonly';
await ctx.load({force:true});
assert.equal(calls,4);
assert.equal(ctx.view(),'');
role='operations';
assert.equal(ctx.view(),'');
role='superadmin';
await ctx.load({force:true});
assert.equal(calls,5);
rt.status='unauthenticated';
await ctx.load({force:true});
assert.equal(calls,5);
rt.status='ready';
remote=()=>new Promise(resolve=>resolveRemote=resolve);
const pending=ctx.load({force:true});
await ctx.load({force:true});
assert.equal(calls,6,'Single flight');
rt.session={id:2};
resolveRemote(data);
await pending;
assert.equal(rt.merchantFinance.loading,true,'Old session reply discarded');
const many={...data,totalMerchants:250,rows:Array.from({length:200},(_,i)=>({
  ...merchant,merchantId:String(i).padStart(8,'0')+'-1111-4111-8111-111111111111'
}))};
assert.equal(ctx.validate(many),true);
rt.merchantFinance={data:many,loading:false,error:null,checkedAt:new Date().toISOString()};
assert.ok(ctx.view().includes('Exibição limitada às 200 revendas'));
const edge=read('supabase/functions/admin-finance-merchant/index.ts');
assert.ok(edge.includes('admin.rpc("admin_finance_merchant_performance_v1_190"'));
assert.ok(edge.includes('p_actor_user_id:auth.user.id'));
assert.ok(edge.includes('auth.getUser(token)'));
assert.ok(edge.includes('auth.user.is_anonymous===true'));
assert.ok(edge.includes('platform_admins'));
assert.ok(edge.includes('["superadmin","finance"].includes(access.admin_role)'));
assert.ok(edge.includes('enforceApiQuota'));
assert.ok(edge.includes('"Cache-Control":"no-store"'));
assert.ok(edge.includes('originAllowed(origin)'));
assert.ok(edge.includes('Deno.serve'));
assert.ok(source.includes("body?.action==='finance-merchant-performance'?'admin-finance-merchant':'admin-ops'"));
assert.ok(!read('supabase/functions/admin-ops/index.ts').includes('admin_finance_merchant_performance_v1_190'));
const sql=read('supabase/migrations/20261012193939_finance_merchant_performance_v1_190.sql');
assert.ok(sql.includes('SECURITY DEFINER'));
assert.ok(sql.includes('platform_admin_role'));
for(const t of ['merchant_billing_payment_requests','platform_receivables',
  'merchant_billing_accounts','merchant_billing_payment_refunds','merchant_daily_statements']){
  assert.ok(sql.includes(t),'Missing authoritative table '+t);
}
assert.ok(sql.includes('revoke all on function public.admin_finance_merchant_performance_v1_190(uuid)'));
assert.ok(sql.includes('to service_role'));
assert.ok(sql.toLowerCase().includes('limit 200'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-merchant-finance-list'));
assert.ok(css.includes('@media(max-width:360px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-merchant-v1-190.mjs'));
console.log('V1.190: isolation, no artificial amounts, finance-only RBAC, source and numeric gates, cache, session race, mobile styles.');
