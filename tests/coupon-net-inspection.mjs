import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseReleasedMoneyCsv} from '../supabase/functions/admin-ops/coupon-release-evidence.js';
const worker=fs.readFileSync(new URL('../supabase/functions/coupon-net-auto/index.ts',import.meta.url),'utf8');
const start=worker.indexOf('// Private read-only diagnostics');
const end=worker.indexOf('const {data:invoices',start);
assert(start>worker.indexOf('if(authError||authorized!==true)'));
const invoice={id:'11111111-1111-4111-8111-111111111111',provider_order_id:'ORD123456789',
 provider_payment_id:'PAY123456789',status:'paid'};
const header='DATE,SOURCE_ID,EXTERNAL_REFERENCE,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT';
const csv=header+'\n2026-11-10T15:46:34Z,987654321,'+invoice.id+',release,payment,8.81,0.00,8.90\n';
let writes=0;
const query={select(){return this},eq(){return this},is(){return this},order(){return this},
 limit:async()=>({data:[invoice],error:null})};
const legacy={external_reference:invoice.id,collector_id:12345678,order:{id:invoice.provider_order_id},
 payment_method_id:'pix',status:'approved',money_release_status:'released',
 transaction_amount:8.9,transaction_details:{net_received_amount:8.81}};
const context=vm.createContext({
 req:{headers:{get:name=>name==='X-Tamao-Coupon-Inspect'?'true':null}},client:{from:()=>query,rpc:()=>{writes++;throw Error('no mutation permitted')}},
 mpToken:'LOCAL-ONLY-NO-TOKEN',json:body=>body,parseReleasedMoneyCsv,
 discoverReleaseReports:async()=>({complete:true,files:['release-prod-test.csv']}),
 getProviderData:async()=>({order:{user_id:12345678,transactions:{payments:[{id:invoice.provider_payment_id}]}},
 reportCsv:[{fileName:'release-prod-test.csv',csv}],legacyPayments:[legacy]}),
 evaluateReports:({invoice:found,legacyPayments})=>{assert.equal(found.id,invoice.id);assert.equal(legacyPayments.length,1);return {status:'verified_candidate',reason:'MATCHED_REPORT',accepted:{netCents:881}}},
 mercadoPagoFetch:async(path,options)=>{assert.equal(options.method,'GET');assert.match(path,/^\/v1\/payments\//);return {ok:true}},
 readMercadoPagoJson:async()=>legacy,encodeURIComponent
});
const result=await vm.runInContext('(async()=>{'+worker.slice(start,end).replace(/:(any|string\[\]|string|number)/g,'')+'})()',context);
assert.equal(result.readOnly,true);assert.equal(result.checked,1);assert.equal(writes,0);
assert.equal(result.eligible,true);assert.equal(result.netCents,881);assert.equal(result.legacyCandidates,1);
assert(!JSON.stringify(result).includes(invoice.id));assert(!JSON.stringify(result).includes('987654321'));
let verified=0,observed=0;
context.req.headers.get=name=>name==='X-Tamao-Coupon-Recheck'?'true':null;
context.reconcileOne=async(_client,token,serverInvoice,files)=>{
 assert.equal(token,'LOCAL-ONLY-NO-TOKEN');assert.equal(serverInvoice.id,invoice.id);
 assert.equal(files[0],'release-prod-test.csv');verified++;
 return {status:'net_verified',reason:'PROVIDER_CSV_ATOMICALLY_REGISTERED'};
};
context.recordObservation=async(_client,id,status)=>{assert.equal(id,invoice.id);assert.equal(status,'net_verified');observed++};
const rechecked=await vm.runInContext('(async()=>{'+worker.slice(start,end).replace(/:(any|string\[\]|string|number)/g,'')+'})()',context);
assert.equal(rechecked.registered,1);assert.equal(verified,1);assert.equal(observed,1);
assert.equal(rechecked.newChargesCreated,0);assert.equal(writes,0);
console.log('PASS: authenticated receipt inspection performs only reads and returns binding booleans without transaction IDs.');
