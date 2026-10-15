import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261015160000_merchant_push_vault_cron_v1_288.sql');
const worker=read('supabase/functions/merchant-push-delivery/index.ts');
const legacy=read('tests/merchant-push-delivery-v1-287.mjs');
const audit=read('.github/workflows/audit.yml');

assert.match(sql,/create extension if not exists pg_net with schema extensions/);
assert.match(sql,/create table if not exists public\.merchant_push_cron_config/);
assert.match(sql,/enabled boolean not null default false/);
assert.match(sql,/enable row level security/);
assert.match(sql,/revoke all on public\.merchant_push_cron_config from public,anon,authenticated/);
assert.match(sql,/extensions\.gen_random_bytes\(32\)/);
assert.match(sql,/vault\.create_secret\(/);
assert.match(sql,/extensions\.digest\(v_token,'sha256'\)/);
assert.match(sql,/v_token:=null/);
assert.match(sql,/vault\.decrypted_secrets/);
assert.match(sql,/create or replace function public\.merchant_push_cron_authorize/);
assert.match(sql,/grant execute on function public\.merchant_push_cron_authorize\(text\) to service_role/);
assert.match(sql,/revoke all on function public\.merchant_push_cron_tick\(\)/);
assert.match(sql,/if not exists\(select 1 from public\.merchant_push_cron_config[\s\S]*where id=true and enabled\) then[\s\S]*return false/);
assert.match(sql,/net\.http_post\(/);
assert.match(sql,/X-Tamao-Cron-Token/);
assert.match(sql,/timeout_milliseconds:=42000/);
assert.match(sql,/cron\.schedule\([\s\S]*?'tamao-merchant-push-v1-288',[\s\S]*?'15 seconds'/);
assert.doesNotMatch(sql,/Bearer [a-f0-9]{64}/,'never commit a bearer');
assert.doesNotMatch(sql,/enabled boolean not null default true/);

assert.match(worker,/async function authorizeVaultCron\(/);
assert.match(worker,/req\.headers\.has\("Authorization"\)/);
assert.match(worker,/sha256Hex\(token\)/);
assert.match(worker,/admin\.rpc\("merchant_push_cron_authorize"/);
assert.match(worker,/data===true/);
assert.match(worker,/body\?\.source!=="supabase_cron_v1_288"/);
assert.match(worker,/CRON_AUTH_DENIED/);
assert.match(worker,/if\(!senderConfigured\(\)\)/);
assert.match(worker,/source="github_oidc"/);
assert.match(worker,/source="supabase_cron"/);
assert.match(worker,/verifyGithubOidc\(bearer\.slice\(7\)\)/);
assert.match(worker,/canonical!==expected/);
assert.match(worker,/merchant_push_claim_due/);
assert.match(worker,/merchant_push_resolve_delivery/);
assert.match(legacy,/OIDC_AUDIENCE/);
assert.match(audit,/node tests\/merchant-push-cron-v1-288\.mjs/);

const p=worker.indexOf('async function authorizeVaultCron(');
const q=worker.indexOf('\n}',p);
assert.ok(p>=0&&q>p);
const functionSource=worker.slice(p,q+2);
const ctx=vm.createContext({
 sha256Hex:async(v)=>{assert.equal(v,'a'.repeat(64));return 'b'.repeat(64)},
 DomainError:class DomainError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status}}
});
vm.runInContext(functionSource+'\nthis.authorize=authorizeVaultCron;',ctx);
const call=async (headers,admin)=>ctx.authorize({headers:new Headers(headers)},admin);
const seen=[];
const admin={rpc:async(name,args)=>{
 seen.push({name,args});return {data:true,error:null};
}};
assert.equal(await call({'X-Tamao-Cron-Token':'a'.repeat(64)},admin),true);
assert.equal(seen.length,1);
assert.equal(seen[0].name,'merchant_push_cron_authorize');
assert.equal(seen[0].args.p_token_sha,'b'.repeat(64));
for(const h of [
 {},
 {'Authorization':'Bearer test','X-Tamao-Cron-Token':'a'.repeat(64)},
 {'X-Tamao-Cron-Token':'abcd'},
 {'X-Tamao-Cron-Token':'A'.repeat(64)},
 {'X-Tamao-Cron-Token':'g'.repeat(64)}
]){
 assert.equal(await call(h,admin),false,'unauthorized cron bearer rejected');
}
assert.equal(seen.length,1,'invalid credentials must not even call database');
assert.equal(await call({'X-Tamao-Cron-Token':'a'.repeat(64)},{rpc:async()=>({data:false,error:null})}),false);
await assert.rejects(()=>call({'X-Tamao-Cron-Token':'a'.repeat(64)},
 {rpc:async()=>({data:null,error:'rpc unavailable'})}),/Cron authentication unavailable/);
console.log('V1.288 PASS — Vault-only bearer, 15-second fail-closed Cron, signed OIDC preserved, auth and no-leak checks.');
