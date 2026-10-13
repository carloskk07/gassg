import assert from 'node:assert/strict';
import fs from 'node:fs';
const s=fs.readFileSync(new URL('./remote-admin-turnstile.mjs',import.meta.url),'utf8');
for(const part of [
 "async function stopChrome(chrome)",
 "chrome.signalCode!==null",
 "chrome.kill('SIGTERM')",
 "chrome.kill('SIGKILL')",
 "function cleanupChromeProfile(profile)",
 "maxRetries:20,retryDelay:200",
 "ENOTEMPTY",
 "EBUSY",
 "EPERM",
 "console.warn('Chrome profile cleanup deferred:'",
 "cleanupChromeProfile(profile);",
 "assert.equal(liveHost,'admin.tamao.com.br'",
 "assert.ok(initial.key.length>=6",
 "assert.equal(\n    hardConfigError,\n    false,"
])assert.ok(s.includes(part),'Turnstile smoke regression: '+part);
assert.ok(!s.includes('rmSync(profile,{recursive:true,force:true});'),'Old unsafe profile deletion must be absent');
assert.ok((s.match(/cleanupChromeProfile\(profile\);/g)||[]).length>=3,
 'Retryable cleanup should be used at start, after failure and finally');
console.log('V1.238.1 PASS — Turnstile smoke cannot fail only from transient Chrome directory cleanup');
