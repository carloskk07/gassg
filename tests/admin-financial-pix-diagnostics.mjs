import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin.js'),bootstrap=read('js/bootstrap.js');
const first=edge.indexOf('async function adminFinanceLabChargeDiagnostics(');
const last=edge.indexOf('async function adminFinanceLabReadiness(',first);
assert.ok(first>0&&last>first,'the server must provide charge diagnostics');
let code=edge.slice(first,last)
  .replaceAll(':any[]','').replaceAll(':any','').replace('const issues:string[]=[];','const issues=[];');
assert.doesNotMatch(code,/\.insert\(|\.update\(|\.delete\(|mercadoPagoFetch\(/,
  'financial diagnosis is read-only, with no provider calls');
const tables=[];
const db={
  from(name){
    tables.push(name);
    if(name==='merchant_billing_provider_charges')return {
      select:()=>({order:()=>({limit:async()=>({
        data:[
          {id:'charge-old',payment_request_id:'request-a',provider:'mercadopago',
            status:'expired',amount_cents:30000,currency:'BRL',
            br_code:'PRIVATE_BR_CODE_OLD',expires_at:'2026-10-16T17:44:54Z',
            created_at:'2026-10-15T17:44:52Z',completed_at:null,last_error_code:null},
          {id:'charge-new',payment_request_id:'request-b',provider:'mercadopago',
            status:'active',amount_cents:2000,currency:'BRL',
            br_code:'PRIVATE_BR_CODE_BROKEN',expires_at:'2099-01-01T00:00:00Z',
            created_at:'2026-10-18T17:44:52Z',completed_at:null,last_error_code:null}
        ],error:null
      })})})
    };
    if(name==='merchant_billing_payment_requests')return {
      select:()=>({in:()=>({limit:async()=>({data:[
        {id:'request-a',status:'pending',expected_amount_cents:30000,request_kind:'package_purchase'},
        {id:'request-b',status:'pending',expected_amount_cents:5000,request_kind:'package_purchase'}
      ],error:null})})})
    };
    throw new Error('Unexpected table: '+name);
  }
};
const context=vm.createContext({
  Date,Number,Set,String,Map,
  validatePixBrCode:(raw,{expectedAmountCents})=>
    raw==='PRIVATE_BR_CODE_OLD'&&expectedAmountCents===30000
      ?{valid:true,reason:null}:{valid:false,reason:'PIX_BR_CODE_CRC_INVALID'},
  DomainError:class DomainError extends Error{}
});
vm.runInContext(code+';this.diagnose=adminFinanceLabChargeDiagnostics',context);
const data=await context.diagnose(db);
assert.equal(data.ok,true);
assert.equal(data.readOnly,true);
assert.equal(data.count,2);
assert.deepEqual(tables,['merchant_billing_provider_charges','merchant_billing_payment_requests']);
const old=data.charges.find(c=>c.chargeId==='charge-old');
const broken=data.charges.find(c=>c.chargeId==='charge-new');
assert.equal(old.codeValid,true);
assert.equal(old.expired,true);
assert.equal(old.displayableInPortal,false);
assert.ok(old.issues.includes('PIX_EXPIRED'));
assert.equal(broken.codeValid,false);
assert.equal(broken.amountMatches,false);
assert.ok(broken.issues.includes('REQUEST_AMOUNT_MISMATCH'));
assert.equal(broken.displayableInPortal,false);
assert.ok(broken.issues.includes('PIX_BR_CODE_CRC_INVALID'));
assert.ok(!JSON.stringify(data).includes('PRIVATE_BR_CODE'),
 'sensitive codes must not be sent to the browser');
assert.ok(!JSON.stringify(data).includes('merchant_id'),
 'the diagnosis does not expose merchant identity');
const dispatch=edge.indexOf('if(action==="finance-lab-charge-diagnostics")');
assert.ok(dispatch>=0);
assert.match(edge.slice(dispatch,dispatch+420),/adminAccess.admin_role\)!=="superadmin"/);
assert.match(bootstrap,/adminFinanceLabDiagnoseChargesFromUi/);
assert.match(admin,/Diagnosticar cobranças PIX/);
assert.match(admin,/Código estruturalmente válido não confirma/);
assert.match(edge,/displayableInPortal/);
const start=admin.indexOf('async function adminFinanceLabDiagnoseChargesFromUi(');
const end=admin.indexOf('async function adminFinanceLabReadinessFromUi(',start);
assert.ok(start>0&&end>start);
let calls=0;
const rt={financeLab:{charges:null,chargesLoading:false,chargesError:null}};
const uiCtx=vm.createContext({
  adminRuntime:rt,adminReady:()=>true,adminCurrentRole:()=> 'superadmin',
  adminInvoke:async payload=>{calls++;assert.equal(payload.action,'finance-lab-charge-diagnostics');return data;},
  render:()=>{},String
});
vm.runInContext(admin.slice(start,end)+';this.refresh=adminFinanceLabDiagnoseChargesFromUi',uiCtx);
await uiCtx.refresh();
assert.equal(calls,1);
assert.equal(rt.financeLab.charges.count,2);
assert.equal(rt.financeLab.chargesLoading,false);
console.log('PASS: admin PIX diagnosis, expiration, CRC failure, amount mismatch, no sensitive code');
