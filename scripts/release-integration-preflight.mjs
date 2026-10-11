#!/usr/bin/env node
// TAMÃO release-candidate gate. Static and local-only. Passing this gate does
// NOT authorize production deployment or apply any PostgreSQL migrations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const textFile=p=>fs.readFileSync(path.join(root,p),'utf8');
const manifest=JSON.parse(textFile('release/integration-v1-164.json'));
const requireMatch=(src,pattern,message)=>assert.match(textFile(src),pattern,message);
const requireContains=(src,fragment,message)=>assert.ok(textFile(src).includes(fragment),message);
const expectedPrs=[205,207,208,209,210,211,212,213,214,215];
const expectedMigrations=[
 '20261011043000_delivery_first_payment_boundary_v1_158_1.sql',
 '20261011063000_merchant_basket_compliance_v1_158_2.sql',
 '20261011073000_settlement_daily_due_alignment_v1_158_3.sql',
 '20261011083000_merchant_representation_authority_v1_158_4.sql'
];
assert.equal(manifest.targetBranch,'main');
assert.equal(manifest.publicationMode,'review-only','This build is not a deploy authorization');
assert.equal(manifest.commercialActivation,'blocked','Commercial commerce cannot be automatically enabled');
assert.deepEqual(manifest.stagedPullRequests,expectedPrs,'Require every stacked PR in order');
assert.deepEqual(manifest.databaseMigrations,expectedMigrations,'Migrations must be sequenced and complete');
assert.deepEqual(manifest.serverFunctionsChanged,[
 'admin-ops','create-order','get-offers','get-order','order-payment-checkout'
]);
const migrations=expectedMigrations.map(name=>{
 const file='supabase/migrations/'+name;
 const sql=textFile(file);
 assert.ok(sql.length>500,'Missing complete SQL migration: '+name);
 assert.doesNotMatch(sql,/\bcommit\s*;/i,'Migration cannot bypass release transaction');
 assert.doesNotMatch(sql,/sb_secret_[a-z0-9_-]+/i,'Secret key in migration: '+name);
 return sql;
});
const [delivery,basket,settlement,representative]=migrations;
assert.match(delivery,/payment.*delivery|delivery.*payment/i,'Delivery-first merchant money boundary absent');
assert.match(basket,/merchant_basket_compliance_current/,'Product-scoped legal authority absent');
assert.match(settlement,/merchant_settlement_daily_due_at/,'Next-business-day fee alignment absent');
for(const marker of [
 'merchant_representation_reviews',
 'merchant_representative_verification_current',
 'admin_merchant_representation_action',
 'MERCHANT_REPRESENTATION_VERIFICATION_REQUIRED',
 'revoke all on public.merchant_representation_reviews from public,anon,authenticated'
])assert.ok(representative.toLowerCase().includes(marker.toLowerCase()),
 'Representation authority missing: '+marker);
for(const pathPart of manifest.serverFunctionsChanged){
 const edge='supabase/functions/'+pathPart+'/index.ts';
 assert.ok(fs.existsSync(path.join(root,edge)),'Missing required Edge Function: '+edge);
}
const frontRequirements=[
 ['js/customer.js','customerOrderProgress('],
 ['js/customer.js','customerRequoteDecision('],
 ['js/customer.js','checkoutOfferComparison('],
 ['js/backend.js','liveInvalidateOfferAddressDraft('],
 ['js/backend.js','liveOfferRequestFingerprint('],
 ['js/acquisition.js','customerLeadInterestSelection('],
 ['js/admin.js','adminReviewMerchantRepresentation('],
 ['js/growth.js','Que tal ser encontrada por mais clientes?']
];
for(const [file,part] of frontRequirements)requireContains(file,part,file+' has drifted from the verified release');
requireContains('supabase/functions/admin-ops/index.ts','admin_merchant_representation_action',
 'The live admin gateway would be missing the new review action');
requireContains('supabase/functions/get-offers/index.ts','safe.deliveryFeeCents=candidate.deliveryFeeCents',
 'Seller fee decomposition must originate on the server');
for(const name of [
 'merchant-representation-v1-158-4.sql',
 'merchant-representation-order-pin-fee-v1-158-4.sql',
 'order-pin-to-fee-integration-v1-158-3.sql',
 'settlement-postpaid-integration-v1-158-3.sql'
]){
 const fixture='tests/sql/'+name;
 assert.ok(fs.existsSync(path.join(root,fixture)),'Missing database rollback proof: '+fixture);
 const sql=textFile(fixture).toLowerCase();
 const executable=sql.replace(/^\s*--[^\n]*(?:\n|$)/gm,'').trimStart();
 assert.match(executable,/^begin\s*;/,'Test must start a transaction after documentation comments');
 assert.match(executable,/\brollback\s*;\s*$/,'Test must end with ROLLBACK, never persist synthetic commerce');
}
const audit=textFile('.github/workflows/audit.yml');
for(const i of [158,159,160,161,162,163,164]){
 const marker='V1.'+i;
 assert.ok(audit.includes(marker),'Missing CI regression tests for '+marker);
}
requireMatch('.github/workflows/pages.yml',/on:\s*\n\s*workflow_dispatch:/,
 'Legacy GitHub Pages must require explicit manual action');
requireContains('netlify.toml','CONTEXT','Netlify fallback preview suppression must exist');
const origins=manifest.publicPortals;
assert.deepEqual(origins,{
 customer:'https://tamao.com.br',
 merchant:'https://parceiro.tamao.com.br',
 admin:'https://admin.tamao.com.br'
},'Unknown production portal origins');
assert.equal(manifest.releasePhases?.publicAcquisition?.commerceMustRemainDisabled,true,
 'Public acquisition must leave all real orders disabled');
assert.ok(manifest.releasePhases.publicAcquisition.scope.includes('optional-consented-customer-notification'),
 'Lead capture must remain optional and consented');
assert.ok(manifest.releasePhases.publicAcquisition.blockersNotRequired.includes('first-real-sale'),
 'The first real sale must not be a circular precondition for publishing public pages');
assert.ok(!manifest.releasePhases.commercePerCity.prerequisites.includes('first-real-payment-and-delivery-homologation'),
 'A city cannot require its first completed order before the first eligible sale');
for(const required of [
 'legally-verified-active-merchant-and-authorized-representative',
 'product-specific-regulatory-gates-ANP-if-GLP',
 'direct-merchant-payment-route-homologated-before-launch',
 'admin-authorized-global-commerce-opening'
]){
 assert.ok(manifest.releasePhases.commercePerCity.prerequisites.includes(required),
   'Commercial activation missing evidence: '+required);
}
assert.ok(manifest.manualEvidenceRequired.length>=7,
 'No release can proceed without DB, portal, merchant and GLP evidence');
assert.ok(!process.argv.includes('--production')&&!process.argv.includes('--deploy'),
 'RELEASE_BLOCKED: staging CI is not evidence of real DB migrations, live domains, merchant/ANP clearance or payment homologation');
console.log(JSON.stringify({
 result:'RELEASE_CANDIDATE_SOURCE_VALIDATED',
 publicationAuthorized:false,
 commerceAuthorized:false,
 coveredPRs:expectedPrs,
 migrationCount:expectedMigrations.length,
 requiredEvidence:manifest.manualEvidenceRequired,
 sourceSha:process.env.GITHUB_SHA||'local'
},null,2));
