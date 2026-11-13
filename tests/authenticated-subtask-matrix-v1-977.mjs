import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('tests/isolated-authenticated-screens-v1-973.mjs');
const workflow=read('.github/workflows/audit.yml');
const needed=['support','partners-applications','partners-verification',
 'ads-finance','ads-refunds','ads-diagnostics','growth-benefits','growth-budget',
 'finance-billing','finance-homologation','finance-reconciliation'];
for(const id of needed)assert.match(source,new RegExp("'"+id+"'"));
for(const area of ['start','setup','growth','settings','finance'])
 assert.match(source,new RegExp("'"+area+"'"));
assert.match(source,/adminTaskNavChoices\(\)/);
assert.match(source,/adminSelectTaskFromUi\(\)/);
assert.match(source,/adminCurrentTaskFromState\(\)/);
assert.match(source,/merchantWorkspaceJump\(/);
assert.match(source,/assert\.deepEqual\(data\.unnamed,\[\]/);
assert.match(source,/assert\.equal\(data\.unbuttoned,0/);
assert.match(source,/Emulation\.setDeviceMetricsOverride/);
assert.match(source,/adminRoleCanSection/);
assert.match(source,/assert\.ok\(data\.scrollWidth<=data\.viewport\+3/);
const critical=source.slice(source.indexOf('for(const taskId of ADMIN_SUBTASKS)'),
 source.indexOf('// Log diagnostics even if'));
assert.doesNotMatch(critical,/adminPerform\(|merchantPerformAction\(|createPayment|submit|deletePayment|generatePix/i);
assert.match(workflow,/node tests\/authenticated-subtask-matrix-v1-977.mjs/);
console.log('V1.977 PASS: protected role-aware Admin and merchant subtask matrix is read-only and enforces accessible, responsive states.');
