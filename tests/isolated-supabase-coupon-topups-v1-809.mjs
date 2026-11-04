import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const args=sql=>[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+sql
];
const env={...process.env,PGPASSWORD:'postgres'};
const sql=q=>execFileSync('psql',args(q),{env,encoding:'utf8',timeout:60000,
 stdio:['ignore','pipe','pipe']}).trim();
const asSql=promisify(execFile);
const sqlAsync=q=>asSql('psql',args(q),{env,encoding:'utf8',timeout:60000});
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const refused=(cmd,err)=>{
 let failure;
 try{sql(cmd);}catch(e){failure=e;}
 assert.ok(failure,'Expected blocked operation: '+err);
 assert.match(String(failure.stderr||failure.message),new RegExp(err));
};
const admin=sql("SELECT user_id FROM public.platform_admins WHERE active=true AND admin_role='superadmin' AND user_id IN (SELECT id FROM auth.users WHERE email LIKE 'tamao-admin-%@example.com') LIMIT 1;");
assert.match(admin,/^[0-9a-f-]{36}$/i);
const state=()=>sql("SELECT authorized_cents||':'||owner_guaranteed_cents||':'||reconciled_cents||':'||encumbered_cents||':'||version FROM public.platform_clube_sponsor_pool_v1_807 WHERE benefit_key='clube_coupons';").split(':').map(Number);
const call=(actor,cents,id,expected)=>"SELECT public.admin_clube_sponsor_topup_v1_809("+
 q(actor)+"::uuid,"+cents+","+q(id)+"::uuid,"+expected+")::text;";
const initial=state();
assert.equal(initial[0],10000);
assert.equal(initial[1],10000);
assert.equal(initial[2],0);
assert.equal(initial[3],10000);
const issued=sql("SELECT count(*) FROM public.clube_coupon_paid_issuances;");
const invoice=sql("SELECT count(*) FROM public.clube_coupon_paid_invoices;");
const bank=sql("SELECT count(*) FROM public.platform_clube_sponsor_receipts_v1_807;");
const request=randomUUID(),cents=12534;
const one=JSON.parse(sql(call(admin,cents,request,initial[4])));
assert.equal(one.ok,true);
assert.equal(one.replayed,false);
assert.equal(one.creditedCents,cents);
assert.equal(one.bankDeposit,false);
assert.equal(one.vouchersIssued,0);
assert.equal(one.authorizedCents,22534);
assert.equal(one.ownerGuaranteedCents,22534);
assert.equal(one.encumberedCents,10000);
assert.equal(one.remainingCents,12534);
assert.equal(one.version,initial[4]+1);
assert.deepEqual(state(),[22534,22534,0,10000,initial[4]+1]);
const replay=JSON.parse(sql(call(admin,cents,request,initial[4])));
assert.equal(replay.replayed,true,'same request must never charge twice');
assert.deepEqual(state(),[22534,22534,0,10000,initial[4]+1]);
refused(call(admin,20000,request,initial[4]),'COUPON_OWNER_TOPUP_REPLAY_CONFLICT');
refused(call(randomUUID(),100,randomUUID(),initial[4]+1),'COUPON_OWNER_TOPUP_SUPERADMIN_REQUIRED');
refused(call(admin,99,randomUUID(),initial[4]+1),'COUPON_OWNER_TOPUP_INVALID');
refused(call(admin,1000001,randomUUID(),initial[4]+1),'COUPON_OWNER_TOPUP_INVALID');
refused(call(admin,100,randomUUID(),initial[4]),'COUPON_OWNER_TOPUP_STALE_VERSION');
assert.equal(sql("SELECT count(*) FROM public.platform_clube_sponsor_topups_v1_809"),'1');
assert.equal(sql("SELECT count(*) FROM public.platform_admin_audit WHERE action='clube_coupon_owner_guarantee_topup'"),'1');
assert.equal(sql("SELECT count(*) FROM public.clube_coupon_paid_issuances;"),issued,'no fabricated vouchers');
assert.equal(sql("SELECT count(*) FROM public.clube_coupon_paid_invoices;"),invoice,'no sale or PSP transaction');
assert.equal(sql("SELECT count(*) FROM public.platform_clube_sponsor_receipts_v1_807;"),bank,'no fake bank deposit');
// Two parallel admin tabs compete for same optimistic version: only one wins.
const current=state();
const contenders=await Promise.allSettled([
 sqlAsync(call(admin,5000,randomUUID(),current[4])),
 sqlAsync(call(admin,5000,randomUUID(),current[4]))
]);
const won=contenders.filter(x=>x.status==='fulfilled'),lost=contenders.filter(x=>x.status==='rejected');
assert.equal(won.length,1,'concurrent confirmations must not both succeed');
assert.equal(lost.length,1);
assert.match(String(lost[0].reason.stderr||lost[0].reason.message),/COUPON_OWNER_TOPUP_STALE_VERSION/);
const after=state();
assert.equal(after[0],current[0]+5000);
assert.equal(after[1],current[1]+5000);
assert.equal(after[2],0);
assert.equal(after[3],10000);
assert.equal(after[4],current[4]+1);
assert.equal(sql("SELECT count(*) FROM public.platform_clube_sponsor_topups_v1_809"),'2');
assert.equal(sql("SELECT count(*) FROM public.platform_admin_audit WHERE action='clube_coupon_owner_guarantee_topup'"),'2');
// Lifetime cap in synthetic DB, NEVER in production.
sql("UPDATE public.platform_clube_sponsor_pool_v1_807 SET authorized_cents=9999999,owner_guaranteed_cents=9999999,version=version+1 WHERE benefit_key='clube_coupons';");
const capVersion=state()[4];
refused(call(admin,100,randomUUID(),capVersion),'COUPON_OWNER_TOPUP_TOTAL_CAP');
assert.equal(state()[0],9999999);
console.log('V1.809 PASS — owner BRL topup, duplicate replay, ACL, optimistic race, budget cap, no fake vouchers/bank receipts.');
