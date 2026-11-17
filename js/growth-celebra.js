// TAMÃO Celebra V1.1046 — seasonal recognition, only for approved server campaigns.
// No fake balances, recurring income, visit rewards or synthetic celebrations.
function tamaoNetworkCelebraPanel(){
  const raw=globalThis.liveRuntime?.networkCelebra;
  if(raw?.available!==true||raw?.source!=='network_celebra_user_v1_1046'||
     raw.readOnly!==true||raw.cashPayoutsEnabled!==false||
     !Array.isArray(raw.items)||raw.items.length>2)return '';
  const phase={upcoming:'Em breve',active:'Campanha em andamento',ended:'Período encerrado'};
  const cards=raw.items.map(c=>{
    if(!['natal_2026','ano_novo_2027'].includes(c?.key)||
       !['upcoming','active','ended'].includes(c?.phase)||
       !Number.isSafeInteger(c.extraBps)||c.extraBps<1||c.extraBps>100||
       !Number.isSafeInteger(c.memberLimitCents)||c.memberLimitCents<0||
       !Number.isSafeInteger(c.validatedCents)||c.validatedCents<0)return '';
    const start=new Date(c.startsAt),end=new Date(c.endsAt);
    const when=(Number.isFinite(start.getTime())&&Number.isFinite(end.getTime()))?
      new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',
        timeZone:'America/Sao_Paulo'}).format(start)+' a '+
      new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',
        timeZone:'America/Sao_Paulo'}).format(new Date(end.getTime()-1000)):'';
    const benefit=c.validatedCents>0?
      '<p class="tiny"><strong>Bônus especial verificado: '+
       BRL.format(c.validatedCents/100)+'</strong> · ainda sem saque</p>':'';
    return '<article class="card flat" aria-label="Campanha da Rede">'+
      '<span class="section-kicker">'+esc(phase[c.phase])+'</span>'+
      '<h3>'+(c.key==='natal_2026'?'🎄 ':'✨ ')+esc(c.title)+'</h3>'+
      '<p class="muted">'+esc(c.message)+'</p>'+
      '<p class="tiny"><strong>Até '+esc(String(c.extraBps/100))+
      ' ponto percentual extra</strong> sobre receita líquida de primeira indicação elegível. '+
      'Máximo de '+BRL.format(c.memberLimitCents/100)+' por participante, '+
      'conforme orçamento e termos publicados.</p>'+
      (when?'<p class="muted tiny">'+esc(when)+'</p>':'')+
      benefit+
      '<p class="muted tiny">Compras, serviços e campanhas só pontuam quando a receita é confirmada. '+
      'Visitas e cadastros não geram bônus. Não há saque nem rendimento garantido.</p>'+
      (c.phase==='active'?
        '<button class="secondary small" type="button" onclick="shareReferral()">Compartilhar meu convite</button>':'')+
      '</article>';
  }).filter(Boolean).join('');
  return cards?'<section class="section" aria-label="TAMÃO Celebra">'+
    '<div class="section-head"><div><span class="section-kicker">VOCÊ FAZ PARTE</span>'+
    '<h2>TAMÃO Celebra</h2>'+
    '<p>Datas especiais para reconhecer indicações que ajudam a comunidade a crescer.</p>'+
    '</div></div><div class="grid cards-2">'+cards+'</div></section>':'';
}
globalThis.tamaoNetworkCelebraPanel=tamaoNetworkCelebraPanel;
