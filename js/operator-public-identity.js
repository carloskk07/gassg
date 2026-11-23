// V1.1159 — consulta apenas a identidade PJ formalmente ativada.
// Rascunhos de empresa, CPF do operador e documentos não são retornados.
let tamaoOperatorPublicProfileCache=null;
async function tamaoOperatorPublicProfileLoad(){
  const target=document.getElementById('tamao-legal-operator-identity');
  if(!target)return;
  const getProfile=async()=>{
    if(tamaoOperatorPublicProfileCache)return tamaoOperatorPublicProfileCache;
    if(typeof CHAMA_BACKEND==='undefined'||!CHAMA_BACKEND.url||!CHAMA_BACKEND.publishableKey)return null;
    const request=(globalThis.chamaFetch||fetch)(
      CHAMA_BACKEND.url+'/rest/v1/rpc/platform_operator_public_identity_v1_1159',{
        method:'POST',cache:'no-store',
        headers:{'Content-Type':'application/json',apikey:CHAMA_BACKEND.publishableKey},
        body:'{}'
      });
    const response=await request;
    if(!response.ok)return null;
    const data=await response.json();
    if(data?.source!=='platform_operator_public_identity_v1_1159')return null;
    tamaoOperatorPublicProfileCache=data;
    return data;
  };
  try{
    const profile=await getProfile();
    if(!target.isConnected||document.getElementById('tamao-legal-operator-identity')!==target)return;
    if(profile?.public===true&&profile.entityType==='company'&&
       typeof profile.cnpj==='string'&&typeof profile.legalName==='string'){
      // DOM textContent is deliberate: never insert business data as raw HTML.
      target.textContent='';
      const p=document.createElement('p');
      p.textContent=profile.tradeName+' — '+profile.legalName+
        ' · CNPJ '+profile.cnpj+' · '+profile.publicAddress+
        ' · E-mail: '+profile.contactEmail;
      target.appendChild(p);
    }
  }catch{/* A identidade ainda não confirmada nunca é inventada no navegador. */}
}

globalThis.tamaoOperatorPublicProfileLoad=tamaoOperatorPublicProfileLoad;
