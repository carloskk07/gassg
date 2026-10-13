export const WORKFLOW_NAMES=['TAMÃO Cloudflare official production deploy','TAMÃO launch readiness'];
const shaOk=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
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
 const oidc=attestation?.attestation_source==='github_oidc_edge'&&Number(attestation?.run_id)>0&&Number(attestation?.run_attempt)>0;
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
 return {source:'publication_v1_220',readOnly:true,status,checkedAt,headSha:sha,portals:{sourceSha:portalSha,probes:roles.map(role=>{const p=probes.find(x=>x.role===role);return {role,ok:p?.ok===true,sourceSha:shaOk(p?.sourceSha)?p.sourceSha:null};})},attestation:{status:dbOk?'ok':'attention',sourceSha:shaOk(attestation?.source_sha)?attestation.source_sha:null,verifiedAt:attestation?.verified_at||null,fresh,oidc},workflows,issues};
}