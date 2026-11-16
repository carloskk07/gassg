// TAMÃO #493 — financial-policy calculation ONLY. Does not grant money,
// write a wallet, create Pix, start a payout or enable the commercial switch.
// Call with authoritative server-side source settlements and verified activity.
// Amounts are in integer MICRO-cents (1 cent = 1,000,000 micro-cents) to keep
// fractional allocations rather than pretending every participant earned R$0.01.
export const NETWORK_PACKAGE_POOL_BPS = 1000; // Exactly 10%.
export const NETWORK_INVITER_SHARE_BPS_OF_POOL = 2000; // 20% of that 10%; never extra.
const MICRO_PER_CENT = 1_000_000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_SOURCES = new Set(['merchant_prepaid_fee','mobility_prepaid_fee']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function amount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + ' must be nonnegative safe integer');
  return value;
}
function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError(name + ' must be a UUID');
  return value.toLowerCase();
}
function microsFromNet(netCents) {
  // Limit net to 1 billion cents per receipt: multiplication is always safe.
  if (netCents > 1_000_000_000) throw new RangeError('single package exceeds supported amount');
  return netCents * NETWORK_PACKAGE_POOL_BPS * (MICRO_PER_CENT / 10_000);
}

/**
 * Pure model for the daily pool: 10% of independently reconciled NET receipts
 * of fee-reducing prepaid packages only (merchant + moto/car).
 *
 * 80% of pool: equal participation; 20% of pool: verified merchant inviter,
 * but ONLY if also independently active/eligible. Otherwise 100% equal.
 * No extra 2% is charged to the platform.
 *
 * No RLS/PSP/activity evidence is manufactured here. A future canonical ledger
 * MUST attach event IDs, settlement proof, refund reserves, activity proofs,
 * a unique per-source claim, maturity, reversal, privacy, and payout gates
 * before any persistent credit is issued.
 */
export function calculateNetworkPackageDailyPool({
  sources = [], participants = [], at, carryMicroCents = 0, merchantInviterUserId = null
} = {}) {
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs) || typeof at !== 'string') throw new TypeError('at must be an ISO date');
  amount(carryMicroCents, 'carryMicroCents');
  if (!Array.isArray(sources) || !Array.isArray(participants)) throw new TypeError('arrays required');
  if (sources.length > 50_000 || participants.length > 100_000) throw new RangeError('batch requires pagination');

  const seenSource = new Set();
  let eligibleSourceCount = 0;
  let poolMicroCents = carryMicroCents;
  for (const source of sources) {
    if (!source || !ALLOWED_SOURCES.has(source.kind)) throw new TypeError('only fee-reducing packages are eligible');
    const id = uuid(source.id, 'source.id');
    const key = source.kind + ':' + id;
    if (seenSource.has(key)) throw new Error('DUPLICATE_SOURCE');
    seenSource.add(key);
    const gross = amount(source.grossCents, 'grossCents');
    const net = amount(source.netCents, 'netCents');
    if (net > gross) throw new RangeError('net cannot exceed gross');
    if (source.providerSettled !== true || source.netReconciled !== true ||
      source.refunded === true || source.reversed === true ||
      source.disputed === true || net === 0) continue;
    const grant = microsFromNet(net);
    if (!Number.isSafeInteger(poolMicroCents + grant)) throw new RangeError('pool overflow');
    poolMicroCents += grant;
    eligibleSourceCount++;
  }

  const unique = new Map();
  for (const member of participants) {
    if (!member) throw new TypeError('invalid participant');
    const id = uuid(member.userId, 'participant.userId');
    if (unique.has(id)) continue; // Multiple app sessions cannot inflate shares.
    const activeMs = Date.parse(member.lastVerifiedActivityAt);
    const fresh = Number.isFinite(activeMs) && activeMs <= atMs &&
      activeMs > atMs - DAILY_MS;
    if (member.verifiedIdentity !== true || member.anonymous === true ||
      member.blocked === true || member.platformStaff === true ||
      member.selfPurchase === true || !fresh) continue;
    unique.set(id, { userId:id, lastVerifiedActivityAt:member.lastVerifiedActivityAt });
  }
  const eligible = [...unique.keys()].sort();
  const inviter = merchantInviterUserId == null ? null : uuid(merchantInviterUserId, 'merchantInviterUserId');
  const inviterActive = inviter != null && unique.has(inviter);
  const inviterBonusMicroCents = inviterActive
    ? Math.floor(poolMicroCents * NETWORK_INVITER_SHARE_BPS_OF_POOL / 10_000)
    : 0;
  const everyoneMicroCents = poolMicroCents - inviterBonusMicroCents;
  const equalMicroCents = eligible.length > 0
    ? Math.floor(everyoneMicroCents / eligible.length) : 0;
  const entries = eligible.map(userId => ({
    userId,
    activityMicroCents:equalMicroCents,
    inviterBonusMicroCents:userId === inviter ? inviterBonusMicroCents : 0,
    totalMicroCents:equalMicroCents + (userId === inviter ? inviterBonusMicroCents : 0)
  }));
  const creditedMicroCents = entries.reduce((n,r) => n + r.totalMicroCents,0);
  const carryForwardMicroCents = poolMicroCents - creditedMicroCents;
  if (!Number.isSafeInteger(creditedMicroCents) ||
    creditedMicroCents < 0 || carryForwardMicroCents < 0 ||
    creditedMicroCents + carryForwardMicroCents !== poolMicroCents)
    throw new Error('NETWORK_POOL_FINANCIAL_CONSERVATION_FAILED');
  return Object.freeze({
    sourceCount:eligibleSourceCount, eligibleMemberCount:eligible.length,
    poolRateBps:NETWORK_PACKAGE_POOL_BPS,
    poolMicroCents, creditedMicroCents, carryForwardMicroCents,
    inviterBonusMicroCents,
    entries,
    simulationOnly:true, walletCredited:false, externalPaymentExecuted:false
  });
}
