// Each price is individually reviewed by the merchant and committed with the
// existing per-SKU optimistic version check and audit trail. Partial is not all.
let merchantBulkPriceBusy=false;
async function merchantLiveConfirmReviewedPrices(){
  const rt=globalThis.merchantRuntime||{};
  if(merchantBulkPriceBusy||rt.actionPending===true||rt.status!=='ready'||
     !['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return;
  if(merchantQuickHasDrafts(rt)){
    toast('Salve ou descarte primeiro os ajustes rápidos que ainda estão pendentes.');
    return;
  }
  const codeOk=code=>/^[A-Z][A-Z0-9_]{1,31}$/.test(code);
  const eligible=(rt.catalog||[]).filter(p=>
    p.active===true&&codeOk(String(p.productCode||''))&&
    Number.isSafeInteger(p.priceCents)&&p.priceCents>0&&p.priceCents<=1000000&&
    Number.isSafeInteger(p.availableStock)&&p.availableStock>0&&
    !merchantTimestampFresh(p.priceConfirmedAt));
  const chosen=eligible.filter(p=>document.getElementById('merchant-review-price-'+p.productCode)?.checked===true)
    .map(p=>({...p})); // immutable snapshot: later refreshes cannot move the baseline
  if(!chosen.length)return toast('Marque os preços e estoques que você conferiu.');
  if(chosen.length>12)return toast('Confira até 12 produtos por vez.');
  const pricingMatches=(row,p)=>row?.pricingMode===p.pricingMode&&
    row.minPriceCents===p.minPriceCents&&row.maxPriceCents===p.maxPriceCents&&
    row.pricingStrategy===p.pricingStrategy;
  for(const p of chosen){
    const code=p.productCode;
    const raw=id=>String(document.getElementById(id+'-'+code)?.value??'').trim();
    const money=id=>/^\d{1,5}(?:[.,]\d{1,2})?$/.test(raw(id))?Math.round(Number(raw(id).replace(',','.'))*100):NaN;
    const mode=String(document.getElementById('live-pricing-mode-'+code)?.value||'');
    const strategy=String(document.getElementById('live-pricing-strategy-'+code)?.value||'');
    const unchanged=money('live-price')===p.priceCents&&
      /^\d{1,6}$/.test(raw('live-stock'))&&Number(raw('live-stock'))===p.availableStock&&
      document.getElementById('live-active-'+code)?.checked===true&&
      mode===(p.pricingMode||'fixed')&&
      (mode!=='range'||(money('live-min-price')===p.minPriceCents&&
        money('live-max-price')===p.maxPriceCents&&
        strategy===(p.pricingStrategy||'balanced')&&
        Number.isSafeInteger(p.minPriceCents)&&Number.isSafeInteger(p.maxPriceCents)&&
        p.minPriceCents>0&&p.minPriceCents<=p.priceCents&&p.priceCents<=p.maxPriceCents&&p.maxPriceCents<=1000000));
    if(!unchanged||!Number.isFinite(Date.parse(String(p.updatedAt||'')))){
      toast('Existem alterações ainda não salvas ou dados antigos em '+code+'. Salve esse produto antes de confirmar em conjunto.');
      return;
    }
  }
  const merchantId=String(rt.merchant?.merchantId||'');
  const userId=String(rt.session?.user?.id||'');
  const epoch=rt.accessEpoch;
  const same=()=>{
    const now=globalThis.merchantRuntime||{};
    return Boolean(userId&&merchantId)&&now.accessEpoch===epoch&&
      String(now.session?.user?.id||'')===userId&&
      String(now.merchant?.merchantId||'')===merchantId&&
      String(now.selectedMerchantId||'')===merchantId&&
      now.status==='ready'&&['owner','manager'].includes(String(now.merchant?.memberRole||''));
  };
  if(!same())return toast('Confirme seu acesso à revenda antes de revisar preços.');
  if(typeof confirm!=='function'||!confirm('Confirmar que você conferiu os preços e estoques salvos de '+chosen.length+' produto(s)? Cada produto será registrado separadamente.'))return;
  if(!same())return;
  merchantBulkPriceBusy=true;
  let completed=0,reason='';
  try{
    for(const p of chosen){
      const now=globalThis.merchantRuntime||{};
      const current=(now.catalog||[]).find(x=>x.productCode===p.productCode);
      if(!same()||
         now.actionPending===true||!current||current.updatedAt!==p.updatedAt||
         current.priceCents!==p.priceCents||current.availableStock!==p.availableStock||
         current.active!==true||!pricingMatches(current,p))throw new Error('O cadastro mudou. Atualize e revise os produtos restantes.');
      await merchantUpdateProductLive(p.productCode,p.priceCents,p.availableStock,true);
      if(!same())throw new Error('O operador ou a revenda mudou durante a conferência.');
      const refreshed=(globalThis.merchantRuntime?.catalog||[]).find(x=>x.productCode===p.productCode);
      if(!refreshed||refreshed.priceCents!==p.priceCents||
         refreshed.availableStock!==p.availableStock||refreshed.active!==true||
         !pricingMatches(refreshed,p)||!merchantTimestampFresh(refreshed.priceConfirmedAt))
        throw new Error('Confirmação sem leitura atualizada. Revise a situação antes de continuar.');
      completed++;
    }
  }catch(error){reason=String(error?.message||error||'Erro ao confirmar');}
  finally{merchantBulkPriceBusy=false;}
  if(!same())return;
  toast(reason
    ?completed+' de '+chosen.length+' preço(s) reconfirmado(s). Interrompido: '+reason
    :completed+' preço(s) reconfirmado(s) e verificado(s) no servidor.');
}
