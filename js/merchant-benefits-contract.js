// #844: consent is independent from checkout. Only the #843 product welcome
// benefit can lower Flex from 9% to 8%, when actually applied to a real order.
function merchantBenefitsContractRender(rt){
  const merchant=rt?.merchant||{};
  const role=String(merchant.memberRole||'');
  if(!['owner','manager'].includes(role))return '';
  const id=String(merchant.merchantId||'');
  const info=rt.merchantBenefitsContract?.merchantId===id&&
    rt.merchantBenefitsContract?.source==='merchant_benefits_contract_v1_842'
      ?rt.merchantBenefitsContract:null;
  const pending=rt.merchantBenefitsContractPending===true;
  const liveWelcome=info?.productWelcomeCheckoutEnabled===true&&
    info?.productWelcomeFeeReductionEnabled===true&&
    info?.productWelcomeOnlyWhenApplied===true;
  const status=info?.optedIn?'Adesão registrada':'Sem adesão registrada';
  const action=info?(role==='owner'?(info.optedIn?
    '<button class="ghost small" type="button" onclick="merchantBenefitsContractAct(\'revoke\')" '+(pending?'disabled':'')+'>Revogar para novas compras</button>':
    '<label class="checkbox-line"><input type="checkbox" id="merchant-benefit-accept-v1-842"/> Li e aceito as condições do Programa de Benefícios, incluindo o desconto custeado pela revenda.</label>'+
    '<button class="primary small" type="button" onclick="merchantBenefitsContractAct(\'accept\')" '+(pending?'disabled':'')+'>Confirmar adesão</button>'):''):
    '<p class="tiny muted">Consulte as condições atuais antes de tomar sua decisão.</p>';
  return '<div class="card flat form-stack" aria-label="Programa de Benefícios da revenda">'+
    '<div class="section-head"><div><h3>Programa de Benefícios TAMÃO</h3>'+
    '<p>Adesão voluntária para oferecer vantagens aos clientes.</p></div>'+
    '<span class="status-pill '+(info?.optedIn?'online':'')+'">'+esc(info?status:'Condições não consultadas')+'</span></div>'+
    (liveWelcome
      ?'<p class="tiny"><strong>Presente de boas-vindas em produtos:</strong> R$ 1,00 de desconto em pedido elegível, se a revenda aderiu. No Flex, 9% é a taxa normal e 8% vale só para o pedido que efetivamente usar esse presente; a base é o líquido pago à revenda. Pacotes pré-pagos mantêm suas taxas próprias.</p>'+
       '<div class="notice"><strong>Benefício de R$ 1 implementado.</strong> O cliente paga o valor líquido diretamente à revenda participante. Não há ressarcimento desse presente pelo TAMÃO. Adesão não gera Pix, nem concede automaticamente desconto ou redução de taxa. A compra continua sujeita à elegibilidade e à liberação do comércio.</div>'
      :'<div class="notice"><strong>Disponibilidade em verificação.</strong> Consulte as condições atualizadas. Nenhum desconto ou redução de taxa é prometido sem confirmação do servidor.</div>')+
    '<p class="tiny">Cupons pagos e cashback anterior preservam seus direitos e reembolsos existentes. Eles ainda não são financiados pela revenda por esta adesão.</p>'+
    (info?'<p class="tiny"><strong>Termos v'+esc(String(info.termsVersion))+'</strong> • '+
      esc(String(info.termsText))+'</p>':'')+
    '<div class="order-actions"><button class="secondary small" type="button" onclick="merchantBenefitsContractAct(\'view\')" '+
      (pending?'disabled':'')+'>Consultar condições</button>'+action+'</div>'+
    (rt.merchantBenefitsContractError?'<div class="notice danger">'+esc(rt.merchantBenefitsContractError)+'</div>':'')+
   '</div>';
}
async function merchantBenefitsContractAct(operation){
  const rt=globalThis.merchantRuntime;
  const merchantId=String(rt?.merchant?.merchantId||'');
  const role=String(rt?.merchant?.memberRole||'');
  if(!merchantId||!['owner','manager'].includes(role)||
     !['view','accept','revoke'].includes(operation))return;
  if(operation!=='view'&&role!=='owner')
    return toast('Somente o proprietário pode aceitar ou revogar o programa.');
  if(rt.merchantBenefitsContractPending)return;
  const current=rt.merchantBenefitsContract?.merchantId===merchantId
    ?rt.merchantBenefitsContract:null;
  if(operation!=='view'&&(!current||current.termsVersion!==1||
      !Number.isSafeInteger(current.version)||current.version<0))
    return toast('Consulte as condições antes de decidir.');
  if(operation==='accept'&&document.getElementById('merchant-benefit-accept-v1-842')?.checked!==true)
    return toast('Leia as condições e confirme expressamente a adesão.');
  if(operation==='revoke'&&!confirm('Revogar a participação apenas para novas compras? Pedidos e compromissos anteriores permanecem válidos.'))return;
  rt.merchantBenefitsContractPending=true;
  rt.merchantBenefitsContractError=null;
  const valid=value=>value?.source==='merchant_benefits_contract_v1_842'&&
    value.merchantId===merchantId&&typeof value.optedIn==='boolean'&&
    Number.isSafeInteger(value.version)&&value.version>=0&&value.termsVersion===1&&
    value.normalFlexFeeBps===900&&value.memberFlexFeeBps===800&&
    value.maxWelcomeDiscountCents===100&&typeof value.termsText==='string'&&
    value.checkoutBenefitsEnabled===false&&value.feeReductionEnabled===false&&
    value.noCurrentFinancialMutation===true&&value.legacyCouponRightsPreserved===true&&
    value.productWelcomeCheckoutEnabled===true&&
    value.productWelcomeFeeReductionEnabled===true&&
    value.productWelcomeOnlyWhenApplied===true&&
    value.partnerFundedPaidCouponsEnabled===false&&
    value.partnerFundedOtherCashbackEnabled===false;
  try{
    const payload={action:'benefits-contract',merchantId,operation};
    if(operation!=='view'){
      payload.termsVersion=1;
      payload.expectedVersion=current.version;
      payload.requestId=crypto.randomUUID();
      payload.consent=operation==='accept';
    }
    const result=await merchantInvoke('merchant-ops',payload);
    if(!valid(result)||result.readOnly!==(operation==='view')||
       (operation!=='view'&&result.optedIn!==(operation==='accept')))
      throw new Error('Adesão não confirmada pelo servidor.');
    if(String(rt.merchant?.merchantId)!==merchantId)return;
    if(operation!=='view'){
      const fresh=await merchantInvoke('merchant-ops',{
        action:'benefits-contract',merchantId,operation:'view'});
      if(!valid(fresh)||!fresh.readOnly||fresh.optedIn!==result.optedIn||
          fresh.version!==result.version)
        throw new Error('A alteração exige nova conferência.');
      if(String(rt.merchant?.merchantId)!==merchantId)return;
      rt.merchantBenefitsContract=fresh;
      toast(operation==='accept'?'Adesão registrada. Presente de R$ 1 e Flex 8% somente em compras de produtos elegíveis.':
        'Revogação registrada para novas compras.');
    }else rt.merchantBenefitsContract=result;
  }catch(e){
    if(String(rt.merchant?.merchantId)===merchantId){
      rt.merchantBenefitsContractError=String(e?.message||'Não foi possível conferir as condições.');
      toast(rt.merchantBenefitsContractError);
    }
  }finally{rt.merchantBenefitsContractPending=false;render();}
}

