import assert from 'node:assert/strict';
import fs from 'node:fs';
import {triageReadinessIncident} from '../scripts/triage-launch-readiness-incident.mjs';

const REPO='carloskk07/gassg';
const SHA='a'.repeat(40);
const SECOND='b'.repeat(40);
const TITLE='TAMÃO | falhas recorrentes na prontidão da produção';
const ISO_NAME='TAMÃO isolated Supabase integration';
const ISO_TITLE='TAMÃO | falha na auditoria isolada ponta a ponta';
const makeRun=(id,conclusion,sha=SHA,date='2026-10-30T12:00:00Z',
  name='TAMÃO launch readiness',event='schedule')=>({
  id,conclusion,name,event,status:'completed',head_sha:sha,head_branch:'main',
  head_repository:{full_name:REPO},created_at:date
});
const failed=[
  makeRun(100,'failure',SHA,'2026-10-30T12:00:00Z'),
  makeRun(99,'timed_out',SHA,'2026-10-30T11:40:00Z')
];
const baseEnv={
  GH_TOKEN:'token-for-tests-not-a-secret',
  TRIGGER_EVENT:'workflow_run',TRIGGER_REPO:REPO,TRIGGER_BRANCH:'main',
  TRIGGER_WORKFLOW_NAME:'TAMÃO launch readiness',
  TRIGGER_SHA:SHA,TRIGGER_RUN_ID:'100',TRIGGER_CONCLUSION:'failure'
};
function setup({runs=failed,issues=[],mainSha=SHA,historyError=false}={}){
  const calls=[],created=[];
  const request=async(url,options={})=>{
    const path=new URL(url).pathname;
    const method=options.method||'GET';
    calls.push({path,method,body:options.body});
    let data={};
    if(path==='/repos/'+REPO+'/branches/main')data={commit:{sha:mainSha}};
    else if(path.endsWith('/runs')) {
      if(historyError)return {ok:false,status:502};
      data={workflow_runs:runs};
    }else if(path==='/search/issues')data={items:issues};
    else if(path==='/repos/'+REPO+'/issues'&&method==='POST'){
      const item=JSON.parse(options.body);
      created.push(item);
      data={number:701};
    }else throw Error('Unexpected GitHub API call '+method+' '+path);
    return {ok:true,status:200,json:async()=>data};
  };
  return {calls,created,request};
}
async function check(config={},env=baseEnv){
  const box=setup(config);
  const output=await triageReadinessIncident({env,request:box.request});
  return {...box,output};
}
const invalid=await check({}, {...baseEnv,TRIGGER_REPO:'other/repo'});
assert.equal(invalid.output.status,'skipped_untrusted_or_successful_trigger');
assert.equal(invalid.calls.length,0);
for(const bad of [
  {...baseEnv,TRIGGER_CONCLUSION:'success'},
  {...baseEnv,TRIGGER_SHA:'invalid'},
  {...baseEnv,TRIGGER_RUN_ID:'not-a-number'},
  {...baseEnv,TRIGGER_BRANCH:'dev'},
  {...baseEnv,TRIGGER_EVENT:'pull_request'},
  {...baseEnv,TRIGGER_WORKFLOW_NAME:'Untrusted workflow'},
  {...baseEnv,TRIGGER_WORKFLOW_NAME:'__proto__'}
]){
  const r=await check({},bad);
  assert.equal(r.calls.length,0,'untrusted events never touch API');
}
let r=await check({mainSha:SECOND});
assert.equal(r.output.status,'skipped_superseded_main');
assert.equal(r.created.length,0);
r=await check({runs:[failed[0],makeRun(99,'success')]});
assert.equal(r.output.status,'waiting_for_second_consecutive_failure');
assert.equal(r.created.length,0);
r=await check({runs:[failed[1],failed[0]]});
assert.equal(r.output.status,'created_issue','sort by date, not array order');
r=await check({runs:[makeRun(101,'failure',SHA,'2026-10-30T12:20:00Z'),...failed]});
assert.equal(r.output.status,'skipped_not_latest');
assert.equal(r.created.length,0);
r=await check({runs:[failed[0]]});
assert.equal(r.output.status,'waiting_for_second_consecutive_failure');
r=await check({issues:[{number:71,state:'open',title:TITLE}]});
assert.equal(r.output.status,'existing_issue');
assert.equal(r.output.number,71);
assert.equal(r.created.length,0,'no duplicate issue');
r=await check({issues:[{number:71,state:'closed',title:TITLE},{number:72,state:'open',title:'Other'}]});
assert.equal(r.output.status,'created_issue');
assert.equal(r.created.length,1);
const {title,body}=r.created[0];
assert.equal(title,TITLE);
assert.match(body,/actions\/runs\/100/);
assert.match(body,/actions\/runs\/99/);
assert.match(body,/#493/);
assert.doesNotMatch(body,/token-for-tests|Authorization|support_cases|contact_value/);
assert.equal(r.calls.filter(x=>x.path==='/repos/'+REPO+'/branches/main').length,2,
  'recheck main before creating incident');
assert.ok(r.calls.every(x=>x.path.startsWith('/repos/'+REPO+'/')||x.path==='/search/issues'),
  'no database, production API or extra service touched');
await assert.rejects(
  triageReadinessIncident({env:baseEnv,request:setup({historyError:true}).request}),
  /GITHUB_API_GET_HTTP_502/
);
console.log('PASS: incident auto-triage uses two failures, exact main SHA, dedup, privacy and no production writes.');

// A daily disposable full-stack failure must create its own issue on the
// CURRENT main SHA. It never reads customer reports or production databases.
const isoEnv={...baseEnv,TRIGGER_WORKFLOW_NAME:ISO_NAME,
  TRIGGER_RUN_ID:'210',TRIGGER_CONCLUSION:'failure'};
const isoRun=makeRun(210,'failure',SHA,'2026-10-30T13:00:00Z',ISO_NAME);
r=await check({runs:[isoRun]},isoEnv);
assert.equal(r.output.status,'created_issue','one confirmed failed isolated E2E is actionable');
assert.equal(r.created.length,1);
assert.equal(r.created[0].title,ISO_TITLE);
assert.match(r.created[0].body,/ambiente descartável/);
assert.match(r.created[0].body,/actions\/runs\/210/);
assert.doesNotMatch(r.created[0].body,/Execução anterior|token-for-tests|contact_value|PRIVATE|merchant_id/);
assert.equal(r.calls.some(c=>c.path.includes('isolated-supabase-integration.yml')),true,
  'historical evidence must come only from the existing integration workflow');
const noDuplicate=await check({runs:[isoRun],
  issues:[{number:90,state:'open',title:ISO_TITLE}]},isoEnv);
assert.equal(noDuplicate.output.status,'existing_issue');
assert.equal(noDuplicate.created.length,0);
const wrongSource=await check({runs:[
  makeRun(210,'failure',SHA,'2026-10-30T13:00:00Z',ISO_NAME,'pull_request')
]},isoEnv);
assert.equal(wrongSource.output.status,'skipped_not_latest',
  'a PR result cannot masquerade as the scheduled main integration');
assert.equal(wrongSource.created.length,0);
const wrongIdentity=await check({runs:[makeRun(210,'failure',SHA,
  '2026-10-30T13:00:00Z','Another workflow','schedule')]},isoEnv);
assert.equal(wrongIdentity.output.status,'skipped_not_latest');
assert.equal(wrongIdentity.created.length,0);
const healthyISO=await check({runs:[makeRun(210,'success',SHA,
  '2026-10-30T13:00:00Z',ISO_NAME)]},isoEnv);
assert.equal(healthyISO.output.status,'skipped_successful_latest_run');
assert.equal(healthyISO.created.length,0);
// Prevent future regressions that turn disposable tests into real transactions.
const integration=fs.readFileSync(new URL('../.github/workflows/isolated-supabase-integration.yml',import.meta.url),'utf8');
const triage=fs.readFileSync(new URL('../.github/workflows/readiness-incident-triage.yml',import.meta.url),'utf8');
assert.match(integration,/schedule:\s*\n\s*- cron: '23 4 \* \* \*'/);
assert.match(integration,/SUPABASE_ACCESS_TOKEN: ''/);
assert.match(integration,/SUPABASE_DB_PASSWORD: ''/);
assert.match(integration,/supabase stop --no-backup/);
assert.match(integration,/tests\/isolated-support-positive-journey\.mjs/);
assert.match(integration,/tests\/isolated-supabase-coupon-full-schema\.mjs/);
assert.match(triage,/TAMÃO isolated Supabase integration/);
assert.match(triage,/TRIGGER_WORKFLOW_NAME:/);
assert.ok(!integration.includes('${{ secrets.'), 'scheduled tests must not receive secret credentials');
console.log('PASS: daily synthetic E2E schedule + sanitized issue triage, exact SHA, dedup, no secret or production access.');
