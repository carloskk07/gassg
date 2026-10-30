import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const edge=fs.readFileSync(new URL('../supabase/functions/customer-care/index.ts',import.meta.url),'utf8');
const start=edge.indexOf('    let timelineRecorded=false;');
const end=edge.indexOf('\n  }catch(error){',start);
assert.ok(start>0&&end>start,'support event post-commit response block must be present');
const code=edge.slice(start,end);
assert.match(code,/return json\(\{ok:true,case:created,timelineRecorded\},201,origin\)/);
assert.doesNotMatch(code,/\.from\("support_cases"\)/,
  'post-commit step must never create a second support case');

const savedCase={id:'test-support-case',order_id:'test-order',category:'delivery',status:'open'};
async function simulate(mode){
  let writes=0;const logs=[];
  const ctx=vm.createContext({
    admin:{
      from:table=>{
        assert.equal(table,'order_events');
        return {insert:async payload=>{
          writes++;
          assert.equal(payload.order_id,'test-order');
          assert.equal(payload.metadata.supportCaseId,savedCase.id);
          assert.equal(payload.event_type,'SUPPORT_CASE_OPENED');
          if(mode==='exception')throw new Error('PRIVATE_PROVIDER_INTERNAL');
          if(mode==='db-error')return {error:{message:'PRIVATE_DB_ERROR'}};
          return {error:null};
        }};
      }
    },
    order:{id:'test-order'},user:{id:'test-user'},created:savedCase,
    category:'delivery',origin:'https://tamao.com.br',
    console:{error:message=>logs.push(String(message))},
    json:(body,status,origin)=>({body,status,origin})
  });
  const result=await vm.runInContext('(async()=>{'+code+'})()',ctx);
  return {result,writes,logs};
}
for(const [mode,recorded] of [['ok',true],['db-error',false],['exception',false]]){
  const {result,writes,logs}=await simulate(mode);
  assert.equal(writes,1,'attempt just one optional event');
  assert.equal(result.status,201,'persisted support case must always be acknowledged');
  assert.equal(result.body.ok,true);
  assert.equal(result.body.case.id,savedCase.id);
  assert.equal(result.body.timelineRecorded,recorded);
  assert.equal(logs.length,recorded?0:1);
  assert.doesNotMatch(logs.join(' '),/PRIVATE|test-user|test-order|test-support-case/,
    'do not leak contact, order, identifiers or raw DB errors into logs');
}
assert.match(edge,/\.eq\("request_idempotency_key",idempotencyKey\)/);
assert.match(edge,/existing\.customer_id!==user\.id\|\|existing\.request_hash!==requestHash/);
assert.match(edge,/alreadyOpen:true/);
console.log('PASS: persisted support case returns 201 despite auxiliary event failures, without duplicate inserts or private logging.');
