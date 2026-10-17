import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('scripts/audit-legacy-sql-provenance-v1-399.sql');
const notes=read('docs/legacy-sql-provenance-2026-10-17.md');

// Never permit a supposedly diagnostic query to turn into a database write.
const withoutComments=sql.replace(/--[^\n]*/g,'');
const normalized=withoutComments.replace(/'[^']*'/g,"''");
assert.match(normalized,/\bwith\s+historical\s*\(/i);
assert.match(normalized,/\bselect\s+h\.pr_number/i);
assert.doesNotMatch(normalized,/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|call|execute|copy)\b/i);
assert.match(normalized,/supabase_migrations\.schema_migrations/);
assert.match(normalized,/has_function_privilege/);
assert.match(normalized,/pg_proc/);
assert.match(normalized,/pg_namespace/);

const pairs=[...sql.matchAll(/^\s*\((38|82|205|207|208|209),\s*'(20\d{12})'/gm)]
  .map(match=>({pr:Number(match[1]),version:match[2]}));
assert.deepEqual(pairs,[
  {pr:38,version:'20261003060000'},
  {pr:82,version:'20261005120500'},
  {pr:205,version:'20261011043000'},
  {pr:207,version:'20261011063000'},
  {pr:208,version:'20261011073000'},
  {pr:209,version:'20261011083000'}
]);
for(const {pr,version} of pairs){
  assert.ok(notes.includes('[#'+pr+'](https://github.com/carloskk07/gassg/pull/'+pr+')'));
  assert.ok(notes.includes(version),'Missing historical version in provenance record');
}
assert.match(notes,/não executar nem reaplicar/i);
assert.match(notes,/não comprova/i);
console.log('Legacy SQL provenance query is read-only and covers six reconciliations.');
