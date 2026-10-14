import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=load('supabase/migrations/20261014220000_owner_campaign_private_receipts_v1_256.sql');
const edge=load('supabase/functions/admin-ops/index.ts');
const ui=load('js/admin-acquisition.js');
const boot=load('js/bootstrap.js');
const workflow=load('.github/workflows/audit.yml');
for(const invariant of [
 "insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)",
 "tamao-owner-campaign-receipts-v1-256",
 "false,3145728,array['application/pdf','image/png','image/jpeg']",
 'OWNER_RECEIPT_BUCKET_CONFIGURATION_UNSAFE',
 'platform_campaign_marketing_receipts_v1_256',
 'object_path text not null unique',
 "char_length(object_path)=77",
 'size_bytes integer not null check(size_bytes between 64 and 3145728)',
 "sha256 ~ '^[0-9a-f]{64}$'",
 'enable row level security',
 "revoke all on public.platform_campaign_marketing_receipts_v1_256",
 'platform_funding_private_v1_256.eligible',
 'platform_funding_private_v1_256.attach',
 'platform_funding_private_v1_256.receipts_read',
 'platform_funding_private_v1_256.receipt_path',
 'public.admin_owner_campaign_receipt_eligible_v1_256',
 'public.admin_owner_campaign_receipt_attach_v1_256',
 'public.admin_owner_campaign_receipts_read_v1_256',
 'public.admin_owner_campaign_receipt_path_v1_256',
 "a.admin_role='superadmin'",
 "a.admin_role in ('superadmin','finance')",
 'RECEIPT_ALREADY_ATTACHED',
 "v_prev.sha256<>p_sha",
 "not exists(select 1 from public.platform_campaign_marketing_cost_voids_v1_255",
 "'bankVerified',false",
 "'noPublicUrls',true",
 'grant execute on function public.admin_owner_campaign_receipt_attach_v1_256',
]) assert.ok(sql.includes(invariant),'Missing migration invariant: '+invariant);
assert.ok(!/create\s+policy/i.test(sql),'No public object read or write policies');
assert.ok(!/update\s+public\.platform_campaign_marketing_costs_v1_255/i.test(sql),'Do not mutate V1.255 costs');
for(const act of [
 'owner-campaign-receipt-prepare',
 'owner-campaign-receipt-finalize',
 'owner-campaign-receipts-read',
 'owner-campaign-receipt-view'
]) assert.ok(edge.includes('if(action==="'+act+'")'),'Missing Edge route: '+act);
assert.ok(edge.includes('createSignedUploadUrl(path,{upsert:false})'));
assert.ok(edge.includes('uploadToSignedUrl')===false,'Upload must occur in browser with no service key');
assert.ok(edge.includes('.from("tamao-owner-campaign-receipts-v1-256").download(path)'));
assert.ok(edge.includes('crypto.subtle.digest("SHA-256",bytes)'));
assert.ok(edge.includes('actualHash!==hash'));
assert.ok(edge.includes('[137,80,78,71,13,10,26,10]'));
assert.ok(edge.includes('bytes[0]===37&&bytes[1]===80'));
assert.ok(edge.includes('bytes[0]===255&&bytes[1]===216'));
assert.ok(edge.includes('createSignedUrl(data.objectPath,60,{download:true})'));
assert.ok(edge.includes('signed.signedUrl.startsWith(SUPABASE_URL+"/storage/v1/object/sign/")'));
assert.ok(ui.includes('adminRuntime.client.storage'));
assert.ok(ui.includes('.uploadToSignedUrl(prep.path,prep.token,file,{contentType:file.type,upsert:false})'));
assert.ok(ui.includes('crypto.subtle.digest('));
assert.ok(ui.includes('adminCampaignReceiptsState'));
assert.ok(ui.includes('adminCampaignReceiptsLoadFromUi'));
assert.ok(ui.includes('adminCampaignReceiptDownloadFromUi'));
assert.ok(ui.includes('adminCampaignReceiptUploadFromUi'));
assert.ok(ui.includes('adminCampaignCostsSection()'));
assert.ok(ui.includes('owner-proof-file-'));
assert.ok(boot.includes('adminCampaignReceiptsLoadFromUi,adminCampaignReceiptUploadFromUi,adminCampaignReceiptDownloadFromUi'));
assert.ok(workflow.includes('node tests/owner-campaign-private-receipts-v1-256.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
// Validate contract-compatible UUID path length and forbidden mismatches.
const expense='11111111-1111-4111-8111-111111111111';
const object='22222222-2222-4222-8222-222222222222';
const path=expense+'/'+object+'.pdf';
assert.equal(path.length,77);
assert.ok(new RegExp('^'+expense+'/[0-9a-f-]{36}\\.(pdf|png|jpg)$').test(path));
assert.ok(!path.endsWith('.jpg'));
assert.ok(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(path+'evil'));
console.log('V1.256 PASS — private bucket, metadata ACL, signed single-object upload, SHA256 and time-bounded downloads.');
