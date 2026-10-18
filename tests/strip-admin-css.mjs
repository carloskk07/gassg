import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripAdminOnlyCss,publicAdminClassReferences} from '../scripts/strip-admin-css.mjs';

const fixture=[
 '.visible{color:blue}',
 '.admin-private{color:red}',
 '.admin-shared{display:grid}',
 '.admin-private,.visible{font-size:16px}',
 '@media(max-width:600px){.admin-private{margin:0}.visible{margin:1px}}',
 '@supports(display:grid){.admin-private{padding:2px}}',
 '@keyframes fade{from{opacity:0}to{opacity:1}}'
].join('\n');
const value=stripAdminOnlyCss(fixture,{sharedAdminClasses:new Set(['admin-shared'])});
assert.equal(value.removedRules,3);
assert.ok(!value.css.includes('.admin-private{color:red}'));
assert.ok(value.css.includes('.admin-shared{display:grid}'));
assert.ok(value.css.includes('.admin-private,.visible{font-size:16px}'));
assert.ok(value.css.includes('.visible{margin:1px}'));
assert.ok(value.css.includes('@media(max-width:600px)'));
assert.ok(value.css.includes('@keyframes fade'));
assert.throws(()=>stripAdminOnlyCss('body{color:red'),/Unbalanced/);

const shared=publicAdminClassReferences(new URL('../js',import.meta.url));
assert.ok(shared.has('admin-entity-grid'),
  'Merchant payout reconciliation shares this visual class, preserve it');
const original=fs.readFileSync(new URL('../css/components.css',import.meta.url),'utf8');
const result=stripAdminOnlyCss(original,{sharedAdminClasses:shared});
assert.ok(result.removedBytes>65000,'Admin CSS isolation did not deliver expected reduction');
assert.ok(result.removedRules>500,'Admin CSS isolation unexpectedly lost coverage');
assert.ok(result.css.includes('.admin-entity-grid{'),'Shared merchant CSS was removed');
assert.ok(result.css.includes('.input:focus'),'Global form styles must be preserved');
assert.ok(!result.css.includes('.admin-sidebar{'),'Admin navigation CSS leaked into public bundle');
// Re-running the transform must be idempotent; no multiple iterations or
// accidental cross-release style accumulation.
const repeated=stripAdminOnlyCss(result.css,{sharedAdminClasses:shared});
assert.equal(repeated.css,result.css);
assert.equal(repeated.removedRules,0);
console.log('Conservative admin CSS isolation passed:',result.removedRules,'rules,',result.removedBytes,'bytes excluded.');
