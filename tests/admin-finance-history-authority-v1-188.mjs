import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
new vm.Script(admin,{filename:'js/admin.js'});
function cut(name){
  const start=admin.indexOf('function '+name+'(');
  assert.ok(start>0,'Missing '+name);
  const end=admin.indexOf('\n}',start);
  assert.ok(end>start,'Missing end '+name);
  return admin.slice(start,end+2);
}
const money=c=>'R$ '+(c/100).toFixed(2).replace('.',',');
const esc=s=>String(s??'').replaceAll('<','&lt;').replaceAll('&','&amp;');
let role='finance',renders=0,remoteCalls=0,resolveRemote;
let remote=()=>Promise.resolve(valid);
const rt={
  status:'ready',session:{id:'real-session'},section:'finance',
  data:{currentAdmin:{admin_role:'finance'}},
  financeHistory:{data:null,loading:false,error:null,checkedAt:null},
  lastSyncAt:new Date().toISOString()
};
const validKind={
  approvedCount:2,approvedCents:12000,linkedRefundCount:1,linkedRefundCents:2500,
  netAfterLinkedRefundsCents:9500,approved30dCents:5000,linkedRefund30dCents:500,
  net30dCents:4500
};
const valid={
  source:'database_complete',generatedAt:new Date().toISOString(),
  timezone:'America/Sao_Paulo',kindTotals:{
    package_purchase:{...validKind},
    statement_payment:{...validKind},
    refund_recovery:{...validKind}
  },
  unlinkedRefundCount:1,unlinkedRefundCents:999,unverifiableApprovedCount:0,
  monthly:Array.from({length:6},(_,i)=>({
    month:'2026-'+String(5+i).padStart(2,'0'),
    approvedCount:2,approvedCents:12000,linkedRefundCents:2500,
    netAfterLinkedRefundsCents:9500
  }))
};
const ctx=vm.createContext({
  Date,adminRuntime:rt,adminMoney:money,esc,formatDateTime:()=> '12/10/2026',
  adminRoleCanSection:section=>section==='finance'&&['finance','superadmin'].includes(role),
  adminCurrentRole:()=>role,render:()=>renders++,
  adminInvoke:async()=>{remoteCalls++;return remote();}
});
vm.runInContext(cut('adminFinanceHistoryIsFresh')+'\nasync '+cut('adminLoadFinanceHistory')
  +'\n'+cut('adminFinanceHistoryView')
  +';this.fresh=adminFinanceHistoryIsFresh;this.load=adminLoadFinanceHistory;this.view=adminFinanceHistoryView;',ctx);
assert.ok(ctx.view().includes('Ainda não há consulta histórica validada'));
await ctx.load();
assert.equal(remoteCalls,1);
assert.equal(rt.financeHistory.data.source,'database_complete');
assert.ok(ctx.fresh(rt.financeHistory));
let html=ctx.view();
for(const text of ['HISTÓRICO CONSOLIDADO','Taxas diárias D+1','últimos seis meses',
  'R$ 120,00','R$ 25,00','R$ 95,00','2026-10',
  'reembolso(s) não vinculado(s)','não substitui o extrato','Atualizar histórico']){
  assert.ok(html.toLowerCase().includes(text.toLowerCase()),'Missing readable financial truth: '+text);
}
assert.equal((html.match(/<tr>/g)||[]).length,7,'six months + table header');
assert.ok(!html.includes('Executar estorno'));
assert.ok(admin.includes("statement_payment:{count:0,cents:0}"),'Sample request kind must use authoritative enum');
assert.ok(!admin.includes("daily_statement:{count:0,cents:0}"));
assert.ok(admin.includes("if(next==='finance')adminLoadFinanceHistory().catch(()=>{});"));
assert.ok(admin.includes("if(adminRuntime.section==='finance')queueMicrotask(()=>adminLoadFinanceHistory().catch(()=>{}));"));
await ctx.load();
assert.equal(remoteCalls,1,'fresh cache avoids expensive DB scan on 15s admin polls');
await ctx.load({force:true});
assert.equal(remoteCalls,2,'manual revalidation available');
rt.financeHistory.checkedAt=new Date(Date.now()-11*60000).toISOString();
assert.equal(ctx.fresh(rt.financeHistory),false);
assert.ok(ctx.view().includes('Consulta desatualizada'));
await ctx.load();
assert.equal(remoteCalls,3,'old snapshot triggers new fetch');
remote=async()=>({source:'database_complete',generatedAt:new Date().toISOString(),monthly:[]});
await ctx.load({force:true});
assert.ok(rt.financeHistory.error.includes('formato inesperado'));
assert.ok(rt.financeHistory.data,'Failed refresh retains old snapshot with stale warning');
remote=async()=>valid;
role='operations';
await ctx.load({force:true});
assert.equal(remoteCalls,4,'unauthorized roles cannot call endpoint');
assert.equal(ctx.view(),'');
role='finance';
rt.status='unauthenticated';
await ctx.load({force:true});
assert.equal(remoteCalls,4,'signed-out admin cannot call endpoint');
rt.status='ready';
remote=()=>new Promise(resolve=>{resolveRemote=resolve;});
const pending=ctx.load({force:true});
assert.equal(rt.financeHistory.loading,true);
await ctx.load({force:true});
assert.equal(remoteCalls,5,'single flight blocks duplicate requests');
rt.session={id:'next-user'};
resolveRemote(valid);
await pending;
assert.equal(rt.financeHistory.data.source,'database_complete','old snapshot preserved until explicit session reset');
assert.equal(rt.financeHistory.loading,true,'old result cannot change state of new session');
const edge=read('supabase/functions/admin-ops/index.ts');
assert.ok(edge.includes('"finance-receipts-history"'));
assert.ok(edge.includes('admin.rpc("admin_finance_receipts_history_v1_188"'));
assert.ok(edge.includes('p_actor_user_id:user.id'));
assert.ok(edge.includes('["superadmin","finance"].includes(String(adminAccess.admin_role||""))'));
const sql=read('supabase/migrations/20261012191500_finance_authoritative_history_v1_188.sql');
assert.ok(sql.includes("security definer")&&sql.includes("set search_path = pg_catalog"));
assert.ok(sql.includes("revoke all on function public.admin_finance_receipts_history_v1_188(uuid) from public, anon, authenticated;"));
assert.ok(sql.includes("grant execute on function public.admin_finance_receipts_history_v1_188(uuid) to service_role;"));
assert.ok(sql.includes("'statement_payment'"));
assert.ok(sql.includes("'refund_recovery'"));
assert.ok(sql.includes("v_role not in ('superadmin','finance')"));
assert.ok(sql.includes('from public.merchant_billing_payment_requests'));
assert.ok(sql.includes('from public.merchant_billing_payment_refunds'));
assert.ok(read('css/components.css').includes('.admin-finance-history-scroll{overflow-x:auto'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-history-authority-v1-188.mjs'));
console.log('V1.188 finance history: strict role, full-db SQL, six months, cache, stale data, session race, no side effects passed.');
