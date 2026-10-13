// V1.217 — Reconcile an earlier red Cloudflare native deployment only when
// the strict OIDC-backed readiness workflow later proves the exact live main SHA.
// This never deploys a file, changes a secret, or treats stale builds as current.
import {pathToFileURL} from 'node:url';

const REPO='carloskk07/gassg';
const DEPLOY_WORKFLOW='cloudflare-production-deploy.yml';
// First attempt + at most one automatic rerun. Persistent failures need human review.
const MAX_RUN_ATTEMPTS=2;
const SHA_RE=/^[0-9a-f]{40}$/;
const base='https://api.github.com';

export async function reconcileNativeDelivery({env,request,report=()=>{}}){
  const proof={
    event:env.GITHUB_EVENT_NAME,
    repo:env.EVIDENCE_REPOSITORY,
    branch:env.EVIDENCE_BRANCH,
    conclusion:env.EVIDENCE_CONCLUSION,
    sha:env.EVIDENCE_SHA
  };
  // Fail closed on missing or counterfeit trigger context.
  if(proof.event!=='workflow_run'||proof.repo!==REPO||proof.branch!=='main'||
     proof.conclusion!=='success'||!SHA_RE.test(String(proof.sha||''))){
    return {status:'skipped_invalid_proof'};
  }
  const token=String(env.GH_TOKEN||'');
  if(token.length<8)throw new Error('GITHUB_ACTIONS_TOKEN_NOT_AVAILABLE');
  const path='/repos/'+REPO;
  const fetchAPI=async(route,method='GET')=>{
    const url=base+path+route;
    const response=await request(url,{
      method,
      headers:{Accept:'application/vnd.github+json',
        Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28'}
    });
    if(!response||typeof response.status!=='number')
      throw new Error('GITHUB_API_RESPONSE_UNVERIFIED');
    if(!response.ok){
      // Never include response body or token in job logs.
      throw new Error('GITHUB_API_HTTP_'+response.status+'_FOR_'+method);
    }
    return method==='POST'?null:await response.json();
  };
  const main=await fetchAPI('/branches/main');
  const canonical=String(main?.commit?.sha||'');
  if(!SHA_RE.test(canonical))throw new Error('CANONICAL_BRANCH_SHA_UNVERIFIED');
  if(canonical!==proof.sha){
    report('A newer main exists. No old run was retried.');
    return {status:'skipped_superseded'};
  }
  const data=await fetchAPI('/actions/workflows/'+DEPLOY_WORKFLOW+
    '/runs?branch=main&per_page=25');
  if(!Array.isArray(data?.workflow_runs))
    throw new Error('DEPLOYMENT_HISTORY_UNVERIFIED');
  // Only the most recent run for the exact canonical commit may be considered.
  const matches=data.workflow_runs.filter(run=>run?.head_sha===canonical&&
    run?.head_branch==='main'&&Number.isSafeInteger(run?.id)&&run.id>0&&
    typeof run.created_at==='string'&&Number.isFinite(Date.parse(run.created_at)));
  matches.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||
    b.id-a.id);
  const latest=matches[0];
  if(!latest){
    report('No matching production deploy run. Existing readiness remains authoritative.');
    return {status:'no_matching_deploy'};
  }
  if(latest.status!=='completed'){
    report('Production deployment still running or queued. No duplicate retry.');
    return {status:'skipped_running',runId:latest.id};
  }
  if(latest.conclusion==='success'){
    report('Cloudflare deploy already succeeded. No duplicate retry.');
    return {status:'already_reconciled',runId:latest.id};
  }
  if(latest.conclusion!=='failure'){
    return {status:'skipped_not_failed',runId:latest.id};
  }
  // Do not retry the same failed workflow indefinitely on every scheduled
  // readiness attestation. Re-read run details rather than trust a stale list.
  const detail=await fetchAPI('/actions/runs/'+latest.id);
  const authentic=detail?.id===latest.id&&detail?.head_sha===canonical&&
    detail?.head_branch==='main'&&detail?.head_repository?.full_name===REPO&&
    detail?.path==='.github/workflows/'+DEPLOY_WORKFLOW&&
    (detail?.event==='push'||detail?.event==='workflow_dispatch');
  if(!authentic){
    report('Matching deploy run identity could not be verified. No retry.');
    return {status:'skipped_unverified_run',runId:latest.id};
  }
  if(!Number.isSafeInteger(detail.run_attempt)||detail.run_attempt<1){
    report('Run attempt count unavailable. No speculative retry.');
    return {status:'skipped_attempt_unverified',runId:latest.id};
  }
  if(detail.run_attempt>=MAX_RUN_ATTEMPTS){
    report('Automatic retry already used for this run. Manual review required.');
    return {status:'retry_limit_reached',runId:latest.id};
  }
  if(detail.status!=='completed'||detail.conclusion!=='failure'){
    report('Run changed while inspecting deployment history. No retry.');
    return {status:'skipped_changed_run',runId:latest.id};
  }
  // Recheck the canonical branch after inspection to reduce TOCTOU risk.
  const now=await fetchAPI('/branches/main');
  if(now?.commit?.sha!==canonical){
    return {status:'skipped_superseded'};
  }
  // GitHub re-runs the original job; its own branch/SHA/source gate remains intact.
  // No public deployment or Cloudflare credentials are supplied by this workflow.
  await fetchAPI('/actions/runs/'+latest.id+'/rerun-failed-jobs','POST');
  report('Previously failed deploy run re-queued after strict same-SHA readiness.');
  return {status:'rerun_requested',runId:latest.id};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=await reconcileNativeDelivery({
      env:process.env,
      request:fetch,
      report:message=>console.log(message)
    });
    console.log('CF_NATIVE_RECONCILE='+result.status+
      (result.runId?' RUN_ID='+result.runId:''));
  }catch(error){
    console.error('::error::Cloudflare reconcile failed: '+
      String(error?.message||'RECONCILE_UNVERIFIED').replace(/[^A-Za-z0-9 _.-]/g,''));
    process.exitCode=1;
  }
}
