// Best-effort supplemental trigger; never writes attestation or enables commerce.
import {pathToFileURL} from 'node:url';
const REPO='carloskk07/gassg';
const TARGET='launch-readiness.yml';
const PATH='.github/workflows/'+TARGET;
const TRIGGERS=new Set(['TAMÃO city expansion sync','TAMÃO isolated Supabase integration']);
const SHA=/^[a-f0-9]{40}$/;
const MINUTE=60000;
const date=value=>typeof value==='string'?Date.parse(value):NaN;
export async function refreshReadiness({env,event,request,now=Date.now()}){
 const upstream=event?.workflow_run;
 if(env.GITHUB_EVENT_NAME!=='workflow_run'||env.GITHUB_REPOSITORY!==REPO||
    event?.action!=='completed'||!TRIGGERS.has(upstream?.name)||
    upstream?.event!=='schedule'||upstream?.head_repository?.full_name!==REPO||
    upstream?.head_branch!=='main'||upstream?.status!=='completed'||
    !SHA.test(upstream?.head_sha||'')||!SHA.test(env.GITHUB_SHA||''))return 'skipped_untrusted';
 const token=env.GH_TOKEN;
 if(typeof token!=='string'||token.length<8)throw Error('WATCHDOG_TOKEN_MISSING');
 const api=async(route,method='GET',body)=>{
  const res=await request('https://api.github.com/repos/'+REPO+route,{
   method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,
    'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error'});
  if(!res?.ok)throw Error('WATCHDOG_API_'+method+'_'+(Number.isInteger(res?.status)?res.status:'UNKNOWN'));
  return method==='POST'?null:res.json();
 };
 const main=async()=>{const sha=(await api('/branches/main'))?.commit?.sha;
  if(!SHA.test(sha||''))throw Error('WATCHDOG_MAIN_UNVERIFIED');return sha;};
 const canonical=await main();
 if(canonical!==upstream.head_sha||canonical!==env.GITHUB_SHA)return 'skipped_superseded';
 const data=await api('/actions/workflows/'+TARGET+'/runs?branch=main&per_page=50');
 if(!Array.isArray(data?.workflow_runs)||data.workflow_runs.length>50)throw Error('WATCHDOG_HISTORY_UNVERIFIED');
 const runs=data.workflow_runs.filter(x=>x?.head_sha===canonical&&x?.head_branch==='main');
 if(runs.some(x=>x.path!==PATH||x.head_repository?.full_name!==REPO||
  !['schedule','push','workflow_dispatch'].includes(x.event)||!Number.isSafeInteger(x.id)||x.id<1||
  !Number.isFinite(date(x.created_at))||date(x.created_at)>now+MINUTE))
  throw Error('WATCHDOG_RUN_IDENTITY_UNVERIFIED');
 if(new Set(runs.map(x=>x.id)).size!==runs.length)throw Error('WATCHDOG_DUPLICATE_RUN');
 if(runs.some(x=>x.status!=='completed')){
  if(runs.some(x=>x.status!=='completed'&&now-date(x.created_at)>60*MINUTE))throw Error('WATCHDOG_ACTIVE_RUN_STALE');
  return 'skipped_in_progress';
 }
 const successful=runs.filter(x=>x.conclusion==='success');
 if(successful.some(x=>!Number.isFinite(date(x.run_started_at))||date(x.run_started_at)>now+MINUTE))
  throw Error('WATCHDOG_SUCCESS_TIME_UNVERIFIED');
 if(successful.some(x=>now-date(x.run_started_at)<40*MINUTE))return 'skipped_recent_success';
 if(runs.some(x=>now-date(x.created_at)<20*MINUTE))return 'skipped_cooldown';
 if(await main()!==canonical)return 'skipped_superseded';
 // GitHub's own token is permitted to trigger workflow_dispatch. Only the
 // original trusted workflow performs fresh OIDC-backed verification.
 await api('/actions/workflows/'+TARGET+'/dispatches','POST',{ref:'main'});
 return 'dispatch_requested';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const {readFile}=await import('node:fs/promises');
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const result=await refreshReadiness({env:process.env,event,request:fetch});
  console.log('READINESS_WATCHDOG='+result);
 }catch(e){const code=String(e?.message||'').match(/^WATCHDOG_[A-Z0-9_]+$/)?.[0]||'WATCHDOG_UNEXPECTED_FAILURE';
  console.error('::error::'+code);process.exitCode=1;}
}
