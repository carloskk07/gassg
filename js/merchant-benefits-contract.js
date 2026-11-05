// #842: voluntary merchant benefits contract. Only enrollment is available;
// never display rate reduction or coupon as economically active before checkout.
function merchantBenefitsContractRender(rt){
  const merchant=rt?.merchant||{};
  const role=String(merchant.memberRole||'');
  if(!['owner','manager'].includes(role))return '';
  const id=String(merchant.merchantId||'');
  const info=rt.merchantBenefitsContract?.merchantId===id&&
    rt.merchantBenefitsContract?.source==='merchant_benefits_contract_v1_842'
      ?rt.merchantBenefitsContract:null;
  const pending=rt.merchantBenefitsContractPending===true;
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
    '<p class="tiny">Flex atual: 9%. Taxa prevista para compras elegíveis após implantação financeira: 8%. Pacotes pré-pagos mantêm suas próprias taxas.</p>'+
    '<div class="notice"><strong>Adesão e aplicação são etapas separadas.</strong> O aceite não gera Pix, desconto, cashback, redução imediata de taxa ou obrigação de ressarcimento pelo TAMÃO. Benefícios nas compras só serão ativados após integração e comprovação.</div>'+
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
    value.noCurrentFinancialMutation===true&&value.legacyCouponRightsPreserved===true;
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
      toast(operation==='accept'?'Adesão registrada. Descontos e taxa menor ainda não foram ativados.':
        'Revogação registrada para novas compras.');
    }else rt.merchantBenefitsContract=result;
  }catch(e){
    if(String(rt.merchant?.merchantId)===merchantId){
      rt.merchantBenefitsContractError=String(e?.message||'Não foi possível conferir as condições.');
      toast(rt.merchantBenefitsContractError);
    }
  }finally{rt.merchantBenefitsContractPending=false;render();}
}

