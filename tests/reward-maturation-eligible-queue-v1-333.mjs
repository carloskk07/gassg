import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(
  new URL('../supabase/migrations/20261016235900_reward_maturation_eligible_queue_v1_333.sql',import.meta.url),
  'utf8'
);
const queueStart=migration.indexOf('  for v_order_id in\n    select g.order_id');
const queueEnd=migration.indexOf('  loop\n',queueStart);
assert.ok(queueStart>0&&queueEnd>queueStart,'bounded maturation queue is present');
const queue=migration.slice(queueStart,queueEnd);
for(const pattern of [
  /join public\.orders o on o\.id=g\.order_id/,
  /join public\.referral_reward_reviews r on r\.order_id=g\.order_id/,
  /join auth\.users referrer on referrer\.id=g\.referrer_user_id/,
  /join auth\.users referred on referred\.id=g\.customer_id/,
  /g\.referral_pending_cents>0/,
  /g\.matured_at is null/,
  /g\.reversed_at is null/,
  /g\.commission_available_at<=clock_timestamp\(\)/,
  /o\.status='SETTLED'/,
  /o\.financial_state='settled'/,
  /o\.financial_reversed_at is null/,
  /r\.risk_status in \('clear','approved'\)/,
  /referrer\.is_anonymous is not true/,
  /referred\.is_anonymous is not true/,
  /order by g\.commission_available_at,g\.order_id\s+limit 100/
])assert.match(queue,pattern,'candidate selection must be eligible before LIMIT 100');

assert.match(migration,/CREATE OR REPLACE FUNCTION public\.process_reward_maturation\(\)/);
assert.match(migration,/SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
const processing=migration.slice(queueEnd);
for(const term of [
  "hashtextextended('reward:'||v_order_id::text,0)",
  'from public.orders\n    where id=v_order_id\n    for update',
  'from public.order_reward_grants\n    where order_id=v_order_id\n    for update',
  "v_review.risk_status not in ('clear','approved')",
  'v_referrer_is_anonymous is true',
  'v_referred_is_anonymous is true',
  "on conflict(idempotency_key) do nothing",
  'set matured_at=clock_timestamp()',
  "'COMMISSION_AVAILABLE'"
])assert.ok(processing.includes(term),'transactional second check must remain: '+term);
assert.equal((migration.match(/limit 100/g)||[]).length,1);
assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE|GRANT|REVOKE)\s+(?:TABLE|FUNCTION|ON)\b/i);

// Deterministic regression: 100 older blocked rows must not suppress the
// next genuinely eligible grant. Time, review and identity checks occur
// before taking a fixed-size page, but are rechecked under row locks later.
function eligible(c){
  return c.pending>0&&!c.matured&&!c.reversed&&c.due
    &&c.status==='SETTLED'&&c.financial==='settled'&&!c.financialReversed
    &&['clear','approved'].includes(c.review)&&c.referrerPermanent&&c.customerPermanent;
}
const good={pending:200,matured:false,reversed:false,due:true,status:'SETTLED',
  financial:'settled',financialReversed:false,review:'clear',
  referrerPermanent:true,customerPermanent:true};
const queueRows=[
  ...Array.from({length:100},(_,i)=>({...good,id:i+1,review:'review_required'})),
  {...good,id:101,review:'approved'},
  {...good,id:102,review:'clear'}
];
assert.equal(queueRows.slice(0,100).filter(eligible).length,0,
  'old LIMIT-before-check behavior permanently blocks newer valid referrals');
assert.deepEqual(queueRows.filter(eligible).slice(0,100).map(c=>c.id),[101,102]);
for(const patch of [
  {review:'rejected'},{referrerPermanent:false},{customerPermanent:false},
  {status:'CANCELLED'},{financial:'reversed'},{financialReversed:true},
  {pending:0},{matured:true},{reversed:true},{due:false}
])assert.equal(eligible({...good,...patch}),false,JSON.stringify(patch));
assert.equal(eligible({...good,review:'approved'}),true);
assert.equal(eligible(good),true);
assert.equal(Array.from({length:130},(_,i)=>({...good,id:i})).filter(eligible).slice(0,100).length,100,
  'batch size remains bounded');
console.log('V1.333 PASS: blocked-first-100 starvation, risk/identity/payment gates, preserved transactional checks and 100-row batch.');
