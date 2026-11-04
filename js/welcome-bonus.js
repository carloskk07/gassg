/* Welcome bonus #815: server is sole authority for the promotion and wallet.
   Absence of an authoritative response is not an available promotion. */
const tamaoWelcomeBonus={status:null,lastUser:null,inflight:false};
function tamaoWelcomeRender(){
  const status=tamaoWelcomeBonus.status;
  const active=status?.active===true &&
    Number.isInteger(Number(status.remaining)) && Number(status.remaining)>0 &&
    Number(status.awardCents)===100;
  document.querySelectorAll('.tamao-welcome-offer').forEach(node=>{
    node.hidden=!active;
    if(active){
      const count=node.querySelector('[data-welcome-remaining]');
      if(count){
        const next=String(Math.min(100,Number(status.remaining)));
        if(count.textContent!==next)count.textContent=next;
      }
    }
  });
}
async function tamaoWelcomeRefreshStatus(){
  const config=typeof CHAMA_BACKEND!=='undefined'?CHAMA_BACKEND:null;
  if(!config?.url||!config?.publishableKey)return;
  try{
    const response=await fetch(config.url+'/rest/v1/rpc/welcome_bonus_status_v1_815',{
      method:'POST',cache:'no-store',
      headers:{'apikey':config.publishableKey,'Content-Type':'application/json'},
      body:'{}'
    });
    if(!response.ok)throw new Error('campaign_status_unavailable');
    const data=await response.json();
    tamaoWelcomeBonus.status=data;
  }catch{
    tamaoWelcomeBonus.status=null;
  }
  tamaoWelcomeRender();
}
async function tamaoWelcomeClaimVerifiedUser(){
  if(tamaoWelcomeBonus.inflight)return;
  const runtime=globalThis.liveRuntime;
  const session=runtime?.session;
  const user=session?.user;
  if(!runtime?.client||runtime.status!=='ready'||!session?.access_token||
     !user?.id||user.is_anonymous===true||!user.email||
     !user.email_confirmed_at||tamaoWelcomeBonus.lastUser===user.id)return;
  tamaoWelcomeBonus.inflight=true;
  try{
    const {data,error}=await runtime.client.rpc('claim_welcome_bonus_v1_815');
    if(error)throw error;
    tamaoWelcomeBonus.lastUser=user.id;
    if(data?.granted===true&&data?.alreadyGranted!==true&&
       typeof liveSyncFinancialProfile==='function'){
      await liveSyncFinancialProfile({force:true});
    }
    await tamaoWelcomeRefreshStatus();
  }catch{
    // Fail closed and allow retry on next page load; never credit locally.
  }finally{
    tamaoWelcomeBonus.inflight=false;
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  const app=document.getElementById('app');
  if(app)new MutationObserver(tamaoWelcomeRender).observe(app,{childList:true,subtree:true});
  tamaoWelcomeRefreshStatus();
  // Auth can be restored or converted from an anonymous visitor asynchronously.
  setInterval(tamaoWelcomeClaimVerifiedUser,2500);
  setInterval(tamaoWelcomeRefreshStatus,60000);
});
