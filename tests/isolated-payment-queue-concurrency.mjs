import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.CI,'true');
assert.equal(process.env.TAMAO_DISPOSABLE_QUEUE_RACE,'1');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const env={...process.env,PGPASSWORD:'postgres',PGHOSTADDR:'127.0.0.1',PGCONNECT_TIMEOUT:'10',PGSSLMODE:'disable',PGSERVICE:'',PGSERVICEFILE:''};
const args=q=>['--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+q];
const sql=q=>execFileSync('psql',args(q),{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
const asyncExec=promisify(execFile);
const asyncSql=async q=>(await asyncExec('psql',args(q),{env,encoding:'utf8',timeout:30000})).stdout.trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const kinds=['billing','coupon','mobility','advertising','merchant_sale','ads_credit'];
const rows=Array.from({length:24},(_,i)=>({kind:kinds[i%6],id:randomUUID()}));
const ids=rows.map(r=>quote(r.id)+'::uuid').join(',');
const fixtureKeys=new Set(rows.map(r=>r.kind+':'+r.id));
assert.equal(sql("select enabled from public.platform_payment_reconciliation_config where id"),'f','isolated queue must start disabled');
assert.equal(sql("select active from cron.job where jobname='tamao-payment-reconciliation'"),'f','scheduler must stay disabled');
try{
  sql("begin; update public.platform_payment_reconciliation_config set enabled=true where id; insert into public.platform_payment_reconciliation_queue(kind,resource_id,next_check_at) values "+rows.map(r=>"("+quote(r.kind)+","+quote(r.id)+"::uuid,'1900-01-01'::timestamptz)").join(',')+"; commit;");
  const batches=await Promise.all(Array.from({length:4},()=>asyncSql("begin; set local statement_timeout='15s'; select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.platform_payment_reconciliation_claim(6) c; do $$ begin perform pg_sleep(0.25); end $$; commit;").then(JSON.parse)));
  for(const b of batches) assert.equal(b.length,6,'each worker must claim its bounded batch');
  const claims=batches.flat();
  assert.equal(new Set(claims.map(c=>c.kind+':'+c.resource_id)).size,24,'overlapping leases are forbidden');
  for(const c of claims){assert.ok(fixtureKeys.has(c.kind+':'+c.resource_id),'only synthetic jobs may be claimed');assert.match(c.lease_token,/^[0-9a-f-]{36}$/i);}
  assert.equal(sql("select count(*) from public.platform_payment_reconciliation_queue where resource_id in ("+ids+") and lease_token is not null"),'24');
  const c=claims[0];
  const finish=(token,outcome,reason,status)=>"select public.platform_payment_reconciliation_finish("+[quote(c.kind),quote(c.resource_id)+'::uuid',quote(token)+'::uuid',quote(outcome),quote(reason),status===null?'null':quote(status)].join(',')+");";
  assert.equal(sql(finish(randomUUID(),'verified','SYNTHETIC_PROOF','paid')),'f','unowned lease must be refused');
  const results=await Promise.all(Array.from({length:4},()=>asyncSql(finish(c.lease_token,'verified','SYNTHETIC_PROOF','paid'))));
  assert.equal(results.filter(r=>r==='t').length,1,'only one completion may succeed');
  assert.equal(results.filter(r=>r==='f').length,3,'duplicate completions must be refused');
  assert.equal(sql(finish(c.lease_token,'retry','LATE_REPLY',null)),'f','late response must not override final state');
  assert.equal(sql("select last_outcome from public.platform_payment_reconciliation_queue where kind="+quote(c.kind)+" and resource_id="+quote(c.resource_id)+"::uuid"),'verified');
  console.log('PASS: four workers, 24 disjoint leases, one completion, three duplicate refusals, late reply refused; no PSP calls.');
}finally{
  sql("begin; delete from public.platform_payment_reconciliation_queue where resource_id in ("+ids+"); update public.platform_payment_reconciliation_config set enabled=false where id; commit;");
}
assert.equal(sql("select enabled from public.platform_payment_reconciliation_config where id"),'f');
assert.equal(sql("select count(*) from public.platform_payment_reconciliation_queue where resource_id in ("+ids+")"),'0');
