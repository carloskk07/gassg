export function clamp01(value){
  const n=Number(value);
  if(!Number.isFinite(n))return 0;
  return Math.max(0,Math.min(1,n));
}

export function effectiveUnitPrice({
  pricingMode='fixed',
  pricingStrategy='balanced',
  minPriceCents,
  preferredPriceCents,
  maxPriceCents,
  availableStock=0,
  requestedQuantity=1,
  activeOrders=0,
  recentOrders7d=0
}={}){
  const preferred=Math.max(1,Math.trunc(Number(preferredPriceCents)||0));
  if(String(pricingMode)!=='range')return preferred;

  const min=Math.max(1,Math.trunc(Number(minPriceCents)||preferred));
  const max=Math.max(min,Math.trunc(Number(maxPriceCents)||preferred));
  const pref=Math.max(min,Math.min(max,preferred));
  const qty=Math.max(1,Math.trunc(Number(requestedQuantity)||1));
  const stock=Math.max(qty,Math.trunc(Number(availableStock)||qty));

  const activePressure=clamp01(Number(activeOrders||0)/5);
  const coverage=stock/qty;
  const stockPressure=clamp01((5-coverage)/4);
  const recentPressure=clamp01(Number(recentOrders7d||0)/100);
  const operationalPressure=clamp01(
    activePressure*0.55+
    stockPressure*0.30+
    recentPressure*0.15
  );

  let position;
  if(pricingStrategy==='volume')position=operationalPressure*0.80;
  else if(pricingStrategy==='margin')position=0.50+operationalPressure*0.50;
  else position=0.25+operationalPressure*0.50;
  position=clamp01(position);

  let target;
  if(position<=0.5){
    const ratio=position/0.5;
    target=min+(pref-min)*ratio;
  }else{
    const ratio=(position-0.5)/0.5;
    target=pref+(max-pref)*ratio;
  }

  return Math.max(min,Math.min(max,Math.round(target)));
}
