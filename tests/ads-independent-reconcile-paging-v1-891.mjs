import {readAdsIndependentCheckoutSource} from './helpers/mercadopago-webhook-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectIndependentAdsPayment} from '../supabase/functions/_shared/ads-independent-payment-search.mjs';
const ref='tamao-ads-ind-'+'a'.repeat(32);
const item={id:123456789,external_reference:ref};
const search=(total,results,offset=0)=>({paging:{total,limit:10,offset},results});
assert.deepEqual(selectIndependentAdsPayment(search(0,[]),ref),{kind:'none'});
assert.deepEqual(selectIndependentAdsPayment(search(1,[item]),ref),{kind:'single',paymentId:'123456789'});
for(const p of [
 search(2,[item]), search(11,[item]),search(0,[item]),search(1,[]),
 search(1,[item],10),search(1,[{...item,id:'bad'}]),
 search(1,[{...item,external_reference:'foreign'}]),search(1,[item,item]),
 {results:[item]},{paging:{total:'1',offset:0},results:[item]},
 {paging:{total:1},results:[item]},null
 ])assert.deepEqual(selectIndependentAdsPayment(p,ref),{kind:'review'});
const edge=readAdsIndependentCheckoutSource();
assert.match(edge,/selectIndependentAdsPayment\(listing,reference\)/);
assert.match(edge,/if\(choice.kind==="review"\)/);
assert.match(edge,/if\(choice.kind==="none"\)/);
assert.match(edge,/const paymentId=choice.paymentId/);
assert.match(edge,/ADS_PAYMENT_PROVIDER_RECHECK_REQUIRED/);
console.log('V1.891 PASS: partial or ambiguous provider payment pages fail closed.');
