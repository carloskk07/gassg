import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261107220800_ads_independent_campaign_delivery_v1_884.sql');
const edge=read('supabase/functions/ads-independent/index.ts');
const cfg=read('supabase/config.toml');
const admin=read('supabase/functions/admin-ops/index.ts');
for(const fragment of [
 'REFERENCES auth.users(id)',"budget_cents IN (1990,4990,9990,19990)",
 'billing_enabled boolean NOT NULL DEFAULT false CHECK(billing_enabled=false)',
 'billable boolean NOT NULL DEFAULT false CHECK(billable=false)',
 'ENABLE ROW LEVEL SECURITY','REVOKE ALL ON',
 'GRANT EXECUTE ON FUNCTION public.ads_independent_submit_v1_884',
 'GRANT EXECUTE ON FUNCTION public.ads_independent_issue_v1_884',
 'GRANT EXECUTE ON FUNCTION public.ads_independent_confirm_v1_884',
 'email_confirmed_at IS NOT NULL',
 'ADS_CAMPAIGN_IDEMPOTENCY_CONFLICT',
 'ADS_APPROVED_CAMPAIGN_REQUIRED','ADS_VERSION_CONFLICT',
 'v_c.status','viewer_hash','issued_at',
 "interval '1100 milliseconds'","interval '30 minutes'",
 'v_count>=floor(v_c.budget_cents*1000.0/v_c.cpm_cents)',
 "'independentlyAudited',false","'countedForDiagnostics',true",
 "'paymentCreated',false",
])assert.ok(migration.includes(fragment),'Missing invariant '+fragment);
assert.match(migration,/CREATE TABLE public\.ads_independent_view_signals_v1_884/);
assert.match(migration,/FROM public\.ads_independent_campaigns_v1_884/);
assert.doesNotMatch(migration,/UPDATE public\.merchants|INSERT INTO public\.merchants/i);
assert.doesNotMatch(migration,/mercadopago|payment_approved|CREATE\s+.*\s+charge/i);
for(const fragment of [
 'ads_independent_issue_v1_884','ads_independent_confirm_v1_884',
 'ads_independent_submit_v1_884','ads_independent_mine_v1_884',
 'isSafeHttpsDestination','auth.getUser',
 'countedForDiagnostics','billable!==false',
 'billingEnabled!==false','noCharge!==true',
 'SHA-256','cf-connecting-ip','requestId',
 'ADS_REQUEST_LIMIT','ADS_SERVICE_FAILED','ORIGIN_NOT_ALLOWED'
])assert.ok(edge.includes(fragment),'Missing Edge safeguard '+fragment);
assert.match(cfg,/\[functions\.ads-independent\]\s*verify_jwt = false/);
assert.match(admin,/if\(action==="ads-independent-read"\)/);
assert.match(admin,/if\(action==="ads-independent-action"\)/);
assert.match(admin,/admin_ads_independent_action_v1_884/);
assert.match(admin,/data\?\.billingEnabled!==false/);
assert.doesNotMatch(edge,/MERCADOPAGO_ACCESS_TOKEN|create_payment|mercadoPagoFetch/i);
console.log('V1.884 PASS: real advertisers independent of merchants, tamper-evident controls, non-billable browser signals.');
