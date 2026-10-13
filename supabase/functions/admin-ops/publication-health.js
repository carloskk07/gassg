export const WORKFLOW_NAMES=['TAMÃO Cloudflare official production deploy','TAMÃO launch readiness'];
const shaOk=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const sha12=x=>shaOk(x)?x.slice(0,12):'não confirmado';
// Guidance contains no privileged operations. It is deliberately human-readable
// and may be used by the UI without granting extra backend capabilities.
function publicationRecoveryGuidance({sha,githubError,complete,portalSha,probes,
  oidc,fresh,dbOk,readiness,attestation,workflows}){
 const guidance=[];
 const add=(code,level,problem,impact,action,recoveryCriteria)=>{
   guidance.push({code,level,problem,impact,action,recoveryCriteria,requiresHumanReview:true});
 };
 if(!sha||githubError){
   add('GITHUB_SOURCE_UNAVAILABLE','warning','Versão oficial não confirmada',
     'Não é possível comparar a publicação com o código oficial.',
     'Conferir o acesso à API pública do GitHub e atualizar o diagnóstico. Não iniciar uma republicação baseada apenas nesta falha.',
     'A branch principal precisa retornar um SHA válido e verificável.');
 }
 if(!complete){
   const missing=['customer','merchant','admin'].filter(role=>
     !probes.some(p=>p?.role===role&&p.ok===true&&shaOk(p.sourceSha)));
   add('PORTAL_EVIDENCE_INCOMPLETE','high','Evidências incompletas nos portais',
     'Não há confirmação uniforme do site do cliente, revenda e administração.',
     'Consultar a execução de publicação e conferir as configurações e o portal-build.json dos portais com falha: '+missing.join(', ')+'.',
     'Os três portais precisam passar nas provas de papel, origem, runtime, Turnstile e SHA.');
 }else if(!portalSha){
   add('PORTAL_VERSION_SPLIT','high','Portais com versões diferentes',
     'Clientes, revendas e administradores podem receber versões distintas da plataforma.',
     'Conferir a entrega nativa do Cloudflare nos três projetos e a execução de publicação; investigar o descompasso antes de qualquer repetição manual.',
     'Os três portais precisam apresentar o mesmo SHA canônico do GitHub.');
 }else if(sha&&portalSha!==sha){
   add('PORTAL_VERSION_BEHIND','high','Cloudflare ainda não acompanha o GitHub',
     'O código publicado é diferente da versão integrada à branch principal.',
     'Conferir a publicação do commit '+sha12(sha)+' nos três projetos Cloudflare e verificar se a propagação terminou.',
     'Todos os portais precisam retornar exatamente o SHA '+sha12(sha)+'.');
 }
 if(!dbOk){
   const sourceValid=oidc===true;
   const problem=!sourceValid?'Atestação OIDC ausente ou não confiável':
     !fresh?'Atestação OIDC vencida':
     'Atestação OIDC diferente da publicação atual';
   const impact='O Supabase ainda não fornece prova recente e consistente da versão publicada.';
   const action=!sourceValid?'Conferir a execução TAMÃO launch readiness e o atestador no Supabase; não aceitar comprovação manual como substituta.':
     !fresh?'Conferir a renovação periódica do workflow de prontidão e o registro recente da Edge Function.':
     'Comparar o SHA da última atestação, o commit principal e o estado portalsFresh no banco.';
   add('OIDC_ATTESTATION_NOT_VERIFIED','high',problem,impact,action,
     'Uma nova prova GitHub OIDC válida deve registrar o SHA canônico atual e prontidão recente para os três portais.');
 }
 for(const item of workflows){
   if(item.status==='ok')continue;
   if(item.status==='attention'){
     add('GITHUB_WORKFLOW_FAILED','high','Falha na rotina: '+item.name,
       'Uma etapa de publicação ou verificação não foi concluída com sucesso.',
       'Abrir a execução oficial, identificar a etapa com falha e corrigir a causa antes de solicitar nova execução.',
       'A execução oficial para o commit atual precisa terminar com sucesso.');
   }else if(item.status==='checking'){
     add('GITHUB_WORKFLOW_RUNNING','info','Verificação em andamento: '+item.name,
       'A comprovação automática ainda está sendo processada.',
       'Acompanhar a execução oficial e atualizar o diagnóstico após sua conclusão.',
       'A execução precisa terminar com sucesso para o SHA da branch principal.');
   }else{
     add('GITHUB_WORKFLOW_UNVERIFIED','warning','Execução oficial não localizada: '+item.name,
       'Falta evidência de uma etapa obrigatória da publicação.',
       'Conferir o histórico do GitHub Actions para a branch principal e o commit exibido; não presumir sucesso.',
       'Uma execução correspondente e concluída com sucesso precisa ser localizada.');
   }
 }
 return guidance;
}

export function publicationSummary({headSha,runs,portals,readiness,attestation,githubError,checkedAt}){
 const sha=shaOk(headSha)?headSha:null;
 const probes=Array.isArray(portals?.probes)?portals.probes:[];
 const roles=['customer','merchant','admin'];
 const complete=probes.length===3&&roles.every(role=>probes.filter(p=>p?.role===role&&p.ok===true&&shaOk(p.sourceSha)).length===1);
 const versions=[...new Set(probes.filter(p=>p.ok&&shaOk(p.sourceSha)).map(p=>p.sourceSha))];
 const portalSha=complete&&versions.length===1?versions[0]:null;
 const verifiedAt=Date.parse(String(attestation?.verified_at||''));
 const observedAt=Date.parse(checkedAt);
 const fresh=Number.isFinite(verifiedAt)&&Number.isFinite(observedAt)&&verifiedAt<=observedAt+300000&&observedAt-verifiedAt<=3600000;
 const oidc=attestation?.attestation_source==='github_oidc_edge'&&Number.isSafeInteger(Number(attestation?.run_id))&&Number(attestation?.run_id)>0&&Number.isSafeInteger(Number(attestation?.run_attempt))&&Number(attestation?.run_attempt)>0;
 const dbOk=oidc&&fresh&&!!sha&&portalSha===sha&&attestation?.source_sha===sha&&readiness?.portalsFresh===true&&readiness?.portalsSourceSha===sha;
 const workflows=WORKFLOW_NAMES.map(name=>{
   const matches=(Array.isArray(runs)?runs:[]).filter(r=>r?.name===name&&r?.head_sha===sha&&r?.head_branch==='main'&&r?.head_repository?.full_name==='carloskk07/gassg'&&Number.isSafeInteger(r?.id)&&r.id>0&&Number.isFinite(Date.parse(r.created_at||'')));
   matches.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
   const latest=matches[0];
   return {name,status:!latest?'unknown':latest.status!=='completed'?'checking':latest.conclusion==='success'?'ok':'attention',url:latest?'https://github.com/carloskk07/gassg/actions/runs/'+latest.id:null};
 });
 const issues=[];
 if(!sha||githubError)issues.push('Versão oficial do GitHub não comprovada');
 if(!portalSha)issues.push('Os três portais não apresentaram versão consistente');
 else if(sha&&sha!==portalSha)issues.push('Portais diferentes da versão oficial');
 if(!dbOk)issues.push('Atestação OIDC ausente, vencida ou divergente');
 if(workflows.some(w=>w.status==='attention'))issues.push('Falha registrada no GitHub Actions');
 if(workflows.some(w=>w.status==='unknown'))issues.push('GitHub Actions sem comprovação suficiente');
 if(workflows.some(w=>w.status==='checking'))issues.push('Verificação do GitHub em andamento');
 const critical=(!portalSha)||(sha&&sha!==portalSha)||(!dbOk&&!!sha&&portalSha===sha)||workflows.some(w=>w.status==='attention');
 const status=critical?'attention':(!sha||githubError||workflows.some(w=>w.status==='unknown'))?'unverified':workflows.some(w=>w.status==='checking')?'checking':'healthy';
 const checks=[
  {id:'github',label:'GitHub principal',ok:!!sha&&!githubError,evidence:sha12(sha)},
  {id:'cloudflare',label:'Três portais Cloudflare',ok:!!sha&&complete&&portalSha===sha,evidence:sha12(portalSha)},
  {id:'oidc',label:'Atestação OIDC Supabase',ok:!!dbOk,evidence:fresh?'Registro recente conferido':'Registro não comprovado'},
  {id:'workflows',label:'Publicação e prontidão GitHub',ok:workflows.every(w=>w.status==='ok'),evidence:workflows.every(w=>w.status==='ok')?'Duas execuções aprovadas':'Execuções pendentes ou não confirmadas'}
 ];
 const guidance=publicationRecoveryGuidance({sha,githubError,complete,portalSha,probes,oidc,fresh,
   dbOk,readiness,attestation,workflows});
 const recovery={verified:status==='healthy'&&checks.every(c=>c.ok)&&guidance.length===0,
   checkedAt,sourceSha:sha,checks,
   // A consistent snapshot proves current health, not when the incident ended.
   historicalRestorationProven:false};
 return {source:'publication_v1_220',readOnly:true,status,checkedAt,headSha:sha,
   portals:{sourceSha:portalSha,probes:roles.map(role=>{const p=probes.find(x=>x.role===role);return {role,ok:p?.ok===true,sourceSha:shaOk(p?.sourceSha)?p.sourceSha:null};})},
   attestation:{status:dbOk?'ok':'attention',sourceSha:shaOk(attestation?.source_sha)?attestation.source_sha:null,verifiedAt:attestation?.verified_at||null,fresh,oidc},
   workflows,issues,guidance,recovery};
}