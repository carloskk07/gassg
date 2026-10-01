import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildRuntimeConfig,validatePortalOrigin,validateTurnstileSiteKey} from '../scripts/generate-runtime-config.mjs';

const good={
  CHAMA_CUSTOMER_ORIGIN:'https://app.example.com',
  CHAMA_MERCHANT_ORIGIN:'https://revenda.example.com',
  CHAMA_ADMIN_ORIGIN:'https://admin.example.com',
  CHAMA_TURNSTILE_SITE_KEY:'0x4AAAAAAAAAA-demo-site-key'
};
const out=buildRuntimeConfig(good);
for(const value of Object.values(good))assert.ok(out.includes(value));

assert.throws(()=>validatePortalOrigin('X','http://app.example.com'),/https/);
assert.throws(()=>validatePortalOrigin('X','https://example.github.io'),/github\.io/);
assert.throws(()=>validatePortalOrigin('X','https://app.example.com/path'),/path|origin/);
assert.throws(()=>buildRuntimeConfig({...good,CHAMA_ADMIN_ORIGIN:good.CHAMA_CUSTOMER_ORIGIN}),/distinct/);
assert.throws(()=>buildRuntimeConfig({...good,CHAMA_TURNSTILE_SITE_KEY:''}),/TURNSTILE_SITE_KEY.*required/i);
assert.throws(()=>validateTurnstileSiteKey('bad key with spaces'),/invalid/);

const tmp=path.join(os.tmpdir(),'chama-runtime-config-'+process.pid+'.js');
execFileSync(process.execPath,['scripts/generate-runtime-config.mjs'],{
  cwd:new URL('..',import.meta.url),
  env:{...process.env,...good,RUNTIME_CONFIG_OUTPUT:tmp},
  stdio:'pipe'
});
const generated=fs.readFileSync(tmp,'utf8');
assert.ok(generated.includes('globalThis.CHAMA_ADMIN_ORIGIN="https://admin.example.com";'));
assert.ok(generated.includes('globalThis.CHAMA_TURNSTILE_SITE_KEY="0x4AAAAAAAAAA-demo-site-key";'));
fs.rmSync(tmp,{force:true});

console.log('Runtime config contract passou.');
