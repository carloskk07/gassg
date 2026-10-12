import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const css=read('css/components.css');
new vm.Script(js,{filename:'js/admin.js'});
const pick=(src,name)=>{
 const start=src.indexOf('function '+name+'(');
 assert.ok(start>=0,'Missing '+name);
 const end=src.indexOf('\n}',start);
 assert.ok(end>start,name+' end');
 return src.slice(start,end+2);
};
const id=i=>String(i).padStart(8,'0')+'-1111-4111-8111-111111111111';
const lastDate='2026-10-12T14:00:00.123456+00:00';
const older='2026-10-11T10:00:00.000000+00:00';
const lastId=id(500);
const activeData=Array.from({length:500},(_,i)=>({
 id:id(i+1),order_id:id(i+10000),created_at:lastDate,
 status:'not_started',merchant_id:id(999)
}));
const rt={
 status:'ready',session:{user:{id:'test'}},
 data:{merchantPayments:{attempts:activeData,interruptedOrders:[],reviewSampleLimited:true}},
 salePaymentHistory:{attempts:[],interruptedOrders:[],nextCursor:null,hasMore:false,loading:false,error:null}
};
const evidence=[{
 id:id(600),order_id:id(601),merchant_id:id(999),provider:'mercadopago',
 created_at:older,updated_at:older,approved_at:older,status:'approved',amount_cents:11890
},{
 id:id(602),order_id:id(603),merchant_id:id(999),provider:'mercadopago',
 created_at:older,updated_at:older,status:'review_required',amount_cents:12000
}];
const interrupted=[
 {id:id(601),status:'CANCELLED',public_code:'TAM-601'},
 {id:id(603),status:'REASSIGNING',public_code:'TAM-603'}
];
let calls=0,renders=0,role='finance',shouldFail=false;
const response={readOnly:true,attempts:evidence,interruptedOrders:interrupted,
 hasMore:true,nextCursor:{createdAt:older,id:id(602)},batchSize:200};
const ui=vm.createContext({
 adminRuntime:rt,adminCurrentRole:()=>role,render:()=>{renders++},
 adminInvoke:async({action,cursor})=>{
  assert.equal(action,'sale-payment-history');
  assert.ok(
    cursor.createdAt===lastDate&&cursor.id===lastId
    ||cursor.createdAt===older&&cursor.id===id(602),
    'History cursor must come from latest sample or previous backend page'
  );
  calls++;
  if(shouldFail)throw new Error('NETWORK');
  return calls===1?response:{...response,attempts:[evidence[0]],hasMore:false,nextCursor:null,batchSize:1};
 }
});
vm.runInContext(
 pick(js,'adminInterruptedSalePaymentUrgency')+'\n'+
 pick(js,'adminInterruptedSalePaymentRows')+'\n'+
 'async '+pick(js,'adminLoadSalePaymentHistory')+
 ';this.load=adminLoadSalePaymentHistory;this.rows=adminInterruptedSalePaymentRows;',ui);
await ui.load();
assert.equal(calls,1);
assert.equal(rt.salePaymentHistory.attempts.length,2);
assert.equal(rt.salePaymentHistory.interruptedOrders.length,2);
assert.equal(rt.salePaymentHistory.hasMore,true);
assert.equal(ui.rows(rt.data).length,2,'Older cases included even though original 500 attempts had no cases');
assert.equal(renders,2);
await ui.load();
assert.equal(calls,2);
assert.equal(rt.salePaymentHistory.attempts.length,2,'Duplicate attempt cannot be counted twice');
assert.equal(rt.salePaymentHistory.hasMore,false);
await ui.load();
assert.equal(calls,2,'No extra request after exhausted');
rt.salePaymentHistory={attempts:[],interruptedOrders:[],nextCursor:null,hasMore:false,loading:false,error:null,started:true};
await ui.load();
assert.equal(calls,2,'Exhausted history stays exhausted even when that page contained no interrupted orders');
role='operations';
rt.salePaymentHistory={attempts:[],interruptedOrders:[],nextCursor:null,hasMore:false,loading:false,error:null};
await ui.load();
assert.equal(calls,2,'Operational role cannot read finance archive');
role='finance';
rt.data.merchantPayments.attempts=activeData.slice(0,150);
await ui.load();
assert.equal(calls,2,'Archive only starts when the default sample could be truncated');
rt.data.merchantPayments.attempts=activeData;
rt.salePaymentHistory={attempts:[],interruptedOrders:[],nextCursor:null,hasMore:false,loading:false,error:null};
shouldFail=true;
await ui.load();
assert.equal(calls,3);
assert.equal(rt.salePaymentHistory.loading,false);
assert.ok(rt.salePaymentHistory.error.includes('NETWORK'));
assert.equal(rt.salePaymentHistory.attempts.length,0);

const regex=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class DomainError extends Error{
 constructor(code,message,status){super(message);this.code=code;this.status=status;}
}
let attemptsQuery=null,ordersQuery=null,fetches=0;
const serverRows=Array.from({length:200},(_,i)=>({
 id:id(i+100),order_id:id(i+1000),created_at:older,status:'approved',
 merchant_id:id(999),amount_cents:10000,provider:'mercadopago'
}));
const serverOrders=[{id:id(1000),status:'CANCELLED',public_code:'TAM-1000'},
 {id:id(1001),status:'REASSIGNING',public_code:'TAM-1001'}];
const db={
 from(table){
  fetches++;
  const q={
   table,selectValue:null,orValue:null,orders:[],filters:[],
   select(value){this.selectValue=value;return this;},
   or(value){this.orValue=value;return this;},
   order(key,opt){this.orders.push([key,opt]);return this;},
   in(key,value){this.filters.push([key,value]);return this;},
   async limit(value){assert.ok(value<=200,'Bounded query');
    if(table==='merchant_sale_payment_attempts'){
      attemptsQuery=this;
      return {data:serverRows,error:null};
    }
    ordersQuery=this;return {data:serverOrders,error:null};
   }
  };
  return q;
 }
};
const api=vm.createContext({UUID_RE:regex,DomainError,Date,Set});
const historicalHandler=pick(edge,'financeSalePaymentHistory').replace(/:\s*(?:any|string)(?=[,)])/g,'');
vm.runInContext('async '+historicalHandler+
 ';this.history=financeSalePaymentHistory;',api);
const actual=await api.history(db,{cursor:{createdAt:lastDate,id:lastId}});
assert.equal(actual.readOnly,true);
assert.equal(actual.batchSize,200);
assert.equal(actual.hasMore,true);
assert.equal(actual.attempts.length,2,'Only payment attempts for interrupted orders leave privileged endpoint');
assert.equal(actual.interruptedOrders.length,2);
assert.equal(actual.nextCursor.createdAt,older);
assert.equal(actual.nextCursor.id,serverRows[199].id);
assert.ok(attemptsQuery.orValue.includes('created_at.lt.'+lastDate));
assert.ok(attemptsQuery.orValue.includes('id.lt.'+lastId));
assert.deepEqual(attemptsQuery.orders.map(x=>x[0]),['created_at','id']);
assert.ok(ordersQuery.filters.find(x=>x[0]==='status'));
assert.ok(!actual.attempts.some(x=>x.order_id===id(1100)),'Unmatched active order is not returned');
for(const cursor of [
 {createdAt:'1970-01-01T00:00:00Z',id:lastId},
 {createdAt:'2026-10-12T14:00:00Z,evil',id:lastId},
 {createdAt:lastDate,id:'not-a-uuid'},
 {},null
 ]){
  await assert.rejects(()=>api.history(db,{cursor}),e=>e.code==='INVALID_FINANCE_CURSOR');
}
assert.ok(edge.includes('if(action==="sale-payment-history")'));
assert.ok(edge.includes('["superadmin","finance","readonly"].includes(String(adminAccess.admin_role||""))'));
assert.ok(edge.includes('"sale-payment-history"'));
assert.ok(edge.includes('hasMore:found.length===pageSize'));
assert.ok(edge.includes('const eligible=new Set'));
assert.ok(js.includes('adminRuntime.salePaymentHistory={attempts:[],interruptedOrders:[],nextCursor:null,hasMore:false,loading:false,error:null,started:false};'),'Historical record purged on signout and access loss');
assert.ok(css.includes('.admin-sale-history-actions'));
assert.ok(css.includes('@media(max-width:560px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-history-v1-184.mjs'));
console.log('V1.184: keyset pagination, stable cursor, finance RBAC, cross-order privacy, dedup, exhaustion, network failure and logout cleanup passed.');
