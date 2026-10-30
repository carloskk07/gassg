// TAMÃO #493 — turn a verified, recurrent production readiness failure into
// one tracked GitHub issue. No user reports, credentials, DB rows or logs are read.
import {pathToFileURL} from 'node:url';

const REPO='carloskk07/gassg';
const WORKFLOW='launch-readiness.yml';
const TITLE='TAMÃO | falhas recorrentes na prontidão da produção';
const SHA=/^[0-9a-f]{40}$/;
const BAD=new Set(['failure','timed_out']);

export async function triageReadinessIncident({env,request,report=()=>{}}){
  const proof={
    event:env.TRIGGER_EVENT,
    repo:env.TRIGGER_REPO,
    branch:env.TRIGGER_BRANCH,
    sha:env.TRIGGER_SHA,
    outcome:env.TRIGGER_CONCLUSION,
    id:Number(env.TRIGGER_RUN_ID)
  };
  if(proof.event!=='workflow_run'||proof.repo!==REPO||
    proof.branch!=='main'||!SHA.test(String(proof.sha||''))||
    !Number.isSafeInteger(proof.id)||proof.id<=0||!BAD.has(proof.outcome)){
    return {status:'skipped_untrusted_or_successful_trigger'};
  }
  const token=String(env.GH_TOKEN||'');
  if(token.length<8)throw Error('GITHUB_TOKEN_UNAVAILABLE');
  async function github(path,{method='GET',body}={}){
    const response=await request('https://api.github.com'+path,{
      method,
      headers:{
        Accept:'application/vnd.github+json',
        Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28',
        ...(body?{'Content-Type':'application/json'}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!response?.ok)throw Error('GITHUB_API_'+method+'_HTTP_'+(response?.status||'UNAVAILABLE'));
    return response.json();
  }
  const root='/repos/'+REPO;
  const main=await github(root+'/branches/main');
  if(!SHA.test(String(main?.commit?.sha||''))||main.commit.sha!==proof.sha){
    return {status:'skipped_superseded_main'};
  }
  const history=await github(root+'/actions/workflows/'+WORKFLOW+
    '/runs?branch=main&per_page=30');
  if(!Array.isArray(history?.workflow_runs))throw Error('WORKFLOW_HISTORY_UNVERIFIED');
  const runs=history.workflow_runs
    .filter(run=>run?.head_sha===proof.sha&&run?.head_branch==='main'&&
      run?.head_repository?.full_name===REPO&&run?.status==='completed'&&
      Number.isSafeInteger(run?.id)&&run.id>0&&
      Number.isFinite(Date.parse(run.created_at||'')))
    .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
  if(runs[0]?.id!==proof.id)return {status:'skipped_not_latest'};
  if(runs.length<2||!BAD.has(runs[0]?.conclusion)||!BAD.has(runs[1]?.conclusion)){
    return {status:'waiting_for_second_consecutive_failure'};
  }
  // Search for an exact open issue, never close or overwrite past diagnoses.
  const query=encodeURIComponent('repo:'+REPO+' is:issue is:open in:title "TAMÃO" "prontidão"');
  const issues=await github('/search/issues?q='+query+'&per_page=100');
  if(!Array.isArray(issues?.items))throw Error('ISSUE_SEARCH_UNVERIFIED');
  const open=issues.items.find(item=>item?.title===TITLE&&item?.state==='open');
  if(open){report('Existing readiness incident remains open.');return {status:'existing_issue',number:open.number};}
  // Recheck the canonical source immediately before writing.
  const latestMain=await github(root+'/branches/main');
  if(latestMain?.commit?.sha!==proof.sha)return {status:'skipped_superseded_main'};
  const makeRunUrl=id=>'https://github.com/'+REPO+'/actions/runs/'+id;
  const body=[
    '## Incidente automático — prontidão técnica do TAMÃO',
    '',
    'Dois workflows consecutivos de **TAMÃO launch readiness** falharam na mesma versão oficial. Isto é sinal técnico a investigar, **não** prova que o site está fora do ar, nem autoriza alterar financeiro ou dados reais.',
    '',
    '- SHA oficial: `'+proof.sha+'`',
    '- Execução mais recente: '+makeRunUrl(runs[0].id),
    '- Execução anterior: '+makeRunUrl(runs[1].id),
    '',
    '### Verificação e resolução',
    '1. Consultar somente logs autorizados das execuções e reproduzir o problema.',
    '2. Identificar módulo/etapa e causa com evidências; distinguir falha intermitente de defeito.',
    '3. Corrigir em branch e validar testes antes do merge e do deploy.',
    '4. Confirmar novamente os três portais, o backend e a atestação OIDC; fechar manualmente após evidências.',
    '',
    '**Privacidade:** nenhum relato, contato de usuário, token, log bruto ou dado de pedido foi copiado para esta issue.',
    '**Segurança:** esta automação não altera Supabase, não publica código e não executa transações.',
    '',
    'Referência: #493.'
  ].join('\n');
  const created=await github(root+'/issues',{method:'POST',body:{title:TITLE,body}});
  if(!Number.isSafeInteger(created?.number)||created.number<=0)throw Error('ISSUE_CREATION_UNVERIFIED');
  report('Tracked recurring production readiness failure.');
  return {status:'created_issue',number:created.number};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=await triageReadinessIncident({
      env:process.env,request:fetch,
      report:message=>console.log(message)
    });
    console.log('TAMAO_HEALTH_TRIAGE='+result.status+
      (result.number?' ISSUE_NUMBER='+result.number:''));
  }catch(error){
    // No response body, request body or token is ever logged.
    console.error('::error::TAMÃO readiness triage: '+
      String(error?.message||'UNVERIFIED').replace(/[^A-Za-z0-9_. -]/g,''));
    process.exitCode=1;
  }
}
