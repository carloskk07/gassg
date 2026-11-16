import assert from 'node:assert/strict';
import {calculateNetworkPackageDailyPool,NETWORK_PACKAGE_POOL_BPS} from
  '../supabase/functions/_shared/network-fee-package-pool-policy.mjs';

const ids={
  a:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  b:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  c:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  d:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
};
const at='2026-11-15T20:00:00Z';
const member=(userId,other={})=>({
  userId,verifiedIdentity:true,anonymous:false,blocked:false,platformStaff:false,
  selfPurchase:false,lastVerifiedActivityAt:'2026-11-15T19:10:00Z',...other
});
const merchant=(id=ids.a,netCents=1970)=>({
  kind:'merchant_prepaid_fee',id,grossCents:1990,netCents,
  providerSettled:true,netReconciled:true
});
const mobility=(id=ids.b)=>({
  kind:'mobility_prepaid_fee',id,grossCents:990,netCents:990,
  providerSettled:true,netReconciled:true
});
assert.equal(NETWORK_PACKAGE_POOL_BPS,1000);
// Two types of lower-fee prepaid plans only. R$19.70 NET + R$9.90 NET.
let v=calculateNetworkPackageDailyPool({
  sources:[merchant(),mobility()],participants:[member(ids.a),member(ids.b)],at
});
assert.equal(v.sourceCount,2);
assert.equal(v.poolMicroCents,296_000_000,'10% of net receipts = R$2.96');
assert.equal(v.creditedMicroCents,v.poolMicroCents);
assert.equal(v.entries[0].totalMicroCents,148_000_000);
assert.equal(v.entries[1].totalMicroCents,148_000_000);
assert.equal(v.simulationOnly,true);
assert.equal(v.walletCredited,false);
assert.equal(v.externalPaymentExecuted,false);

// Merchant inviter earns a bonus WITHIN, not in addition to, the 10% ceiling.
v=calculateNetworkPackageDailyPool({
  sources:[{...merchant(),merchantInviterUserId:ids.a,merchantReferralVerified:true}],at,
  participants:[member(ids.a),member(ids.b),member(ids.c)]
});
assert.equal(v.poolMicroCents,197_000_000);
assert.equal(v.inviterBonusMicroCents,39_400_000); // exactly 2% of NET inside 10%
assert.equal(v.entries[0].totalMicroCents,91_933_333);
assert.equal(v.entries[1].totalMicroCents,52_533_333);
assert.equal(v.entries[2].totalMicroCents,52_533_333);
assert.equal(v.carryForwardMicroCents,1);
assert.equal(v.creditedMicroCents+v.carryForwardMicroCents,v.poolMicroCents);

// No verified inviter? All 10% returns to active group, not an extra founder fee.
v=calculateNetworkPackageDailyPool({
  sources:[{...merchant(),merchantInviterUserId:ids.c,merchantReferralVerified:true}],at,
  participants:[member(ids.a),member(ids.b)]
});
assert.equal(v.inviterBonusMicroCents,0);
assert.equal(v.entries[0].totalMicroCents,98_500_000);
assert.equal(v.entries[1].totalMicroCents,98_500_000);


// A referrer of a merchant package must not receive 2% of unrelated MOBILITY
// plans sold the same day; only the verified merchant source generates bonus.
v=calculateNetworkPackageDailyPool({
  sources:[{...merchant(),merchantInviterUserId:ids.a,merchantReferralVerified:true},
    {...mobility(),merchantInviterUserId:ids.a,merchantReferralVerified:true}],
  at,participants:[member(ids.a),member(ids.b)]
});
assert.equal(v.poolMicroCents,296_000_000);
assert.equal(v.inviterBonusMicroCents,39_400_000,
  'bonus cannot attach to mobility NET');
assert.equal(v.entries[0].totalMicroCents,167_700_000);
assert.equal(v.entries[1].totalMicroCents,128_300_000);
assert.equal(v.creditedMicroCents+v.carryForwardMicroCents,v.poolMicroCents);

// Even a verified inviter cannot buy their own merchant package for a bonus.
v=calculateNetworkPackageDailyPool({
  sources:[{...merchant(),merchantInviterUserId:ids.a,
    purchaserUserId:ids.a,merchantReferralVerified:true}],
  at,participants:[member(ids.a),member(ids.b)]
});
assert.equal(v.inviterBonusMicroCents,0);
assert.equal(v.creditedMicroCents,197_000_000);
// Mere referral-code association, without server verification, earns nothing.
v=calculateNetworkPackageDailyPool({
  sources:[{...merchant(),merchantInviterUserId:ids.a,
    merchantReferralVerified:false}],at,
  participants:[member(ids.a),member(ids.b)]
});
assert.equal(v.inviterBonusMicroCents,0);

// 24h activity is ONLY a verified, time-limited eligibility signal.
// Multiple browser sessions of the same user can never multiply their share.
v=calculateNetworkPackageDailyPool({
  sources:[mobility()],at,
  participants:[
    member(ids.a),member(ids.a),member(ids.b,{lastVerifiedActivityAt:'2026-11-14T19:59:59Z'}),
    member(ids.c,{verifiedIdentity:false}),member(ids.d,{platformStaff:true})
  ]
});
assert.equal(v.eligibleMemberCount,1);
assert.equal(v.entries[0].totalMicroCents,99_000_000);
v=calculateNetworkPackageDailyPool({
  sources:[mobility()],at,
  participants:[
    member(ids.a,{lastVerifiedActivityAt:'2026-11-15T20:00:01Z'}),
    member(ids.b,{selfPurchase:true}),member(ids.c,{anonymous:true}),
    member(ids.d,{blocked:true})
  ]
});
assert.equal(v.eligibleMemberCount,0);
assert.equal(v.creditedMicroCents,0);
assert.equal(v.carryForwardMicroCents,99_000_000);

// No proven settlement => no pool. Refund/dispute/reversal => no grant.
for(const changed of [
  {providerSettled:false},{netReconciled:false},{refunded:true},
  {reversed:true},{disputed:true},{netCents:0}
]){
  const source={...merchant(),...changed};
  const r=calculateNetworkPackageDailyPool({
    sources:[source],at,participants:[member(ids.a)]
  });
  assert.equal(r.poolMicroCents,0,JSON.stringify(changed));
  assert.equal(r.entries[0].totalMicroCents,0);
}
// Rollover retains fractional cents; never manufacture R$0.01 per person.
v=calculateNetworkPackageDailyPool({
  sources:[{...merchant(),grossCents:10,netCents:10}],at,
  participants:[member(ids.a),member(ids.b),member(ids.c)],
  carryMicroCents:1
});
assert.equal(v.poolMicroCents,1_000_001);
assert.equal(v.carryForwardMicroCents,2);
assert.equal(v.creditedMicroCents+v.carryForwardMicroCents,v.poolMicroCents);

// Bad entries cannot become rewards.
const run=(input)=>calculateNetworkPackageDailyPool({
  sources:[merchant()],at,participants:[member(ids.a)],...input
});
assert.throws(()=>run({sources:[merchant(),merchant()]}),/DUPLICATE_SOURCE/);
assert.throws(()=>run({sources:[{...merchant(),kind:'clube_coupon'}]}),/only fee-reducing/);
assert.throws(()=>run({sources:[{...merchant(),kind:'advertising'}]}),/only fee-reducing/);
assert.throws(()=>run({sources:[{...merchant(),netCents:1991}]}),/net cannot exceed gross/);
assert.throws(()=>run({sources:[{...merchant(),netCents:-1}]}),/nonnegative safe integer/);
assert.throws(()=>run({sources:[{...merchant(),netCents:Math.PI}]}),/nonnegative safe integer/);
assert.throws(()=>run({at:'wrong-date'}),/ISO date/);
assert.throws(()=>run({carryMicroCents:1.2}),/nonnegative safe integer/);
assert.throws(()=>run({participants:[member('invalid')]}),/UUID/);
assert.throws(()=>run({sources:[{...merchant(),netCents:1_000_000_001,
  grossCents:1_000_000_001}]}),/supported amount/);

console.log('PASS: 10% from NET verified fee-prepaid packages ONLY; 8% + 2% only for independently attributed merchant packages inside the same ceiling, 24h actual activity, anti-repeat/refund, exact micro-cent conservation. NO money transferred.');
