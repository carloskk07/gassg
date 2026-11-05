function merchantOrderBenefitDisclosureImpl(o,demo=false){
  const valid=v=>{
    const n=Number(v);
    return (typeof v==='number'||typeof v==='string'&&/^[0-9]+$/.test(v))&&
      Number.isSafeInteger(n)&&n>=0&&n<=1e9?n:null;
  };
  const fromMoney=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0
    ?valid(Math.round(v*100)):null;
  const gross=demo?fromMoney(o?.grossTotal):valid(o?.grossTotalCents);
  const used=demo?fromMoney(o?.cashbackReserved):valid(o?.cashbackReservedCents);
  const pay=demo?fromMoney(o?.total):valid(o?.totalCents);
  if(gross===null&&used===null)return '';
  if(used===0&&(gross===null||gross===pay))return '';
  if(used===null&&gross===pay)return '';
  // The existing paid-coupon checkout seeds coupon face into the cashback
  // wallet BEFORE reserving the full balance. It must be split using the
  // merchant-authorized server-side application, not inferred from price.
  const coupon=demo?0:valid(o?.couponAppliedCents);
  const partner=demo?0:valid(o?.partnerFundedDiscountCents);
  const partnerVerified=partner===100&&coupon===0&&used===100&&
    gross!==null&&pay!==null&&gross-pay===100;
  const otherCashback=coupon!==null&&partner!==null&&used!==null&&
    coupon+partner<=used?used-coupon-partner:null;
  const fmt=n=>n===null?'não informado':BRL.format(n/100);
  const mismatch=gross!==null&&used!==null&&pay!==null&&gross-pay!==used;
  const incomplete=gross===null||used===null||pay===null;
  const sourceConflict=otherCashback===null;
  const heading=mismatch?'Composição do benefício precisa de conferência':
    incomplete||sourceConflict?'Valores do benefício ainda incompletos':
      partnerVerified?'Presente de R$ 1 financiado por esta revenda':
      'Benefícios usados pelo cliente: − '+fmt(used);
  return '<aside class="notice merchant-benefit-disclosure" aria-label="Detalhamento dos benefícios e financiamento do pedido">'+
    '<strong>'+esc(heading)+'</strong>'+
    '<div class="tiny">Preço antes dos benefícios: <strong>'+fmt(gross)+
    '</strong> • Benefícios utilizados: <strong>− '+fmt(used)+
    '</strong> • Cliente paga: <strong>'+fmt(pay)+'</strong></div>'+
    (partnerVerified?'<div class="tiny"><strong>Desconto da revenda:</strong> R$ 1,00 • '+
      'O cliente paga diretamente o líquido. O TAMÃO não reembolsa este presente.</div>':'')+
    '<div class="tiny">Cupom pago Clube TAMÃO aplicado: <strong>'+fmt(coupon)+
    '</strong> • Cashback de outros saldos: <strong>'+fmt(otherCashback)+'</strong></div>'+
    (mismatch?'<p class="tiny"><strong>Valores divergentes: os benefícios não fecham com preço e total. Atualize antes de aceitar.</strong></p>':
      incomplete?'<p class="tiny"><strong>Dados incompletos. Atualize antes de aceitar.</strong></p>':
      sourceConflict?'<p class="tiny"><strong>Origem dos benefícios inconsistente ou indisponível. Atualize antes de aceitar.</strong></p>':'')+
    (partnerVerified?'<div class="tiny"><strong>Desconto assumido: R$ 1,00. Sem ressarcimento do TAMÃO.</strong></div>':
      '<div class="tiny"><strong>Compensação à revenda: não comprovada neste pedido.</strong></div>')+
    '<details class="merchant-benefit-funding"><summary>Quem financia os benefícios? Taxa TAMÃO e reembolso</summary>'+
    (coupon!==null&&coupon>0
      ?'<p class="tiny">O cupom do Clube TAMÃO está vinculado a este pedido por registro financeiro próprio. Isso NÃO confirma que a revenda já recebeu o reembolso.</p>'
      :'<p class="tiny">Nenhum cupom pago identificado nesta consulta. A origem do cashback comum (TAMÃO, patrocinador ou outra) não está comprovada por este pedido.</p>')+
    (partnerVerified&&Number.isSafeInteger(o.partnerFeeBpsSnapshot)
      ?'<p class="tiny"><strong>Taxa aplicada à venda líquida:</strong> '+
         (Number(o.partnerFeeBpsSnapshot)/100).toLocaleString('pt-BR')+
         '% • custo do bônus assumido pela revenda, sem reembolso do TAMÃO.</p>'
      :'<p class="tiny"><strong>Desconto ou isenção da taxa TAMÃO:</strong> não discriminado. '+
        '<strong>Patrocínio:</strong> não comprovado. '+
        '<strong>Reembolso à revenda:</strong> não comprovado.</p>')+
    '<p class="tiny">Cobrar do cliente somente o total indicado. Não assumir repasse ou desconto de taxa garantido; '+
    (demo?'nenhum dinheiro ou crédito real é movimentado neste simulador.':
      'a compensação exige registros e conciliação separados.')+'</p></details></aside>';
}

globalThis.merchantOrderBenefitDisclosureImpl=merchantOrderBenefitDisclosureImpl;
