import assert from 'node:assert/strict';
import fs from 'node:fs';
import {returnWalletRefs,withWalletEvidence} from './refund-wallet-fixture-v1-871.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const src=read('supabase/functions/admin-ops/coupon-refund-merchant-history.js');
const {couponRefundMerchantHistorySummary:reconcile}=await import(
 'data:text/javascript;base64,'+Buffer.from(src).toString('base64'));

const id={
 invoice:'66666666-6666-4666-8666-666666666666',
 customer:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 order:'11111111-1111-4111-8111-111111111111',
 voucher:'22222222-2222-4222-8222-222222222222',
 merchant:'33333333-3333-4333-8333-333333333333',
 stranger:'99999999-9999-4999-8999-999999999999'
};
const ret={
 invoice_id:id.invoice,customer_id:id.customer,order_id:id.order,
 voucher_id:id.voucher,amount_cents:500,
 disposition:'reissued',cause:'order_cancelled',
 ...returnWalletRefs(id.order),recorded_at:'2026-11-06T10:01:00Z'
};
const sample={
 invoiceId:id.invoice,customerId:id.customer,fundingMode:'partner_funded',
 couponFaceCents:500,couponsPerPack:3,
 issuances:[{id:id.voucher,invoice_id:id.invoice,
  customer_user_id:id.customer,face_cents:500,ordinal:1}],issuanceCount:1,
 applications:[{invoice_id:id.invoice,customer_user_id:id.customer,
  order_id:id.order,voucher_id:id.voucher,quoted_merchant_id:id.merchant,
  face_cents:500,original_order_total_cents:9500,
  original_order_cashback_cents:500,applied_at:'2026-11-06T10:00:00Z'}],
 applicationCount:1,
 partnerUses:[{invoice_id:id.invoice,customer_id:id.customer,
  order_id:id.order,voucher_id:id.voucher,merchant_id:id.merchant,
  face_cents:500,gross_cents:10000,net_cents:9500,
  fee_bps_snapshot:900,created_at:'2026-11-06T10:00:01Z'}],
 partnerUseCount:1,
 returns:[ret],returnCount:1,
 orders:[{id:id.order,customer_id:id.customer,merchant_id:id.merchant,
  status:'CANCELLED',financial_state:'reversed',risk_reason:'buyer_cancelled',
  financial_reversed_at:null}]
};
const valid=withWalletEvidence(sample);
const result=reconcile(valid);
assert.equal(result.walletReturnNeutralized,true);
assert.equal(result.walletReturnPairCount,1);
assert.equal(result.walletReturnNetCents,0);
assert.equal(result.entries[0].walletReturnNeutralized,true);
assert.equal(result.historicalDiscountCents,500);
for(const f of ['merchantPayoutVerified','bankCreditVerified',
                  'refundClosureAuthorized','caseClosed','moneyMoved'])
 assert.equal(result[f],false,'internal wallet facts are not external settlement');

const bad=(x,label)=>assert.throws(()=>reconcile(x),
 /COUPON_REFUND_HISTORY_/,label);
bad({...valid,walletEntries:valid.walletEntries.slice(0,1),walletEntryCount:1},
 'a missing compensating wallet reserve must fail');
bad({...valid,walletEntryCount:1},'exact count mismatch must fail');
bad({...valid,walletEntryCount:null},'null count fails');
bad({...valid,walletEntries:[valid.walletEntries[0],valid.walletEntries[0]]},
 'duplicate wallet record cannot be reused');
bad({...valid,walletEntries:[]},'a return without wallet proof cannot pass');
const mutate=(index,fields)=>({...valid,walletEntries:valid.walletEntries.map((row,i)=>
 i===index?{...row,...fields}:row)});
bad(mutate(0,{user_id:id.stranger}),'wrong buyer release');
bad(mutate(1,{user_id:id.stranger}),'wrong buyer hold');
bad(mutate(0,{order_id:id.stranger}),'wrong order release');
bad(mutate(1,{order_id:id.stranger}),'wrong order hold');
bad(mutate(0,{bucket:'credit'}),'wrong wallet bucket');
bad(mutate(0,{entry_type:'cashback_seed'}),'not a release');
bad(mutate(1,{entry_type:'cashback_release'}),'not a reserve');
bad(mutate(0,{amount_cents:501}),'wrong release amount');
bad(mutate(1,{amount_cents:-499}),'reserve must fully neutralize cashback');
bad(mutate(1,{idempotency_key:'other-order'}),'reserve must match the order');
bad(mutate(0,{metadata:{reason:'someone_else'}}),'cancel reason mismatch');
bad(mutate(0,{idempotency_key:'new-without-cashback-release'}),'wrong suffix');
bad(mutate(1,{metadata:{...valid.walletEntries[1].metadata,
 source:'ordinary_cashback'}}),'quarantine source is missing');
bad(mutate(1,{metadata:{...valid.walletEntries[1].metadata,
 voucherId:id.stranger}}),'quarantine voucher mismatch');
bad(mutate(1,{metadata:{...valid.walletEntries[1].metadata,
 releaseWalletEntryId:id.stranger}}),'unrelated release link');
bad(mutate(1,{metadata:{...valid.walletEntries[1].metadata,
 cause:'post_settlement_financial_reversal'}}),'wrong return cause');
bad(mutate(1,{created_at:'2026-11-06T09:59:00Z'}),
 'hold cannot predate release');
bad(mutate(1,{created_at:'2026-11-06T10:01:01Z'}),
 'hold after durable return event');
bad(mutate(0,{created_at:'not-a-date'}),'missing release date');
bad({...valid,returns:[{...ret,wallet_hold_entry_id:ret.wallet_release_entry_id}]},
 'release and hold must never share the same ID');

const unreturned=withWalletEvidence({...sample,returns:[],returnCount:0,
 orders:[{...sample.orders[0],status:'SETTLED',financial_state:'settled',
   risk_reason:null,financial_reversed_at:null}]});
const plain=reconcile(unreturned);
assert.equal(plain.walletReturnPairCount,0);
assert.equal(plain.walletReturnNetCents,0);
assert.equal(plain.entries[0].walletReturnNeutralized,false);
bad({...unreturned,walletEntries:valid.walletEntries,walletEntryCount:2},
 'unrelated wallet facts cannot make a return appear');

const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const finish=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>0&&finish>start);
const action=edge.slice(start,finish);
for(const fragment of ['wallet_release_entry_id','wallet_hold_entry_id',
 'wallet_entries','walletEntryCount',
 'JSON.stringify(first)!==JSON.stringify(second)',
 '.limit(51)','new Set(walletIds).size!==walletIds.length'])
 assert.ok(action.includes(fragment),'bounded wallet evidence required: '+fragment);
assert.doesNotMatch(action,/\.update\(|\.insert\(|method:"POST"|mercadoPagoFetch/,
 'read-only wallet audit may not mutate or call money provider');

const ui=read('js/admin.js');
for(const fragment of ['walletReturnNeutralized','walletReturnPairCount',
 'walletReturnNetCents','Essa conferência interna não comprova crédito bancário'])
 assert.ok(ui.includes(fragment),'frontend must reject unsupported wallet claims: '+fragment);
console.log('PASS #871: exactly paired buyer/order cashback release+hold with provenance, no bank proof or financial write');
