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
  const chosen=eligible.filter(p=>document.getElementById('merchant-review-price-'+p.productCode)?.checked===true);
  if(!chosen.length)return toast('Marque os preços e estoques que você conferiu.');
  if(chosen.length>12)return toast('Confira até 12 produtos por vez.');
  for(const p of chosen){
    const code=p.productCode;
    const number=id=>Number(document.getElementById(id+'-'+code)?.value);
    const mode=String(document.getElementById('live-pricing-mode-'+code)?.value||'');
    const strategy=String(document.getElementById('live-pricing-strategy-'+code)?.value||'');
    const unchanged=Math.round(number('live-price')*100)===p.priceCents&&
      number('live-stock')===p.availableStock&&
      document.getElementById('live-active-'+code)?.checked===true&&
      mode===(p.pricingMode||'fixed')&&
      (mode!=='range'||(Math.round(number('live-min-price')*100)===p.minPriceCents&&
        Math.round(number('live-max-price')*100)===p.maxPriceCents&&
        strategy===(p.pricingStrategy||'balanced')));
    if(!unchanged||!Number.isFinite(Date.parse(String(p.updatedAt||'')))){
      toast('Existem alterações ainda não salvas ou dados antigos em '+code+'. Salve esse produto antes de confirmar em conjunto.');
      return;
    }
  }
  if(typeof confirm!=='function'||!confirm('Confirmar que você conferiu os preços e estoques salvos de '+chosen.length+' produto(s)? Cada produto será registrado separadamente.'))return;
  merchantBulkPriceBusy=true;
  let completed=0,reason='';
  const merchantId=String(rt.merchant?.merchantId||'');
  try{
    for(const p of chosen){
      const now=globalThis.merchantRuntime||{};
      const current=(now.catalog||[]).find(x=>x.productCode===p.productCode);
      if(now.status!=='ready'||now.merchant?.merchantId!==merchantId||
         !['owner','manager'].includes(String(now.merchant?.memberRole||''))||
         now.actionPending===true||!current||current.updatedAt!==p.updatedAt||
         current.priceCents!==p.priceCents||current.availableStock!==p.availableStock||
         current.active!==true)throw new Error('O cadastro mudou. Atualize e revise os produtos restantes.');
      await merchantUpdateProductLive(p.productCode,p.priceCents,p.availableStock,true);
      const refreshed=(globalThis.merchantRuntime?.catalog||[]).find(x=>x.productCode===p.productCode);
      if(!refreshed||refreshed.priceCents!==p.priceCents||
         refreshed.availableStock!==p.availableStock||
         !merchantTimestampFresh(refreshed.priceConfirmedAt))
        throw new Error('Confirmação sem leitura atualizada. Revise a situação antes de continuar.');
      completed++;
    }
  }catch(error){reason=String(error?.message||error||'Erro ao confirmar');}
  finally{merchantBulkPriceBusy=false;}
  toast(reason
    ?completed+' de '+chosen.length+' preço(s) reconfirmado(s). Interrompido: '+reason
    :completed+' preço(s) reconfirmado(s) e verificado(s) no servidor.');
}
