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


// Availability and payment routing are operational decisions; an HTTP ACK is
// not permission to update a different merchant's panel or report success.
function merchantAvailabilityMutationScope(){
 const rt=merchantRuntime;
 const actor=String(rt.session?.user?.id||''),merchantId=String(rt.merchant?.merchantId||'');
 if(rt.status!=='ready'||!actor||!merchantId||
    String(rt.selectedMerchantId||'')!==merchantId||
    !['owner','manager','operator'].includes(String(rt.merchant?.memberRole||'')))
   throw new Error('Atualize seu acesso à revenda antes de alterar a disponibilidade.');
 return {actor,merchantId,epoch:rt.accessEpoch};
}
function merchantAvailabilityMutationSame(scope){
 const rt=merchantRuntime;
 return !!scope&&rt.status==='ready'&&rt.accessEpoch===scope.epoch&&
   String(rt.session?.user?.id||'')===scope.actor&&
   String(rt.merchant?.merchantId||'')===scope.merchantId&&
   String(rt.selectedMerchantId||'')===scope.merchantId&&
   ['owner','manager','operator'].includes(String(rt.merchant?.memberRole||''));
}
async function merchantOnlineMutateImpl(online){
 const scope=merchantAvailabilityMutationScope();
 const same=()=>merchantAvailabilityMutationSame(scope);
 if(merchantRuntime.actionPending)throw Error('Aguarde a operação da revenda terminar.');
 const token={scope};merchantRuntime.onlineActionToken=token;
 const desired=online===true;
 merchantRuntime.actionPending=true;render();
 try{
  let ack=null,postError=null;
  try{
   ack=await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',{
    merchantId:scope.merchantId,action:'set-online',online:desired
   }));
  }catch(e){postError=e;}
  if(!same())throw Error('A conta ou a revenda mudou durante a operação.');
  if(postError){
   const status=Number(postError?.status||0);
   const ambiguous=postError?.code==='NETWORK_TIMEOUT'||
     ['TypeError','TimeoutError','AbortError'].includes(postError?.name)||
     status>=500||status===408||status===429||status===0;
   if(!ambiguous)throw postError;
  }
  if(!postError&&(ack?.ok!==true||ack.online!==desired))
    throw Error('O servidor não confirmou a disponibilidade desejada.');
  const started=Date.now();
  const fresh=await merchantRefresh({silent:true});
  if(!same())throw Error('A conta ou a revenda mudou durante a conferência.');
  const checkedAt=Date.parse(String(merchantRuntime.lastSyncAt||''));
  if(!fresh||fresh.merchant?.merchantId!==scope.merchantId||
     merchantRuntime.merchant!==fresh.merchant||
     !Number.isFinite(checkedAt)||checkedAt<started||
     fresh.merchant.online!==desired){
   throw Error(postError
    ?'A resposta da rede foi interrompida e a disponibilidade não foi confirmada. Consulte o painel antes de repetir.'
    :'A disponibilidade não foi confirmada em uma consulta atualizada. Atualize o painel.');
  }
  merchantEnablementAfterChange();
  return postError?{ok:true,online:desired,reconciledAfterNetworkError:true}:ack;
 }catch(error){
  if(same())merchantRuntime.error=String(error?.message||error);
  throw error;
 }finally{
  if(same()&&merchantRuntime.onlineActionToken===token){
   merchantRuntime.onlineActionToken=null;
   merchantRuntime.actionPending=false;
   render();
  }
 }
}
// Compare the provider-approved saved fields, not volatile row IDs/timestamps.
// Each payment route is audited atomically by merchant_payment_routes_action.
function merchantPaymentRouteProof(rows){
 if(!Array.isArray(rows))return null;
 const canon=route=>{
  if(!route||typeof route!=='object')return null;
  return JSON.stringify([
   String(route.paymentMethod||''),String(route.provider||''),
   String(route.connectionId||''),String(route.channel||''),
   String(route.verificationMode||''),route.active===true,
   Number(route.priority||100),String(route.customerLabel||''),
   JSON.stringify(Object.entries(route.metadata||{}).sort(([a],[b])=>a.localeCompare(b)))
  ]);
 };
 const keys=rows.map(canon);
 if(keys.some(k=>!k))return null;
 return keys.sort().join('\n');
}
async function merchantPaymentRoutesMutateImpl(routes,reason='Atualização das formas de recebimento'){
 const scope=merchantEditableMutationScope();
 const same=()=>merchantEditableMutationSame(scope);
 if(merchantRuntime.actionPending)throw Error('Aguarde a operação em andamento.');
 if(!Array.isArray(routes)||routes.length<1||routes.length>30)
  throw Error('Configure ao menos uma forma de recebimento válida');
 const version=merchantRuntime.paymentRouteVersion;
 if(!Number.isSafeInteger(version)||version<1)
  throw Error('Atualize as formas de pagamento antes de salvar alterações.');
 const cleanReason=String(reason||'').trim().replace(/\s+/g,' ');
 if(cleanReason.length<3||cleanReason.length>1000)
  throw Error('Motivo da alteração inválido');
 // Freeze the intended payload in case UI inputs change during the network call.
 const requested=JSON.parse(JSON.stringify(routes));
 const token={scope};merchantRuntime.paymentRoutesActionToken=token;
 merchantRuntime.actionPending=true;merchantRuntime.error=null;render();
 try{
  const key=liveIdempotency('merchant-payment-routes');
  const ack=await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',{
   merchantId:scope.merchantId,action:'update-payment-routes',
   expectedVersion:version,routes:requested,reason:cleanReason
  },{idempotencyKey:key}));
  if(!same())throw Error('A conta ou a revenda mudou durante a alteração dos recebimentos.');
  if(ack?.ok!==true||ack.merchantId!==scope.merchantId||
    ack.version!==version+1||ack.fundsOwner!=='merchant'||
    ack.tamaoReceivesSaleProceeds!==false||
    !Array.isArray(ack.routes)||ack.routes.length!==requested.length||
    merchantPaymentRouteProof(requested)!==merchantPaymentRouteProof(ack.routes))
   throw Error('O servidor não comprovou a atualização das formas de recebimento.');
  const started=Date.now();
  const fresh=await merchantRefresh({silent:true});
  if(!same())throw Error('A conta ou a revenda mudou durante a conferência dos recebimentos.');
  if(!fresh||fresh.merchant?.merchantId!==scope.merchantId||
     merchantRuntime.paymentRoutes!==fresh.paymentRoutes||
     merchantRuntime.paymentRouteVersion!==ack.version||
     !Number.isFinite(Date.parse(String(merchantRuntime.lastSyncAt||'')))||
     Date.parse(merchantRuntime.lastSyncAt)<started||
     merchantPaymentRouteProof(fresh.paymentRoutes)!==merchantPaymentRouteProof(ack.routes)||
     merchantPaymentRouteProof(ack.routes)==null)
   throw Error('As formas de recebimento não foram confirmadas em uma leitura atualizada. Consulte antes de repetir.');
  merchantEnablementAfterChange();
  return ack;
 }catch(error){
  if(same()){
   merchantRuntime.error=String(error?.message||error);
   // An ambiguous write must not be automatically attempted again with a
   // new key; a fresh read is only a diagnostic, not permission to claim OK.
  }
  throw error;
 }finally{
  if(same()&&merchantRuntime.paymentRoutesActionToken===token){
   merchantRuntime.paymentRoutesActionToken=null;
   merchantRuntime.actionPending=false;
   render();
  }
 }
}
globalThis.merchantOnlineMutateImpl=merchantOnlineMutateImpl;
globalThis.merchantPaymentRoutesMutateImpl=merchantPaymentRoutesMutateImpl;
