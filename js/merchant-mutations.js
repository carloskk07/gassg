/* TAMÃO merchant catalog and team mutations. Loaded on first protected click;
 * always checks the actor/merchant epoch and exact authenticated readback. */
function merchantEditableMutationScope(){
  const rt=merchantRuntime;
  const actor=String(rt.session?.user?.id||'');
  const merchantId=String(rt.merchant?.merchantId||'');
  if(rt.status!=='ready'||!actor||!merchantId||
    (rt.selectedMerchantId&&String(rt.selectedMerchantId)!==merchantId)||
    !['owner','manager'].includes(String(rt.merchant?.memberRole||'')))
    throw new Error('Atualize seu acesso de proprietário ou gerente antes de alterar a revenda.');
  return {actor,merchantId,epoch:rt.accessEpoch};
}

function merchantEditableMutationSame(scope){
  const rt=merchantRuntime;
  return !!scope&&rt.status==='ready'&&rt.accessEpoch===scope.epoch&&
    String(rt.session?.user?.id||'')===scope.actor&&
    String(rt.merchant?.merchantId||'')===scope.merchantId&&
    String(rt.selectedMerchantId||'')===scope.merchantId&&
    ['owner','manager'].includes(String(rt.merchant?.memberRole||''));
}

async function merchantTeamMutateImpl(action,payload={}){
  if(!['invite','revoke-member','revoke-invite'].includes(action))
    throw new Error('Ação de equipe inválida');
  const scope=merchantEditableMutationScope();
  const same=()=>merchantEditableMutationSame(scope);
  if(merchantRuntime.actionPending)throw new Error('Aguarde a operação em andamento.');
  const token={scope};merchantRuntime.teamActionToken=token;
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-team');
    const result=await retryAmbiguousOnce(()=>merchantInvoke('merchant-team',{
      merchantId:scope.merchantId,action,...payload
    },{idempotencyKey}));
    if(!same())throw new Error('A conta ou a revenda mudou durante a alteração da equipe.');
    const readStarted=Date.now();
    const fresh=await merchantRefresh({silent:true});
    if(!same())throw new Error('A conta ou a revenda mudou durante a conferência da equipe.');
    if(!fresh||fresh.merchant?.merchantId!==scope.merchantId||
       merchantRuntime.catalog!==fresh.catalog||
       !Number.isFinite(Date.parse(String(merchantRuntime.lastSyncAt||'')))||
       Date.parse(merchantRuntime.lastSyncAt)<readStarted)
      throw new Error('O cadastro da equipe não foi confirmado em uma consulta atualizada.');
    const team=await merchantTeamLoadLive({silent:true});
    if(!same())throw new Error('A conta ou a revenda mudou durante a conferência da equipe.');
    if(result?.ok!==true||!team||merchantRuntime.team!==team||
       !Array.isArray(team.members)||!Array.isArray(team.pendingInvites))
      throw new Error('Não foi possível confirmar a equipe atualizada. Consulte novamente antes de repetir.');
    // Verify the exact mutation, not just an unrelated successful list read.
    const member=team.members.find(m=>m?.userId===payload.targetUserId);
    const verified=action==='invite'
      ?(result.status==='pending'&&team.pendingInvites.some(i=>
          i.inviteId===result.inviteId&&i.email===result.email&&
          i.memberRole===result.memberRole)||
        ['pending','linked'].includes(result.status)&&team.members.some(m=>
          m.email===result.email&&m.memberRole===result.memberRole&&m.active===true))
      :action==='revoke-member'
        ?result.targetUserId===payload.targetUserId&&
          !(member?.active===true)
        :result.inviteId===payload.inviteId&&
          team.pendingInvites.every(i=>i?.inviteId!==payload.inviteId);
    if(!verified)
      throw new Error('A alteração não aparece na equipe atual. Atualize a lista antes de tentar novamente.');
    return result;
  }catch(error){
    if(same()){
      merchantRuntime.error=String(error?.message||error);
      try{await merchantTeamLoadLive({silent:true})}catch(_){}
    }
    throw error;
  }finally{
    if(same()&&merchantRuntime.teamActionToken===token){
      merchantRuntime.teamActionToken=null;
      merchantRuntime.actionPending=false;
      render();
    }
  }
}

async function merchantCatalogMutateImpl(productCode,priceCents,availableStock,active=true,pricing={}){
  const scope=merchantEditableMutationScope();
  const same=()=>merchantEditableMutationSame(scope);
  if(merchantRuntime.actionPending)throw new Error('Aguarde a alteração de catálogo em andamento.');
  const token={scope};merchantRuntime.catalogActionToken=token;
  merchantRuntime.actionPending=true;render();
  try{
    const normalizedCode=String(productCode||'').trim().toUpperCase();
    const current=(merchantRuntime.catalog||[]).find(
      item=>String(item?.productCode||'').trim().toUpperCase()===normalizedCode
    )||null;
    const body={
      merchantId:scope.merchantId,action:'update-product',productCode:normalizedCode,
      priceCents:Number(priceCents),availableStock:Number(availableStock),active:active!==false
    };
    if(current?.updatedAt)body.expectedUpdatedAt=String(current.updatedAt);
    if(pricing&&typeof pricing==='object'){
      if(pricing.pricingMode!=null)body.pricingMode=String(pricing.pricingMode);
      if(pricing.minPriceCents!=null)body.minPriceCents=Number(pricing.minPriceCents);
      if(pricing.maxPriceCents!=null)body.maxPriceCents=Number(pricing.maxPriceCents);
      if(pricing.pricingStrategy!=null)body.pricingStrategy=String(pricing.pricingStrategy);
    }
    const idempotencyKey=liveIdempotency('merchant-catalog');
    try{
      const ack=await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',body,{idempotencyKey}));
      if(!same())throw new Error('A conta ou a revenda mudou durante a alteração do produto.');
      if(!ack?.product)throw new Error('A alteração do produto não foi comprovada pelo servidor.');
    }catch(error){
      if(!same())throw new Error('A conta ou a revenda mudou durante a alteração do produto.');
      if(['CATALOG_VERSION_CONFLICT','CATALOG_VERSION_REQUIRED'].includes(String(error?.code||''))){
        try{await merchantRefresh({silent:true})}catch(_){}
      }
      throw error;
    }
    if(!same())throw new Error('A conta ou a revenda mudou durante a consulta do catálogo.');
    const readStarted=Date.now();
    const fresh=await merchantRefresh({silent:true});
    if(!same())throw new Error('A conta ou a revenda mudou durante a consulta do catálogo.');
    if(!fresh||fresh.merchant?.merchantId!==scope.merchantId||
       merchantRuntime.catalog!==fresh.catalog||
       !Number.isFinite(Date.parse(String(merchantRuntime.lastSyncAt||'')))||
       Date.parse(merchantRuntime.lastSyncAt)<readStarted)
      throw new Error('A atualização do catálogo não foi confirmada. Consulte antes de repetir.');
    const row=(fresh.catalog||[]).find(item=>item.productCode===normalizedCode);
    if(!row||row.priceCents!==body.priceCents||
       row.availableStock!==body.availableStock||row.active!==body.active||
       (body.pricingMode!=null&&row.pricingMode!==body.pricingMode)||
       (body.minPriceCents!=null&&row.minPriceCents!==body.minPriceCents)||
       (body.maxPriceCents!=null&&row.maxPriceCents!==body.maxPriceCents)||
       (body.pricingStrategy!=null&&row.pricingStrategy!==body.pricingStrategy))
      throw new Error('O servidor apresentou valores diferentes dos salvos. Confira preço, estoque e modo de precificação.');
    merchantEnablementAfterChange();
    return row;
  }finally{
    if(same()&&merchantRuntime.catalogActionToken===token){
      merchantRuntime.catalogActionToken=null;
      merchantRuntime.actionPending=false;
      render();
    }
  }
}

globalThis.merchantCatalogMutateImpl=merchantCatalogMutateImpl;
globalThis.merchantTeamMutateImpl=merchantTeamMutateImpl;
