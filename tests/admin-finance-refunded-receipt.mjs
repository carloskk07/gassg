import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {evaluateFinanceHomologationEvidence} from '../supabase/functions/admin-ops/finance-homologation-evidence.js';

const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const start=source.indexOf('function adminFinanceRealState(){');
const end=source.indexOf('function adminFinanceHomologationView(d){',start);
assert(start>0&&end>start);
const actor='11000000-0000-4000-8000-000000000001';
const invoice='22000000-0000-4000-8000-000000000002';
const packageKey='all_products_3x5_sponsor';
function fixture(initial='refunded'){
 let status=initial,role='superadmin';const calls=[];
 const runtime={status:'ready',section:'finance',session:{user:{id:actor}}};
 const context=vm.createContext({adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
  adminCurrentRole:()=>role,adminFinanceWorkspaceCurrent:()=> 'homologation',
  adminFinanceHomologationEvidenceState:()=>({selected:'coupons'}),
  adminAccessToken:async()=> 'owner-session',
  CHAMA_BACKEND:{url:'https://isolated.invalid',publishableKey:'public-test'},
  chamaFetch:async(url,opts)=>{
   assert(url.endsWith('/coupon-credit-pix'));
   assert.equal(opts.headers.Authorization,'Bearer owner-session');
   const body=JSON.parse(opts.body);calls.push(body.action);
   let data;
   if(body.action==='my-vouchers')data={source:'clube_coupon_paid_my_vouchers_v1',
    purchases:[{invoiceId:invoice,packageKey,status,amountCents:890,
     paidAt:'2026-11-10T15:46:34Z',netReconciliationRecorded:true,
     refundStatus:status==='refunded'?'refunded':null}],vouchers:[]};
   else if(body.action==='catalog')data={source:'clube_paid_catalog_v1_807',couponSalesEnabled:true,
    packages:[{packageKey,title:'Pacote universal',priceCents:890,termsVersion:'clube_coupon_terms_v1_813'}]};
   else if(body.action==='invoice-status'){
    assert.equal(body.invoiceId,invoice);
    data={ok:true,invoiceId:invoice,status,amountCents:890,pixPayable:false};
   }else assert.fail('a completed receipt must not create a charge: '+body.action);
   return {ok:true,json:async()=>data};
  },document:{visibilityState:'visible',getElementById:()=>({checked:true})},
  render:()=>{},toast:()=>{},adminCopyText:()=>{},formatDateTime:()=> '10/11/2026 12:46',
  confirm:()=>true,crypto:{randomUUID:()=>actor},setTimeout:()=>1,clearTimeout:()=>{},
  Date,URL,Number,String,Array,Object,Promise,Math,Error,
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
 vm.runInContext(source.slice(start,end)+
  ';this.flow={refresh:adminFinanceRealRefresh,state:adminFinanceRealState,panel:adminFinanceRealPanel,action:adminFinanceRealAction};',context);
 return {runtime,calls,flow:context.flow,setStatus:value=>status=value,readonly:()=>role='readonly'};
}
{
 const f=fixture();await f.flow.refresh();
 let html=f.flow.panel('coupons');
 assert.match(html,/Estorno registrado no TAMÃO · R\$ 8,90/);
 assert.match(html,/Protocolo de devolução concluído/);
 assert.match(html,/cupons desta compra foram cancelados/);
 assert.match(html,/Conferir compra original/);
 assert.doesNotMatch(html,/Gerar checkout real deste pacote|Pix PAGO|Venda de cupons bloqueada|Pix copia e cola/);
 assert.deepEqual(f.calls,['my-vouchers','catalog'],'opening a completed receipt only reads owner history');
 await f.flow.action('purchase',packageKey);
 assert.deepEqual(f.calls,['my-vouchers','catalog'],'even a direct purchase call cannot repeat the same refunded homologation');
 await f.flow.action('check',invoice);
 assert.deepEqual(f.calls.slice(-2),['invoice-status','my-vouchers']);
 assert.equal(f.flow.state().data.history.purchases[0].status,'refunded');
 f.runtime.session.user.id='33000000-0000-4000-8000-000000000003';
 assert.doesNotMatch(f.flow.panel('coupons'),/R\$ 8,90|Protocolo de devolução concluído/,
  'another session must not inherit the original receipt');
}
{
 const f=fixture('paid');await f.flow.refresh();
 assert.match(f.flow.panel('coupons'),/Pix PAGO/);
 f.flow.state().payment={kind:'coupons',pix:'stale-code',amountCents:890};
 f.flow.state().paymentUntil=Date.now()+600000;
 f.setStatus('refunded');await f.flow.action('check',invoice);
 assert.equal(f.flow.state().payment,null,'terminal refund must erase a stale bank code');
 assert.equal(f.flow.state().data.history.purchases[0].status,'refunded',
  'checking the original invoice refreshes an already loaded paid history');
 assert.match(f.flow.panel('coupons'),/Estorno registrado no TAMÃO/);
 assert.doesNotMatch(f.flow.panel('coupons'),/Pix PAGO|Pix copia e cola/);
 f.readonly();const count=f.calls.length;
 await f.flow.action('check',invoice);assert.equal(f.calls.length,count);
}
const keys=['coupons','mobility','merchants','orders','advertising','benefits','professional_ads'];
const modules=keys.map(key=>({key,counts:key==='coupons'?{issuances:3}:key==='professional_ads'?{activeTerms:0}:{}}));
const signals={couponPaid:0,couponRefunded:1,couponNetVerified:0,mobilityPaid:0,
 merchantCompleted:0,orderApproved:0,adsApproved:0,adsPaymentApproved:0,
 referralBankEvidence:0,professionalBilledDays:0};
let diagnosis=evaluateFinanceHomologationEvidence(modules,signals,[])[0].diagnosis;
assert.equal(diagnosis.state,'provider_or_ledger_evidence');
assert.equal(diagnosis.recordedRefunds,1);
assert.match(diagnosis.progressLabel,/Devolução registrada/);
assert.match(diagnosis.nextAction,/ambiente isolado/);
assert.doesNotMatch(diagnosis.nextAction,/Testar compra real|Reutilizar os cupons já pagos/);
assert.equal(diagnosis.financiallyHomologated,false,'stored refund counts do not certify every bank flow');
assert.equal(diagnosis.bankSettlementChecked,false);
diagnosis=evaluateFinanceHomologationEvidence(modules,{...signals,couponPaid:1},[])[0].diagnosis;
assert.match(diagnosis.progressLabel,/Compras pagas e devoluções/);
assert.throws(()=>evaluateFinanceHomologationEvidence(modules,{...signals,couponRefunded:-1},[]),/INVALID_FINANCE_EVIDENCE/);
const edge=fs.readFileSync(new URL('../supabase/functions/admin-ops/index.ts',import.meta.url),'utf8');
assert.match(edge,/\["couponRefunded","clube_coupon_paid_invoices","status","refunded"\]/);
console.log('PASS: refunded purchase stays visible, original history refreshes, no repeat charge or stale Pix, isolated technical next step and owner isolation.');
