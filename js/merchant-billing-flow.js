/* Deferred only in the partner finance workflow. Same authenticated merchant
 * scope and canonical backend endpoints; no new financial authority. */
function merchantBillingSameActor(actor,merchantId,epoch){
  return !!actor&&merchantReady()&&merchantRuntime.accessEpoch===epoch&&
    String(merchantRuntime.session?.user?.id||'')===actor&&
    String(merchantRuntime.merchant?.merchantId||'')===merchantId&&
    ['owner','manager'].includes(String(merchantRuntime.merchant?.memberRole||''));
}
async function merchantBillingRequestImpl(action,payload={}){
  const merchantId=String(merchantRuntime.merchant?.merchantId||'');
  const actor=String(merchantRuntime.session?.user?.id||'');
  const epoch=merchantRuntime.accessEpoch;
  const same=()=>merchantBillingSameActor(actor,merchantId,epoch);
  if(!same())throw new Error('Atualize o acesso da revenda antes de operar o Financeiro.');
  if(merchantRuntime.actionPending)throw new Error('Aguarde a operação financeira em andamento.');
  const allowed=['request-billing-package','notify-billing-payment','notify-refund-recovery-payment','cancel-billing-request'];
  if(!allowed.includes(action))throw new Error('Ação financeira inválida');
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-billing');
    const result=await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',{
      merchantId,action,...payload
    },{idempotencyKey}));
    if(!same())throw new Error('A sessão mudou durante a ação financeira.');
    if(result?.ok!==true||result.merchantId!==merchantId||
       !result.paymentRequestId||!Number.isSafeInteger(Number(result.expectedAmountCents))||
       Number(result.expectedAmountCents)<=0)
      throw new Error('A resposta não comprovou a solicitação financeira.');
    const readStarted=Date.now();
    const fresh=await merchantRefresh({silent:true});
    if(!same())throw new Error('O acesso à revenda mudou durante a conferência.');
    if(!fresh||merchantRuntime.billing!==fresh.billing||
       String(fresh.merchant?.merchantId||'')!==merchantId||
       !Number.isFinite(Date.parse(String(merchantRuntime.lastSyncAt||'')))||
       Date.parse(merchantRuntime.lastSyncAt)<readStarted)
      throw new Error('A solicitação não foi confirmada na atualização. Confira o Financeiro antes de repetir.');
    const row=(fresh.billing?.paymentRequests||[]).find(x=>x.id===result.paymentRequestId);
    const target=action==='request-billing-package'
      ?row?.planKey===payload.planKey&&row?.requestKind==='package_purchase'
      :action==='notify-billing-payment'
        ?row?.statementId===payload.statementId&&row?.requestKind==='statement_payment'
        :action==='notify-refund-recovery-payment'
          ?row?.refundRecoveryId===payload.refundRecoveryId&&row?.requestKind==='refund_recovery'
          :row?.id===payload.paymentRequestId;
    const state=action==='cancel-billing-request'
      ?row?.status==='cancelled'&&result.status==='cancelled'
      :['pending','approved'].includes(row?.status)&&
        ['pending','approved'].includes(result.status);
    if(!row||!target||!state||row.requestKind!==result.requestKind||
       Number(row.expectedAmountCents)!==Number(result.expectedAmountCents)||
       (action!=='cancel-billing-request'&&
         String(row.merchantReference||'')!==String(payload.reference||'')))
      throw new Error('O registro financeiro não confirmou a ação. Consulte antes de repetir.');
    return result;
  }catch(error){
    if(same())merchantRuntime.error=String(error?.message||error);
    throw error;
  }finally{
    if(same()){merchantRuntime.actionPending=false;render();}
  }
}

async function merchantCreateBillingPixImpl({planKey=null,statementId=null,refundRecoveryId=null}={}){
  const merchantId=String(merchantRuntime.merchant?.merchantId||'');
  const actor=String(merchantRuntime.session?.user?.id||'');
  const epoch=merchantRuntime.accessEpoch;
  const same=()=>merchantBillingSameActor(actor,merchantId,epoch);
  if(!same())throw new Error('A sessão da revenda precisa ser atualizada antes de gerar Pix.');
  if(merchantRuntime.actionPending)throw new Error('Já existe uma operação financeira em andamento.');
  const plan=planKey==null?null:String(planKey).trim().toLowerCase();
  const statement=statementId==null?null:String(statementId).trim();
  const recovery=refundRecoveryId==null?null:String(refundRecoveryId).trim();
  if([plan,statement,recovery].filter(v=>v!=null).length!==1){
    throw new Error('Informe exatamente uma cobrança financeira');
  }
  if(plan!=null&&!/^[a-z][a-z0-9_]{1,39}$/.test(plan))throw new Error('Pacote de crédito inválido');
  if(statement!=null&&!statement)throw new Error('Fechamento diário inválido');
  if(recovery!=null&&!recovery)throw new Error('Obrigação de recuperação inválida');

  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-billing-pix');
    const result=await retryAmbiguousOnce(()=>merchantInvoke('merchant-billing-pix',{
      merchantId,
      planKey:plan,
      statementId:statement,
      refundRecoveryId:recovery
    },{idempotencyKey}));
    if(!same())throw new Error('A sessão mudou durante a emissão do Pix.');
    const charge=result?.charge;
    if(result?.ok!==true||!result.paymentRequestId||
       !['active','completed'].includes(charge?.status)||
       charge.paymentRequestId!==result.paymentRequestId||
       !Number.isSafeInteger(Number(charge.amountCents)))
      throw new Error('Cobrança Pix divergente da solicitação.');
    const readStarted=Date.now();
    const fresh=await merchantRefresh({silent:true});
    if(!same())throw new Error('O acesso à revenda mudou durante a consulta do Pix.');
    if(!fresh||merchantRuntime.billing!==fresh.billing||
       fresh.merchant?.merchantId!==merchantId||
       Date.parse(String(merchantRuntime.lastSyncAt||''))<readStarted)
      throw new Error('A consulta do Pix não foi aplicada. Atualize antes de utilizar o código.');
    const row=(fresh.billing?.paymentRequests||[]).find(r=>r.id===result.paymentRequestId);
    if(!row||row.expectedAmountCents!==Number(charge.amountCents)||
       row.pixCharge?.id!==charge.id||
       row.pixCharge?.provider!==charge.provider||
       row.pixCharge?.correlationId!==charge.correlationId||
       row.pixCharge?.status!==charge.status)
      throw new Error('A cobrança mudou no provedor. Confira o Financeiro antes de pagar.');
    if(charge.status==='completed'){
      if(!Number.isSafeInteger(row.pixCharge.paidAmountCents)||
         row.pixCharge.paidAmountCents!==row.expectedAmountCents)
        throw new Error('Pagamento identificado no provedor, mas o valor precisa de conferência financeira.');
      return {...result,alreadyReceived:true};
    }
    if(typeof charge.brCode!=='string'||charge.brCode.length<30||
       !Number.isFinite(Date.parse(charge.expiresAt))||
       Date.parse(charge.expiresAt)<=Date.now())
      throw new Error('O Pix está indisponível ou expirou. Consulte a cobrança original antes de tentar novamente.');
    if(!globalThis.merchantAcceptVerifiedBillingPix?.(result,merchantId)||!same())
      throw new Error('Pix não confirmado para esta sessão. Atualize o Financeiro.');
    return result;
  }catch(error){
    if(same())merchantRuntime.error=String(error?.message||error);
    throw error;
  }finally{
    if(same()){merchantRuntime.actionPending=false;render();}
  }
}


globalThis.merchantBillingSameActor=merchantBillingSameActor;
globalThis.merchantBillingRequestImpl=merchantBillingRequestImpl;
globalThis.merchantCreateBillingPixImpl=merchantCreateBillingPixImpl;
