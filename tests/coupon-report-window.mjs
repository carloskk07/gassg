import assert from 'node:assert/strict';
import {discoverInvoiceReleaseReports} from '../supabase/functions/coupon-net-auto/report-search.js';
const invoice={status:'paid',paid_at:'2026-11-10T15:46:34Z'};
const now=Date.parse('2026-11-14T02:00:00Z');
const report=id=>({id,status:'enabled',currency_id:'BRL',sub_type:'release',format:'CSV',
 file_name:'release-prod-'+id+'.csv'});
const requests=[];
const found=await discoverInvoiceReleaseReports(invoice,async path=>{
 const q=new URL('https://provider.invalid'+path).searchParams;requests.push(q);
 const offset=Number(q.get('offset'));
 return {paging:{total:2,offset},results:[report(offset+1)]};
},now);
assert.equal(found.complete,true);assert.equal(found.files.length,2);
assert.equal(requests.length,2);
for(const q of requests){
 assert.equal(q.get('range'),'date_created');
 assert.equal(q.get('range_begin_date'),'2026-11-09T15:46:34Z');
 assert.equal(q.get('range_end_date'),'2026-11-14T02:00:00Z');
 assert.equal(q.get('currency_id'),'BRL');
}
assert.equal((await discoverInvoiceReleaseReports(invoice,async()=>({paging:{total:51},results:[]}),now)).complete,false);
await assert.rejects(discoverInvoiceReleaseReports(invoice,async()=>({paging:{total:2,offset:0},results:[report(1)]}),now),/PAGE_INVALID|DUPLICATED/);
await assert.rejects(discoverInvoiceReleaseReports({...invoice,status:'prepared'},async()=>{throw Error('must not call provider')},now),/WINDOW_INVALID/);
console.log('PASS: invoice-scoped official report search, full paging, immutable date window and no historical-account cutoff for fresh receipts.');
