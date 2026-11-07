// V1.883 — budget preview, not a charge or promised inventory.
// CPM candidate: R$12 per 1,000 independently verified display views.
const TAMAO_ADS_PROPOSED_CPM_CENTS=1200;
const TAMAO_ADS_PREVIEW_BUDGETS=[1990,4990,9990,19990];
function tamaoAdsBudgetPreview(budgetCents){
  const budget=Number(budgetCents);
  if(!Number.isSafeInteger(budget)||!TAMAO_ADS_PREVIEW_BUDGETS.includes(budget))
    return null;
  return {budgetCents:budget,cpmCents:TAMAO_ADS_PROPOSED_CPM_CENTS,
    maxViewableImpressions:Math.floor(budget*1000/TAMAO_ADS_PROPOSED_CPM_CENTS),
    chargeEnabled:false,inventoryVerified:false,guaranteedViews:0};
}
function tamaoAdsFormatMoney(cents){
  return 'R$ '+(cents/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function tamaoAdsBudgetQuote(){
  const budget=Number(document.getElementById('sponsor-cpm-budget')?.value);
  const quote=tamaoAdsBudgetPreview(budget);
  const node=document.getElementById('sponsor-cpm-result');
  if(!node)return;
  if(!quote){node.textContent='Selecione um orçamento válido.';return}
  const count=quote.maxViewableImpressions.toLocaleString('pt-BR');
  node.textContent='Equivalência do teto: até '+count+
    ' visualizações verificadas se houver público suficiente. Sem garantia de entrega ou cobrança nesta etapa.';
}
function tamaoAdsBudgetRequest(){
  const quote=tamaoAdsBudgetPreview(Number(document.getElementById('sponsor-cpm-budget')?.value));
  if(!quote)return;
  const city=String(document.getElementById('sponsor-cpm-city')?.value||'').trim().replace(/\s+/g,' ').slice(0,80);
  const state=String(document.getElementById('sponsor-cpm-state')?.value||'RS').trim().toUpperCase();
  const days=Number(document.getElementById('sponsor-cpm-days')?.value);
  if(!Number.isSafeInteger(days)||![7,15,30].includes(days)||!/^[A-Z]{2}$/.test(state)){
    document.getElementById('sponsor-cpm-result').textContent='Revise o período e a UF.';
    return;
  }
  const cityLabel=city?city+'/'+state:'UF '+state;
  const detail='Interesse em publicidade independente de revendas. Cidade: '+cityLabel+
    '. Prazo desejado: '+days+' dias. Teto solicitado: '+tamaoAdsFormatMoney(quote.budgetCents)+
    '. Simulação não vinculante: CPM proposto de '+tamaoAdsFormatMoney(quote.cpmCents)+
    ', equivalência de até '+quote.maxViewableImpressions+
    ' impressões verificadas, sem promessa de entrega. Solicito avaliar inventário e condições antes de qualquer cobrança.';
  openSponsorContact('visibility',detail);
}
function tamaoAdsPlannerSection(){
  const preset=tamaoAdsBudgetPreview(4990);
  const options=TAMAO_ADS_PREVIEW_BUDGETS.map(v=>
    '<option value="'+v+'"'+(v===4990?' selected':'')+'>'+tamaoAdsFormatMoney(v)+'</option>').join('');
  return '<section class="section" aria-label="Planejar uma campanha publicitária sem compromisso">'+
    '<div class="section-head"><div><span class="section-kicker">PLANEJE SUA DIVULGAÇÃO</span>'+
    '<h2>Um orçamento claro, sem pagar por visualizações inventadas.</h2>'+
    '<p>Publicidade regional é independente de cadastrar uma revenda. Estime seu teto de investimento e peça uma proposta.</p></div></div>'+
    '<div class="card flat form-stack" style="max-width:780px">'+
    '<div class="merchant-kpis"><div class="kpi"><span class="label">CPM em avaliação</span><strong>R$ 12,00</strong><small>por 1.000 visualizações verificadas</small></div>'+
    '<div class="kpi"><span class="label">Cobrança agora</span><strong>R$ 0,00</strong><small>exibições comerciais ainda não habilitadas</small></div></div>'+
    '<div class="field-row">'+
    '<div class="input-wrap"><label for="sponsor-cpm-budget">Teto de investimento</label><select id="sponsor-cpm-budget" class="input" onchange="tamaoAdsBudgetQuote()">'+options+'</select></div>'+
    '<div class="input-wrap"><label for="sponsor-cpm-days">Prazo desejado</label><select id="sponsor-cpm-days" class="input"><option value="7">7 dias</option><option value="15">15 dias</option><option value="30" selected>30 dias</option></select></div></div>'+
    '<div class="field-row">'+
    '<div class="input-wrap"><label for="sponsor-cpm-city">Cidade <small>(opcional)</small></label><input id="sponsor-cpm-city" class="input" maxlength="80" autocomplete="address-level2" placeholder="Ex.: São Gabriel"></div>'+
    '<div class="input-wrap"><label for="sponsor-cpm-state">Estado (UF)</label><input id="sponsor-cpm-state" class="input" maxlength="2" value="RS" autocomplete="address-level1" aria-describedby="sponsor-cpm-note"></div></div>'+
    '<p id="sponsor-cpm-result" role="status" aria-live="polite">Equivalência do teto: até '+
    preset.maxViewableImpressions.toLocaleString('pt-BR')+
    ' visualizações verificadas se houver público suficiente. Sem garantia de entrega ou cobrança nesta etapa.</p>'+
    '<p id="sponsor-cpm-note" class="tiny muted">Uma visualização exigirá pelo menos 50% do anúncio visível durante 1 segundo contínuo, além de filtros contra tráfego inválido. A estimativa não é reserva nem garantia de público; somente condições verificadas poderão gerar contrato e cobrança.</p>'+
    '<button type="button" class="primary" onclick="tamaoAdsBudgetRequest()">Solicitar proposta sem pagar →</button>'+
    '</div></section>';
}

