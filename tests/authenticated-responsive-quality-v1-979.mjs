import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const browser=read('tests/isolated-authenticated-screens-v1-973.mjs');
const audit=read('.github/workflows/audit.yml');
const workspaceCss=read('css/workspace-experience.css');
assert.match(workspaceCss,/@media\(max-width:360px\)/);
assert.match(workspaceCss,/\.merchant-workspace \.merchant-closed-order-row\{/);
assert.match(workspaceCss,/grid-template-columns:minmax\(0,1fr\) minmax\(0,40%\)/);
assert.match(workspaceCss,/overflow-wrap:anywhere;font-variant-numeric:tabular-nums/);
assert.doesNotMatch(workspaceCss,/\.merchant-closed-order-row[^}]*text-overflow:ellipsis/);

assert.match(workspaceCss,/max-width:calc\(100vw - 24px\)/);
assert.match(workspaceCss,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
for(const value of ['width:320','width:360','width:768','width:1280','width:1920'])
 assert.ok(browser.includes(value),'Viewport matrix missing '+value);
assert.match(browser,/assert\.equal\(data\.headingCount,1/);
assert.match(browser,/assert\.deepEqual\(data\.dup,\[\]/);
assert.match(browser,/assert\.deepEqual\(data\.unnamed,\[\]/);
assert.match(browser,/assert\.equal\(data\.unbuttoned,0/);
assert.match(browser,/assert\.ok\(data\.scrollWidth<=data\.viewport\+3/);
assert.match(browser,/assert\.equal\(jump\.focused,true/);
assert.match(browser,/assert\.equal\(jump\.expanded,true/);
assert.match(browser,/assert\.equal\(jump\.parentsOpen,true/);
assert.match(browser,/Emulation\.setDeviceMetricsOverride/);
assert.match(browser,/adminRoleCanSection/);
const subtaskSection=browser.slice(
 browser.indexOf('for(const taskId of ADMIN_SUBTASKS)'),
 browser.indexOf('// Log diagnostics even if'));
assert.doesNotMatch(subtaskSection,/adminPerform\(|merchantPerformAction\(|generatePix|createPayment|submitOrder/i);
assert.match(audit,/node tests\/authenticated-responsive-quality-v1-979\.mjs/);
console.log('V1.979 PASS: five real Chromium widths and Partner focus for all authorized workspaces.');
