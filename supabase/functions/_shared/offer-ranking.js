export function chooseOffers(candidates){
  if(!Array.isArray(candidates)||!candidates.length)return[];
  if(candidates.length===1){
    return [{candidate:{...candidates[0],rankScore:0,recommendationScore:0},label:'available'}];
  }

  const ranked=candidates.map((candidate)=>({...candidate}));
  const minTotal=Math.min(...ranked.map(x=>x.totalCents));
  const maxTotal=Math.max(...ranked.map(x=>x.totalCents));
  const minEta=Math.min(...ranked.map(x=>x.etaMinMinutes));
  const maxEta=Math.max(...ranked.map(x=>x.etaMinMinutes));
  const maxActive=Math.max(1,...ranked.map(x=>Number(x.activeOrders||0)));
  const maxRecent=Math.max(1,...ranked.map(x=>Number(x.recentOrders7d||0)));

  for(const c of ranked){
    const priceNorm=maxTotal===minTotal?0:(c.totalCents-minTotal)/(maxTotal-minTotal);
    const etaNorm=maxEta===minEta?0:(c.etaMinMinutes-minEta)/(maxEta-minEta);
    const trustPenalty=(100-c.trustScore)/100;
    c.rankScore=priceNorm*0.40+etaNorm*0.35+trustPenalty*0.25;

    // Load is only a secondary tie-breaker. It can redistribute recommendation
    // among near-equivalent merchants, never promote a clearly worse offer.
    const activeLoad=Number(c.activeOrders||0)/maxActive;
    const recentLoad=Number(c.recentOrders7d||0)/maxRecent;
    c.recommendationScore=c.rankScore+(activeLoad*0.055)+(recentLoad*0.025);
  }

  const bestBase=Math.min(...ranked.map(x=>x.rankScore));
  const qualityBand=ranked.filter(x=>x.rankScore<=bestBase+0.10);
  const recommended=[...qualityBand].sort((a,b)=>
    a.recommendationScore-b.recommendationScore||
    a.rankScore-b.rankScore||
    a.totalCents-b.totalCents
  )[0];
  const cheapest=[...ranked].sort((a,b)=>a.totalCents-b.totalCents||a.etaMinMinutes-b.etaMinMinutes)[0];
  const fastest=[...ranked].sort((a,b)=>a.etaMinMinutes-b.etaMinMinutes||a.totalCents-b.totalCents)[0];

  const selected=[];
  const pushUnique=(candidate,label)=>{
    if(candidate&&!selected.some(x=>x.candidate.merchantId===candidate.merchantId)){
      selected.push({candidate,label});
    }
  };

  pushUnique(recommended,'recommended');
  pushUnique(cheapest,'cheapest');
  pushUnique(fastest,'fastest');

  for(const candidate of [...ranked].sort((a,b)=>
    a.recommendationScore-b.recommendationScore||
    a.rankScore-b.rankScore
  )){
    if(selected.length>=3)break;
    pushUnique(candidate,'alternative');
  }

  return selected.slice(0,3);
}
