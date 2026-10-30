import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// V1.493: REAL PostgreSQL 17 + complete migration chain, NEVER bank evidence.
// Runs after the isolated POSITIVE checkout and maturation, in the same
// disposable GitHub Actions database. No hosted project or PSP credentials.
assert.equal(process.env.CI,'true','disposable CI is required');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:30000});
const vars=Object.fromEntries(raw.split('\n').map(line=>{
  const m=line.match(/^([A-Z_]+)=(.*)$/);
  return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
assert.match((vars.API_URL||vars.SUPABASE_URL||''),
  /^http:\/\/(?:localhost|127\.0\.0\.1):54321\/?$/);
const sql=statement=>execFileSync('psql',[
  '--host=127.0.0.1','--port=54322','--username=postgres',
  '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
  '--tuples-only','--no-align','--quiet','--command='+statement
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
  timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const scalar=stmt=>sql('SELECT '+stmt+';');
const json=stmt=>JSON.parse(scalar(stmt+'::text'));
const rejected=(query,reason)=>{
  let thrown=null;
  try{sql(query)}catch(error){thrown=error}
  assert.ok(thrown,'unsafe payout declaration unexpectedly allowed: '+reason);
  assert.match(String(thrown.stderr||thrown.message||''),new RegExp(reason));
};
const reward=JSON.parse(sql(
  "SELECT row_to_json(r)::text FROM ("+
  "SELECT g.order_id,g.referrer_user_id,g.referral_pending_cents,g.matured_at,"+
  "g.reversed_at,o.financial_state,r.status as receivable_status "+
  "FROM public.order_reward_grants g "+
  "JOIN public.orders o ON o.id=g.order_id "+
  "JOIN public.platform_receivables r ON r.order_id=g.order_id "+
  "JOIN auth.users u ON u.id=g.customer_id "+
  "WHERE u.email LIKE 'tamao-buyer-%@example.com' "+
  "AND g.referral_pending_cents>0 AND g.matured_at IS NOT NULL "+
  "ORDER BY g.matured_at DESC LIMIT 1) r;"));
assert.ok(reward,'checkout must produce a REAL matured commission grant');
assert.equal(reward.reversed_at,null);
assert.equal(reward.financial_state,'settled');
assert.equal(reward.receivable_status,'paid',
  'disposable test recorded fake merchant fee; this is NOT proof of bank settlement');
const owner=scalar("user_id::text FROM public.platform_admins "+
  "WHERE active AND admin_role='superadmin' AND user_id IN "+
  "(SELECT id FROM auth.users WHERE email LIKE 'tamao-admin-%@example.com') LIMIT 1");
const buyer=scalar("id::text FROM auth.users "+
  "WHERE email LIKE 'tamao-buyer-%@example.com' ORDER BY created_at DESC LIMIT 1");
assert.match(owner,/^[0-9a-f-]{36}$/i);
assert.match(buyer,/^[0-9a-f-]{36}$/i);
const today=scalar("(clock_timestamp() at time zone 'America/Sao_Paulo')::date");
const month=today.slice(0,7)+'-01';
assert.ok(today>=String(reward.matured_at).slice(0,10),
  'claim date cannot predate maturity');
for(const role of ['anon','authenticated']){
  assert.equal(scalar("has_function_privilege("+q(role)+
   ",'public.admin_owner_referral_payout_record_v1_263(uuid,uuid,bigint,text,text,date,text)','EXECUTE')"),'f',
   role+' must not be able to record payouts through Data API');
  assert.equal(scalar("has_function_privilege("+q(role)+
   ",'public.admin_owner_referral_payout_void_v1_263(uuid,uuid,text)','EXECUTE')"),'f',
   role+' must not void payouts through Data API');
}
const order=q(reward.order_id)+'::uuid';
const amount=reward.referral_pending_cents;
const before=scalar("(SELECT count(*) FROM public.wallet_entries)::text || ':' || "+
 "(SELECT count(*) FROM public.platform_referral_payout_proofs_v1_264)::text || ':' || "+
 "(SELECT count(*) FROM public.merchant_billing_payment_events)::text || ':' || "+
 "(SELECT count(*) FROM public.order_reward_grants)::text");
const claim=(actor,reference,amountCents=amount,paidOn=today,orderId=reward.order_id)=> 
 "SELECT public.admin_owner_referral_payout_record_v1_263("+
 q(actor)+"::uuid,"+q(orderId)+"::uuid,"+amountCents+
 ",'pix',"+q(reference)+","+q(paidOn)+"::date,NULL)::text;";
const ref1='CI-LOCAL-PAYOUT-'+randomUUID();
const ref2='CI-LOCAL-REPLACEMENT-'+randomUUID();
assert.equal(scalar("count(*) FROM public.platform_referral_payout_claims_v1_263"),'0');
rejected(claim(buyer,ref1),'PAYOUT_OWNER_ONLY');
rejected(claim(owner,ref1,amount+1),'PAYOUT_GRANT_NOT_ELIGIBLE');
rejected(claim(owner,ref1,amount,today,randomUUID()),'PAYOUT_GRANT_NOT_ELIGIBLE');
rejected(claim(owner,ref1,amount,'2026-01-01'),'PAYOUT_GRANT_NOT_ELIGIBLE');
assert.equal(scalar("count(*) FROM public.platform_referral_payout_claims_v1_263"),'0',
 'all denied actions must be atomic');

const first=JSON.parse(sql(claim(owner,ref1)));
assert.equal(first.alreadyRecorded,false);
assert.equal(first.bankVerified,false);
assert.equal(first.transferExecuted,false);
assert.match(first.claimId,/^[0-9a-f-]{36}$/i);
const replay=JSON.parse(sql(claim(owner,ref1)));
assert.equal(replay.alreadyRecorded,true);
assert.equal(replay.claimId,first.claimId,'exact replay cannot create another row');
rejected(claim(owner,ref2),'PAYOUT_ACTIVE_CLAIM_EXISTS');
assert.equal(scalar("count(*) FROM public.platform_referral_payout_claims_v1_263 WHERE order_id="+order),'1');

const read=(actor)=>json("public.admin_owner_referral_payout_claims_v1_263("+
 q(actor)+"::uuid,"+q(month)+"::date)");
rejected("SELECT public.admin_owner_referral_payout_claims_v1_263("+
 q(buyer)+"::uuid,"+q(month)+"::date)::text",'PAYOUT_READ_DENIED');
const listed=read(owner);
assert.equal(listed.reportedByOwnerOnly,true);
assert.equal(listed.bankSettlementVerified,false);
assert.equal(listed.externalPaidBenefitsCents,null);
assert.equal(listed.noTransfers,true);
assert.equal(listed.metrics.activeClaims,1);
assert.equal(listed.metrics.reportedEligibleNowCents,amount);
assert.equal(listed.metrics.activeWithoutProofFingerprint,1);
assert.equal(listed.rows.find(row=>row.claimId===first.claimId).voided,false);

const voidIt=(actor,id,reason)=>"SELECT public.admin_owner_referral_payout_void_v1_263("+
 q(actor)+"::uuid,"+q(id)+"::uuid,"+q(reason)+")::text;";
rejected(voidIt(buyer,first.claimId,'CI invalid reversal by outsider'),'PAYOUT_OWNER_ONLY');
rejected(voidIt(owner,first.claimId,'short'),'PAYOUT_VOID_INVALID');
const reason='CI: fixture statement was not a bank transfer';
const cancelled=JSON.parse(sql(voidIt(owner,first.claimId,reason)));
assert.equal(cancelled.alreadyVoided,false);
assert.equal(cancelled.transferExecuted,false);
const voidReplay=JSON.parse(sql(voidIt(owner,first.claimId,reason)));
assert.equal(voidReplay.alreadyVoided,true);
assert.equal(scalar("count(*) FROM public.platform_referral_payout_voids_v1_263 WHERE claim_id="+
 q(first.claimId)+"::uuid"),'1');

rejected(claim(owner,ref1),'PAYOUT_REFERENCE_ALREADY_USED',
 'voided reference can never be recycled');
const corrected=JSON.parse(sql(claim(owner,ref2)));
assert.equal(corrected.alreadyRecorded,false);
assert.notEqual(corrected.claimId,first.claimId);
const correctedReplay=JSON.parse(sql(claim(owner,ref2)));
assert.equal(correctedReplay.alreadyRecorded,true);
assert.equal(correctedReplay.claimId,corrected.claimId);
const final=read(owner);
assert.equal(final.metrics.totalClaims,2);
assert.equal(final.metrics.activeClaims,1);
assert.equal(final.metrics.voidedClaims,1);
assert.equal(final.metrics.reportedActiveCents,amount);
assert.equal(final.metrics.reportedVoidedCents,amount);
assert.equal(final.rows.some(row=>row.claimId===first.claimId&&row.voided===true),true);
assert.equal(final.rows.some(row=>row.claimId===corrected.claimId&&row.voided===false),true);
assert.equal(final.bankSettlementVerified,false);
assert.equal(final.externalPayoutMeasured,false);
assert.equal(final.externalPaidBenefitsCents,null);
const after=scalar("(SELECT count(*) FROM public.wallet_entries)::text || ':' || "+
 "(SELECT count(*) FROM public.platform_referral_payout_proofs_v1_264)::text || ':' || "+
 "(SELECT count(*) FROM public.merchant_billing_payment_events)::text || ':' || "+
 "(SELECT count(*) FROM public.order_reward_grants)::text");
assert.equal(after,before,
 'payout DECLARATIONS cannot transfer funds, mint wallet credit or bank proof');
console.log('PASS: real full-schema referral claim, eligibility, read ACL, duplicate, void, immutable provider reference, no bank transfer.');
