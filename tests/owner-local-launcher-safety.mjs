import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

const repo=path.resolve('.');
const launcher=fs.readFileSync(path.join(repo,'scripts/run-owner-local-demo.sh'),'utf8');
assert.match(launcher,/git -C "\$repo" archive --format=tar HEAD \| tar -xf - -C "\$workspace"/);
assert.match(launcher,/com\.docker\.network\.bridge\.host_binding_ipv4=127\.0\.0\.1/);
assert.match(launcher,/supabase start --network-id "\$network"/);
assert.doesNotMatch(launcher,/sort\s*\|\s*head\s+-n\s*1/,'canonical migration check must not risk SIGPIPE with pipefail');
assert.doesNotMatch(launcher,/rm -rf -- supabase\/migrations/,'never rewrite original checkout');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-launcher-guard-'));
const fixture=path.join(tmp,'checkout'),bin=path.join(tmp,'fakebin'),scratch=path.join(tmp,'scratch');
fs.mkdirSync(path.join(fixture,'supabase','migrations'),{recursive:true});
fs.mkdirSync(path.join(fixture,'scripts'),{recursive:true});
fs.mkdirSync(path.join(fixture,'tests'),{recursive:true});
fs.mkdirSync(bin);fs.mkdirSync(scratch);
const log=path.join(tmp,'calls.log');
const run=(args,cwd)=>execFileSync(args[0],args.slice(1),{cwd,encoding:'utf8',
 env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'},timeout:20000});
function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data)}
write(path.join(fixture,'scripts/run-owner-local-demo.sh'),launcher);
write(path.join(fixture,'supabase/schema.sql'),'select 1;\n');
write(path.join(fixture,'supabase/config.toml'),'project_id="tamao-local-test"\n');
write(path.join(fixture,'tests/isolated-supabase-positive-checkout.mjs'),'throw Error("Never run checkout in launcher guard");\n');
for(let i=0;i<201;i++){
 const id=String(20261001070000+i).padStart(14,'0');
 const suffix=i===0?'reconcile_runtime_v1_4':'dummy_'+String(i).padStart(3,'0');
 write(path.join(fixture,'supabase/migrations',id+'_'+suffix+'.sql'),'-- test only\n');
}
const echo='echo "CALL|$PWD|$*" >> "$TAMAO_LAUNCHER_PROBE_LOG"';
const tools=[
 ['docker',['#!/usr/bin/env bash',echo.replace('CALL','docker'),
  'if [[ "$1" == info ]];then exit 0;fi',
  'if [[ "$1" == network ]];then exit 0;fi','exit 61',''].join('\n')],
 ['supabase',['#!/usr/bin/env bash',echo.replace('CALL','supabase'),
  'if [[ "$1" == status ]];then exit 1;fi',
  'if [[ "$1" == start ]];then exit 37;fi',
  'if [[ "$1" == stop ]];then exit 0;fi','exit 62',''].join('\n')],
 ['psql',['#!/usr/bin/env bash','exit 0',''].join('\n')]
];
for(const [tool,body] of tools){
 const p=path.join(bin,tool);write(p,body);fs.chmodSync(p,0o755);
}
run(['git','init','-q'],fixture);
run(['git','add','.'],fixture);
run(['git','-c','user.name=TAMAO Tests','-c','user.email=ci@example.com',
 'commit','-qm','disposable launcher fixture'],fixture);
const original=run(['git','status','--porcelain'],fixture);
const env={...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:scratch,
 TAMAO_LAUNCHER_PROBE_LOG:log,SUPABASE_ACCESS_TOKEN:'',SUPABASE_DB_PASSWORD:'',
 MERCADOPAGO_ACCESS_TOKEN:'',WOOVI_APP_ID:'',WOOVI_API_KEY:'',
 BILLING_PIX_PROVIDER:'',STRIPE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''};
try{
 const denied=spawnSync('bash',[path.join(fixture,'scripts/run-owner-local-demo.sh')],{
   cwd:fixture,env:{...env,SUPABASE_ACCESS_TOKEN:'PRODUCTION_TOKEN_MUST_BLOCK'},
   encoding:'utf8',timeout:20000
 });
 assert.notEqual(denied.status,0,'must refuse cloud token');
 assert.match(denied.stderr,/credenciais do Supabase hospedado/);
 assert.ok(!fs.existsSync(log),'must reject token before invoking Docker');
 const scenario=spawnSync('bash',[path.join(fixture,'scripts/run-owner-local-demo.sh')],{
   cwd:fixture,env,encoding:'utf8',timeout:45000
 });
 assert.equal(scenario.status,37,'mock Supabase start must fail and trigger cleanup: '+scenario.stderr);
 const actions=fs.readFileSync(log,'utf8').trim().split('\n');
 const create=actions.find(x=>x.includes('docker|')&&x.includes('network create'));
 const start=actions.find(x=>x.includes('supabase|')&&x.includes('start --network-id'));
 const stop=actions.find(x=>x.includes('supabase|')&&x.includes('stop --no-backup'));
 const remove=actions.find(x=>x.includes('docker|')&&x.includes('network rm'));
 assert.ok(create&&start&&stop&&remove,'network created/used/removed; Supabase stopped');
 assert.ok(create.includes('com.docker.network.bridge.host_binding_ipv4=127.0.0.1'),
   'Docker must bind published ports on loopback only');
 const id=create.trim().split(' ').at(-1);
 assert.match(id,/^tamao-demo-local-\d+$/);
 assert.ok(start.includes('start --network-id '+id));
 assert.ok(remove.includes('network rm '+id));
 assert.ok(start.split('|')[1].startsWith(scratch+path.sep),
   'server must start in disposable temp, not original tree');
 assert.equal(run(['git','status','--porcelain'],fixture),original,
   'original Git checkout must be unmodified');
 assert.equal(fs.readdirSync(path.join(fixture,'supabase/migrations')).filter(x=>x.endsWith('.sql')).length,201);
 assert.equal(fs.readdirSync(scratch).length,0,'archive must be cleaned up');
 console.log('PASS: owner launcher refuses cloud token, runs in disposable checkout, binds Docker to loopback, cleans stack + network on failed start.');
}finally{fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:100})}
