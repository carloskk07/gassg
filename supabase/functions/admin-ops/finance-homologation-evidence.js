// V1.920 — Pure diagnostic projection. No payments, privileges or mutations.
// Provider event counts and signed Pix lab callbacks are NOT bank settlement.
const MODULE_KEYS=["coupons","mobility","merchants","orders","advertising","benefits","professional_ads"];
const ACTIONS={
 coupons:"Testar compra real de cupons pelo checkout próprio, emissão única, resgate, devolução e conciliação.",
 mobility:"Testar recarga real do plano, criação única do lote de créditos, consumo, cancelamento e estorno.",
 merchants:"Usar a conta de revenda já vinculada ao titular neste Admin: pagar uma recarga real, conferir o crédito e depois o consumo. Não é necessário ativar vendas para comprar créditos.",
 orders:"Testar PSP no Laboratório Pix. Pedido e repasse reais exigem vendedor e comprador legítimos.",
 advertising:"Testar checkout de campanha aprovada, webhook de pagamentos Ads e estorno com autorização explícita.",
 benefits:"Testar origem dos créditos, cashback, reversão e pagamento ao beneficiário real com prova independente.",
 professional_ads:"Testar contratação e cobrança reais sem criar diárias, impressões ou pagamentos fictícios."
};
const INDICATOR={
 coupons:"couponPaid",mobility:"mobilityPaid",merchants:"merchantCompleted",
 orders:"orderApproved",advertising:"adsApproved",
 benefits:"referralBankEvidence",professional_ads:"professionalBilledDays"
};
const ASSERT_SIGNALS=["couponPaid","couponNetVerified","mobilityPaid","merchantCompleted",
 "orderApproved","adsApproved","adsPaymentApproved","referralBankEvidence",
 "professionalBilledDays"];
export function evaluateFinanceHomologationEvidence(modules,signals,labHistory){
 if(!Array.isArray(modules)||modules.length!==MODULE_KEYS.length||
    !MODULE_KEYS.every(key=>modules.some(m=>m?.key===key&&m.counts))||
    !signals||ASSERT_SIGNALS.some(key=>!Number.isSafeInteger(signals[key])||signals[key]<0)||
    !Array.isArray(labHistory)||labHistory.length>6)
  throw new Error("INVALID_FINANCE_EVIDENCE");
 const validPurpose=new Set(["gateway",...MODULE_KEYS]);
 if(labHistory.some(row=>!validPurpose.has(row.testPurpose)||
   !["none","pending","psp_processed","reversal","unverified","unavailable"].includes(row.webhookEvidence)||
   !Number.isSafeInteger(row.amountCents)||row.amountCents<100||row.amountCents>500))
  throw new Error("INVALID_FINANCE_LAB_EVIDENCE");
 return modules.map(mod=>{
   const key=mod.key,positive=signals[INDICATOR[key]];
   const selectedLab=labHistory.filter(row=>row.testPurpose===key);
   const latest=selectedLab[0]||null;
   // These mismatches require investigation but do not prove a fraud or missing settlement.
   const review=(
     key==="coupons"&&signals.couponPaid>0&&mod.counts.issuances<signals.couponPaid||
     key==="mobility"&&signals.mobilityPaid>0&&mod.counts.providerEvidence===0||
     key==="merchants"&&signals.merchantCompleted>0&&mod.counts.events===0||
     key==="orders"&&signals.orderApproved>0&&mod.counts.verifications===0||
     key==="advertising"&&signals.adsApproved>0&&signals.adsPaymentApproved===0
   );
   const credits=key==='merchants'?(mod.counts.appliedCredits??0):0;
   const terms=key==='professional_ads'?mod.counts.activeTerms:null;
   if(!Number.isSafeInteger(credits)||credits<0||terms!=null&&(!Number.isSafeInteger(terms)||terms<0))
     throw new Error("INVALID_FINANCE_EVIDENCE");
   const state=review?"needs_review":positive>0?"provider_or_ledger_evidence":"pending_real_payment";
   const merchantReceipt=key==='merchants'&&positive>0&&!review;
   const couponReceipt=key==='coupons'&&signals.couponPaid>0&&signals.couponNetVerified>0&&!review;
   const progressLabel=review?"Registros divergentes: revisar a operação existente":
     merchantReceipt&&credits>0?"Pagamento e crédito registrados; faltam consumo e reversão":
     merchantReceipt?"Pagamento identificado; conferir a liberação do crédito existente":
     couponReceipt?"Recebimento e líquido registrados; faltam uso e devolução":
     key==='professional_ads'&&terms===0?"Cobrança de profissionais ainda não configurada":
     positive>0?"Há registros; faltam as demais etapas do ciclo":
     "Aguardando a primeira operação real desta modalidade";
   return {...mod,diagnosis:{
     state,providerOrLedgerEvidence:positive,
     financiallyHomologated:false,bankSettlementChecked:false,
     labPixCount:selectedLab.length,
     latestLabWebhook:latest?.webhookEvidence??"none",
     recordedNetReceipts:key==='coupons'?signals.couponNetVerified:0,
     recordedCredits:credits,progressLabel,
     nextAction:merchantReceipt&&credits>0
       ?"Usar os créditos já registrados para validar consumo e reversão. Recebimento e concessão do pacote já registrados; não pagar outra recarga para repetir essa prova."
       :merchantReceipt
       ?"Conferir a liberação do crédito da cobrança já paga. Retomar a mesma ordem do provedor; não gerar outro Pix."
       :key==='professional_ads'&&terms===0
       ?"Definir e configurar a cobrança de anúncios profissionais antes da contratação e da homologação financeira."
       :couponReceipt
       ?"Reutilizar os cupons já pagos para validar resgate, cancelamento e devolução. Recebimento e líquido já registrados; não comprar outro pacote para repetir essa prova."
       :ACTIONS[key],
     note:review?"Registros de recebimento e contrapartida precisam de conferência antes de qualquer liberação.":
        positive>0?"Há registros no módulo, mas esta consulta não prova liquidação nem homologa o ciclo inteiro.":
        "Sem evidência financeira concluída neste módulo. Nenhum pagamento foi gerado.",
     gatewayLabIsCommercialProof:false
   }};
 });
}
