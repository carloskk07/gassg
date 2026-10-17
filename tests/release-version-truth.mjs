import assert from 'node:assert/strict';
import fs from 'node:fs';

const load=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const readme=load('README.md');
const truth=load('docs/release-authority.md');
const triage=load('docs/open-pr-triage-2026-10-17.md');

assert.ok(readme.startsWith('# TAMÃO — marketplace local de essenciais\n'),'README title unexpected');
const intro=readme.slice(0,2400);
for(const marker of ['Fonte oficial de versão','docs/release-authority.md','docs/open-pr-triage-2026-10-17.md','portal-build.json','sourceSha','main']){
  assert.ok(intro.includes(marker),'Missing canonical release explanation: '+marker);
}
assert.doesNotMatch(readme,/^## Estado atual —/m,
  'Do not label old historical milestones as the currently deployed application');
assert.match(readme,/^## Registro histórico — v1\.62/m,
  'The old v1.62 current-version heading must remain explicitly historical');

for(const marker of ['main','portal-build.json','sourceSha','customer','merchant','admin','TAMÃO launch readiness','Cloudflare']){
  assert.ok(truth.includes(marker),'Release authority guide omits '+marker);
}
for(const host of ['tamao.com.br','parceiro.tamao.com.br','admin.tamao.com.br']){
  assert.ok(truth.includes('https://'+host+'/portal-build.json'),'Missing portal attest URL: '+host);
}

const entries=[...triage.matchAll(/^\| \[#(\d+)\]\(https:\/\/github\.com\/carloskk07\/gassg\/pull\/\1\) \|/gm)].map(x=>Number(x[1]));
assert.equal(entries.length,23,'Snapshot must record 23 verified open PRs on 2026-10-17');
assert.equal(new Set(entries).size,entries.length,'Duplicate PR in triage snapshot');
for(const number of [38,70,205,207,208,209,210,211,212,213,214,215,241,252]){
  assert.ok(entries.includes(number),'Historical branch requiring triage is missing: #'+number);
}
assert.match(triage,/\bdiverged\b/);
assert.match(triage,/não se comprovou/i);
console.log('Release SHA authority and legacy PR triage remain unambiguous.');
