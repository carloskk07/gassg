import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=get('supabase/migrations/20261016235966_payout_archived_observation_chronology_v1_345.sql');
const edge=get('supabase/functions/admin-ops/index.ts');
const js=get('js/admin-acquisition.js');
const audit=get('.github/workflows/audit.yml');

for(const term of [
  'admin_owner_payout_archived_critical_v1_344',
  'min(obs.checked_at) as first_success_observed_at',
  'obs.claim_id=c.claim_id and obs.provider_transaction_success is true',
  'first_obs on first_obs.first_success_observed_at is not null',
  'first_obs.first_success_observed_at',
  "'firstSuccessObservedBeforeOrAtReversalClaims'",
  "'firstSuccessObservedAfterReversalClaims'",
  'first_success_observed_at<=reward_reversed_at',
  'first_success_observed_at>reward_reversed_at',
  "'observationChronologyV1345',true",
  "'firstProviderSuccessObservedAt',x.first_success_observed_at",
  "'successObservedBeforeOrAtReversal',x.first_success_observed_at<=x.reward_reversed_at",
  "'providerObservationIsBankProof',false",
  "'bankSettlementVerified',false",
  "'moneyMoved',false",
  "p_offset%30<>0",
  'revoke all on function public.admin_owner_payout_archived_critical_v1_344',
  'to service_role'
])assert.ok(sql.includes(term),'missing SQL chronology contract: '+term);
assert.doesNotMatch(sql,/\b(?:drop\s+table|truncate\s+table|insert\s+into|delete\s+from|update\s+public\.)\b/i);
for(const term of [
  'data?.observationChronologyV1345!==true',
  'data.firstSuccessObservedBeforeOrAtReversalClaims+',
  'data.firstSuccessObservedAfterReversalClaims',
  'r.firstProviderSuccessObservedAt',
  'r.successObservedBeforeOrAtReversal!==('
])assert.ok(edge.includes(term),'missing Edge fail-closed chronology check: '+term);
for(const term of [
  'd?.observationChronologyV1345!==true',
  'x.firstProviderSuccessObservedAt',
  'x.successObservedBeforeOrAtReversal!==(',
  'Primeiro sucesso observado somente depois da reversão',
  'Primeira observação positiva:',
  'não comprova quando o dinheiro circulou'
])assert.ok(js.includes(term),'missing admin chronology wording: '+term);
assert.match(audit,/node tests\/payout-archive-observation-chronology-v1-345\.mjs/);
new vm.Script(js,{filename:'admin-acquisition.js'});

const reversal='2026-10-15T12:00:00Z';
const sample=[
 {id:'success-observed-before',observations:[
  {at:'2026-10-14T12:00:00Z',success:true},
  {at:'2026-10-16T12:00:00Z',success:true}]},
 {id:'success-first-observed-after',observations:[
  {at:'2026-10-14T12:00:00Z',success:false},
  {at:'2026-10-16T12:00:00Z',success:true}]},
 {id:'same-time',observations:[{at:reversal,success:true}]},
 {id:'never-success',observations:[{at:'2026-10-14T12:00:00Z',success:false}]}
];
const observed=sample.map(x=>{
 const successes=x.observations.filter(y=>y.success).map(y=>Date.parse(y.at));
 const earliest=successes.length?Math.min(...successes):null;
 return {id:x.id,earliest,pre:earliest!==null&&earliest<=Date.parse(reversal)};
}).filter(x=>x.earliest!==null);
assert.equal(observed.length,3);
assert.deepEqual(observed.map(x=>x.pre),[true,false,true]);
assert.equal(observed.filter(x=>x.pre).length+observed.filter(x=>!x.pre).length,observed.length);
assert.ok(!observed.find(x=>x.id==='success-first-observed-after').pre);
console.log('V1.345 PASS: earliest recorded provider success compared to reversal timestamp, no false settlement claims.');
