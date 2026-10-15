import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const provision=read('supabase/migrations/20261015170000_merchant_vapid_secure_pilot_v1_289.sql');
const vaultSender=read('supabase/migrations/20261015171000_merchant_push_sender_vault_v1_289.sql');
const setup=read('supabase/functions/merchant-push-vapid-setup/index.ts');
const enrollment=read('supabase/functions/merchant-push-registration/index.ts');
const sender=read('supabase/functions/merchant-push-delivery/index.ts');
const backend=read('js/backend.js'),merchant=read('js/merchant.js');
const workflow=read('.github/workflows/audit.yml'),config=read('supabase/config.toml');
new vm.Script(backend,{filename:'backend.js'});
new vm.Script(merchant,{filename:'merchant.js'});
for(const marker of [
  'merchant_push_keyring','enable row level security',
  'revoke all on public.merchant_push_keyring from public,anon,authenticated',
  'vault.create_secret(p_private_key','pg_advisory_xact_lock(289, 1)',
  'VAPID_ALREADY_PROVISIONED','sender_enabled boolean not null default false',
  'merchant_push_bootstrap_authorize','merchant_push_public_config',
  'merchant_push_bootstrap_once','vault.decrypted_secrets',
  'p_token_sha','grant execute on function public.merchant_push_public_config() to service_role'
])assert.ok(provision.includes(marker),'provision SQL missing '+marker);
assert.ok(!provision.includes('vapid_private: "'),'No private key material in committed migration');
assert.ok(!provision.includes('p_private_key text default'),'No hardcoded key');
assert.ok(vaultSender.includes('merchant_push_sender_credentials()'));
assert.ok(vaultSender.includes('k.sender_enabled'));
assert.ok(vaultSender.includes('vault.decrypted_secrets'));
assert.ok(vaultSender.includes('grant execute on function public.merchant_push_sender_credentials() to service_role'));
assert.ok(vaultSender.includes('revoke all on function public.merchant_push_sender_credentials()'));

for(const marker of [
  'merchant_push_bootstrap_authorize','merchant_push_install_vapid',
  'crypto.subtle.generateKey','"ECDSA"','"P-256"','crypto.subtle.exportKey("raw"',
  'crypto.subtle.exportKey("jwk"','privateJwk.d','X-Tamao-Cron-Token',
  'req.headers.has("Authorization")','raw.length>100','"vapid_setup_v1_289"',
  'return reply({ok:true,installed:true,publicKey:installed.publicKey,testMode:true})'
])assert.ok(setup.includes(marker),'protected setup missing '+marker);
assert.ok(!setup.includes('console.log('),'private key must never be logged');
assert.ok(!setup.includes('return reply({private'),'private scalar must never be returned');
assert.match(config,/\[functions\.merchant-push-vapid-setup\][\s\S]*verify_jwt = false/);

for(const marker of [
  'publicClient.auth.getUser','merchant_push_public_config',
  'enrollmentEnabled','testMode:pushConfig.testMode!==false',
  'if(!enrollmentEnabled)','merchant_push_subscriptions',
  'merchantId','user.id','consume_api_quota'
])assert.ok(enrollment.includes(marker),'enrollment missing '+marker);
assert.ok(!enrollment.includes('MERCHANT_VAPID_PRIVATE_KEY'));
assert.ok(!enrollment.includes('PUSH_DELIVERY_READY'));

for(const marker of [
  'loadSenderCredentials','merchant_push_sender_credentials','if(!credentials)',
  'senderConfigured','publicKey:credentials.publicKey',
  'privateKey:credentials.privateKey','subject:credentials.subject',
  'merchant_push_claim_due','merchant_push_resolve_delivery',
  'authorizeVaultCron','verifyGithubOidc'
])assert.ok(sender.includes(marker),'sender missing '+marker);
assert.ok(!sender.includes('VAPID_PRIVATE_KEY=(Deno.env'));
assert.ok(sender.indexOf('if(!credentials)')<sender.indexOf('merchant_push_claim_due'),
 'disabled sender must return before claiming deliveries');

assert.ok(backend.includes('queueMicrotask(()=>merchantPushCheckLive().catch(()=>{}))'),
 'push pilot option should become visible after successful login');
assert.ok(backend.includes('checking:false'));
assert.ok(backend.includes('testMode:merchantPushRuntime.testMode!==false'));
assert.ok(backend.includes('testMode=result?.testMode!==false'));
assert.ok(merchant.includes('Cadastrar aparelho para teste'));
assert.ok(merchant.includes('envio remoto ainda está desativado'));
assert.ok(workflow.includes('node tests/merchant-vapid-pilot-v1-289.mjs'));

const start=backend.indexOf('function merchantPushStatus()'),end=backend.indexOf('\n}',start);
assert.ok(start>0&&end>start);
const code=backend.slice(start,end+2);
const runtime={checked:true,available:true,subscribed:false,testMode:true};
const ctx=vm.createContext({
 merchantPushRuntime:runtime,
 Notification:{permission:'granted'},navigator:{serviceWorker:{}},
 PushManager:class PushManager{},isSecureContext:true
});
vm.runInContext(code+'\nthis.status=merchantPushStatus;',ctx);
let status=ctx.status();
assert.equal(status.available,true);
assert.equal(status.testMode,true);
runtime.testMode=false;
assert.equal(ctx.status().testMode,false);
runtime.available=false;
assert.equal(ctx.status().available,false);
console.log('V1.289 PASS — one-time secret VAPID, authenticated pilot registration, sender disabled, post-login discovery.');
