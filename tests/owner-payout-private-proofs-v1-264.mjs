import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014235930_owner_payout_private_proofs_v1_264.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const phrase of [
 'tamao-owner-referral-payout-proofs-v1-264',
 "array['application/pdf','image/png','image/jpeg']::text[]",
 '3145728','platform_referral_payout_proofs_v1_264',
 'alter table public.platform_referral_payout_proofs_v1_264 enable row level security',
 'platform_referral_payout_private_v1_264.eligible(',
 'platform_referral_payout_private_v1_264.attach(',
 'platform_referral_payout_private_v1_264.path(',
 'platform_referral_payout_private_v1_264.read(',
 'platform_referral_payout_private_v1_263.assert_owner(p_actor)',
 'v_claim.proof_sha256<>p_sha','storage.objects o',
 'public.platform_referral_payout_voids_v1_263',
 'PAYOUT_PROOF_LEGACY_HASH_MISMATCH','PAYOUT_PROOF_ALREADY_ATTACHED',
 "'bankVerified',false","'providerConfirmed',false",
 "'paidBenefitsCents',null","'transferExecuted',false",
 'public.admin_owner_payout_proof_eligible_v1_264',
 'public.admin_owner_payout_proof_attach_v1_264',
 'public.admin_owner_payout_proof_path_v1_264',
 'public.admin_owner_payout_proofs_read_v1_264',
 'PAYOUT_PROOF_ACL_DRIFT'
])assert.ok(sql.includes(phrase),'SQL missing '+phrase);
for(const action of [
 'owner-benefit-proof-prepare','owner-benefit-proof-finalize',
 'owner-benefit-proofs-read','owner-benefit-proof-verify','owner-benefit-proof-view'
])assert.ok(edge.includes('"'+action+'"'),'Missing route '+action);
for(const phrase of [
 'createSignedUploadUrl(path,{upsert:false})',
 '.download(path)','await crypto.subtle.digest("SHA-256",bytes)',
 'actual!==sha','bytes.length!==proof.sizeBytes||!magic||actual!==proof.sha256',
 'PAYOUT_PROOF_INTEGRITY_MISMATCH',
 'createSignedUrl(path,60,{download:true})',
 'data?.source!=="admin_owner_payout_proofs_read_v1_264"',
 'proof.bankVerified!==false'
])assert.ok(edge.includes(phrase),'Edge missing '+phrase);
for(const phrase of [
 'adminOwnerPayoutProofsLoadFromUi','adminOwnerPayoutProofUploadFromUi',
 'adminOwnerPayoutProofViewFromUi','adminOwnerPayoutProofVerifyFromUi',
 'uploadToSignedUrl(prep.path,prep.token,file,{contentType:file.type,upsert:false})',
 'adminOwnerPayoutProofsSection()','Não confirma a transferência bancária'
])assert.ok(ui.includes(phrase),'UI missing '+phrase);
assert.ok(boot.includes('adminOwnerPayoutProofVerifyFromUi,adminOwnerPayoutProofViewFromUi'));
assert.ok(audit.includes('node tests/owner-payout-private-proofs-v1-264.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const claimId='22222222-2222-4222-8222-222222222222';
const actor='11111111-1111-4111-8111-111111111111';
const sample={
 source:'admin_owner_payout_proofs_read_v1_264',month:'2026-10-01',
 timezone:'America/Sao_Paulo',totalClaims:2,withProof:1,withoutProof:1,
 limit:30,truncated:false,privateBucket:true,readOnly:true,verifiedBytesAtUpload:true,
 bankVerified:false,providerConfirmed:false,paidBenefitsCents:null,transferExecuted:false,
 rows:[
 {claimId,attached:true,sizeBytes:512,mimeType:'application/pdf',
  sha256:'a'.repeat(64),uploadedAt:'2026-10-14T19:45:00Z',voided:false},
 {claimId:'33333333-3333-4333-8333-333333333333',attached:false,
  sizeBytes:null,mimeType:null,sha256:null,uploadedAt:null,voided:false}
 ]
};
let role='superadmin',data=structuredClone(sample),messages=[],calls=[];
const context=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async req=>{calls.push(req);return data;},
 render:()=>{},toast:s=>messages.push(s),
 adminMoney:n=>'R$ '+(n/100).toFixed(2),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Date,Array
});
const start=ui.indexOf('// TAMÃO V1.264 —'),end=ui.indexOf('// TAMÃO V1.263 —',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end),context);
assert.ok(!context.adminOwnerPayoutProofsSection().includes('Comprovante arquivado'));
await context.adminOwnerPayoutProofsLoadFromUi();
assert.equal(calls[0].action,'owner-benefit-proofs-read');
assert.equal(calls[0].month,'2026-10-01');
const html=context.adminOwnerPayoutProofsSection();
for(const phrase of ['1 de 2','Comprovante arquivado','Reverificar integridade',
 'Anexar comprovante','não comprova'])
 assert.ok(html.includes(phrase),'Missing display '+phrase);
role='finance';
const finance=context.adminOwnerPayoutProofsSection();
assert.ok(finance.includes('Consultar arquivo privado'));
assert.ok(!finance.includes('Anexar comprovante'));
await context.adminOwnerPayoutProofUploadFromUi(claimId);
assert.equal(calls.length,1);
role='support';
assert.equal(context.adminOwnerPayoutProofsSection(),'');
role='superadmin';
context.adminRuntime.session.user.id='44444444-4444-4444-8444-444444444444';
assert.ok(!context.adminOwnerPayoutProofsSection().includes('Comprovante arquivado'));
context.adminRuntime.session.user.id=actor;
data={...sample,withProof:2,withoutProof:1};
await context.adminOwnerPayoutProofsLoadFromUi();
assert.ok(messages.some(x=>x.includes('não verificados')));
assert.ok(!context.adminOwnerPayoutProofsSection().includes('Comprovante arquivado'));
console.log('V1.264 PASS: signed private upload, server bytes validation, owner-only intake and no banking claim.');
