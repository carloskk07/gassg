import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectHistory} from '../scripts/release-migration-history.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'release/integration-v1-164.json'),'utf8'));
const expected=manifest.databaseMigrations.map(f=>{
 const match=/^(\d{14})_(.+)\.sql$/.exec(f);
 assert.ok(match,'Expected complete migration filenames');
 assert.ok(fs.existsSync(path.join(root,'supabase/migrations',f)));
 return {version:match[1],name:match[2]};
});
assert.equal(expected.length,4);
const empty=inspectHistory([]);
assert.equal(empty.status,'NOT_APPLIED');
assert.equal(empty.ok,true);
assert.equal(empty.canPublish,false,'No production migration cannot be presented as deployed');
const existingOld=[
 {version:'20261010224649',name:'merchant_guided_enablement_v1_158'},
 {version:'20261010225030',name:'merchant_guided_enablement_v1_158'}
];
assert.equal(inspectHistory(existingOld).status,'NOT_APPLIED');
const valid=inspectHistory([...existingOld,...expected]);
assert.equal(valid.status,'ALL_RECORDED');
assert.equal(valid.ok,true);
assert.equal(valid.canPublish,true);
for(let n=1;n<4;n++){
 const partial=inspectHistory([...existingOld,...expected.slice(0,n)]);
 assert.equal(partial.status,'DRIFT_BLOCKED');
 assert.equal(partial.canPublish,false);
 assert.ok(partial.errors.some(e=>e.startsWith('PARTIAL_SCHEMA')));
}
const misversion=expected.map((x,i)=>i===1?{...x,version:'20261012999999'}:x);
assert.equal(inspectHistory(misversion).status,'DRIFT_BLOCKED',
 'Timestamp drift must never silently count as an applied source migration');
const renamed=expected.map((x,i)=>i===3?{...x,name:'unexpected_renamed_migration'}:x);
assert.equal(inspectHistory(renamed).status,'DRIFT_BLOCKED');
const duplicate=inspectHistory([...expected,expected[0]]);
assert.equal(duplicate.status,'DRIFT_BLOCKED');
assert.ok(duplicate.errors.some(s=>s.includes('Duplicate')));
assert.throws(()=>inspectHistory(null));
const script=fs.readFileSync(path.join(root,'scripts/release-db-backup-checkpoint.sh'),'utf8');
for(const marker of [
 'umask 077','pg_dump --format=custom','pg_restore --list','sha256sum',
 'PGSSLMODE=require','PGPASSWORD','TAMAO_BACKUP_DIR','outside the repository',
 'VERIFY_ARCHIVE_AND_RESTORE_TO_ISOLATED_DATABASE_BEFORE_PRODUCTION_MIGRATION'
]){
 assert.ok(script.includes(marker),'Backup safeguard missing: '+marker);
}

assert.ok(!script.includes('curl -X POST')&&!script.includes('gh release upload'),
 'Database archive must never be uploaded to a public provider');
const windows=fs.readFileSync(path.join(root,'scripts/release-db-backup-windows.ps1'),'utf8');
assert.ok(!script.includes('--no-acl')&&!windows.includes('--no-acl'),
 'A recoverable backup must keep GRANT/REVOKE ACLs for an isolated Supabase restore');
for(const phrase of [
 'Read-Host', '-AsSecureString', 'ZeroFreeBSTR', 'pg_dump',
 'Find-PgTool', 'Get-FileHash', 'Remove-Item Env:PGPASSWORD',
 'PGSSLMODE', 'TAMAO', 'CheckOnly'
])assert.ok(windows.includes(phrase),'Windows backup guard missing: '+phrase);
assert.ok(windows.toLowerCase().includes('restaure') && windows.includes("Find-PgTool 'pg_restore'"),
 'Backup must instruct an isolated restore and verify archive tool');
assert.ok(!windows.includes('Write-Host $env:PGPASSWORD')&&!windows.includes('Start-Transcript'),
 'Windows flow must not leak credentials into terminal history or output');
for(const marker of [
 '[Guid]::NewGuid()', '[System.IO.File]::Move($stagingArchive, $archive)',
 '[System.IO.File]::Move($stagingHash, $hashFile)',
 '$archivePublished = $true', '$hashPublished = $true',
 'Get-FileHash -LiteralPath $archive -Algorithm SHA256',
 'Remove-Item -LiteralPath $partial'
]) assert.ok(windows.includes(marker),
 'Windows atomic backup safeguard missing: '+marker);
assert.ok(!windows.includes('& $dump --format=custom --no-owner --file=$archive'),
 'pg_dump must not write a directly publishable production checkpoint');
assert.ok(windows.includes('if ($archivePublished -and'),
 'Windows cleanup must only remove an archive published by the current run');
const runbook=fs.readFileSync(path.join(root,'release/RUNBOOK-V1-164.md'),'utf8');
assert.ok(runbook.includes('Marco A')&&runbook.includes('Marco B'));
console.log('Release recovery: schema version drift/partial migration rejected; Free-plan pg_dump safeguards and private restore checkpoint verified.');
