import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Recovered from historical PR #73, as a standalone regression gate.
// SQL syntax is validated statically; this test NEVER connects to a database.
export function assertSqlFunctionTerminators(sql,name){
  const opening=/\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/ig;
  let count=0,match;
  while((match=opening.exec(sql))!==null){
    const tag=match[1];
    const close=sql.indexOf(tag,opening.lastIndex);
    assert.ok(close>=0,name+': unclosed SQL function body '+tag);
    assert.match(sql.slice(close+tag.length),/^[ \t\r\n]*;/,
      name+': missing semicolon immediately after function body '+tag);
    opening.lastIndex=close+tag.length;
    count++;
  }
  return count;
}
const valid=[
  'create function public.ok() returns integer language plpgsql AS $function$ begin return 1; end $function$;',
  'create function public.ok() returns integer language sql AS $$ select 1 $$ ;',
  'create function public.ok() returns integer language sql AS $long_tag$ select 1 $long_tag$\n;'
];
for(const [i,fixture] of valid.entries())assert.equal(assertSqlFunctionTerminators(fixture,'valid-'+i),1);
for(const fixture of [
  'create function public.bad() returns integer language plpgsql AS $function$ begin return 1; end $function$\n',
  'create function public.bad() returns integer language sql AS $$ select 1 $$\ncreate table x(y int);',
  'create function public.bad() returns integer language sql AS $wrong$ select 1 $different$;'
]){
  assert.throws(()=>assertSqlFunctionTerminators(fixture,'bad fixture'),
    /missing semicolon|unclosed SQL function body/);
}

const directory=new URL('../supabase/migrations/',import.meta.url);
let files=0,bodies=0;
for(const filename of fs.readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
  const sql=fs.readFileSync(new URL(filename,directory),'utf8');
  bodies+=assertSqlFunctionTerminators(sql,path.join('supabase/migrations',filename));
  files++;
}
assert.ok(files>0,'No migrations scanned');
assert.ok(bodies>0,'No SQL function bodies scanned');
console.log('SQL function terminator gate passed: '+bodies+' dollar-quoted bodies in '+files+' migrations.');
