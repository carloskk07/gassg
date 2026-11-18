// TAMÃO V1.1045 — Extrato de benefícios por origem, paginado e somente leitura.
// Loaded only when the participant asks. Never stores financial information locally.
const tamaoBenefitStatement={
  userId:null,generation:0,opened:false,busy:false,category:'all',
  page:0,items:[],hasMore:false,error:null
};
function tamaoBenefitsStatementSession(){
  const id=String(globalThis.liveRuntime?.session?.user?.id||'');
  const state=tamaoBenefitStatement;
  if(state.userId!==id){
    state.userId=id;state.generation++;state.opened=false;
    state.busy=false;state.category='all';state.page=0;
    state.items=[];state.hasMore=false;state.error=null;
  }
  return {id,generation:state.generation};
}
function tamaoBenefitsStatementStillCurrent(id,generation){
  return tamaoBenefitStatement.userId===id&&
    tamaoBenefitStatement.generation===generation&&
    String(globalThis.liveRuntime?.session?.user?.id||'')===id;
}
function tamaoBenefitsStatementRender(){
  if(['refer','club'].includes(String(route())))render();
}
async function tamaoBenefitsStatementFetch(reset=false){
  const {id,generation}=tamaoBenefitsStatementSession();
  const state=tamaoBenefitStatement;
  if(!globalThis.liveReady?.()||!id||state.busy)return;
  const page=reset?1:state.page+1;
  const category=state.category;
  if(page>100)return;
  state.busy=true;state.error=null;
  tamaoBenefitsStatementRender();
  try{
    const data=await liveInvoke('customer-summary',{
      statementOnly:true,statementCategory:category,statementPage:page
    });
    if(!tamaoBenefitsStatementStillCurrent(id,generation)||state.category!==category)return;
    if(data?.source!=='network_member_statement_v1_1045'||
       data.readOnly!==true||data.moneyMoved!==false||
       data.category!==category||data.page!==page||data.pageSize!==12||
       typeof data.hasMore!=='boolean'||!Array.isArray(data.items)||
       data.items.length>12||!data.items.every(i=>
         i&&typeof i.title==='string'&&typeof i.origin==='string'&&
         typeof i.detail==='string'&&typeof i.status==='string'&&
         ['wallet','network','discount','transfer'].includes(i.money_type)&&
         Number.isSafeInteger(i.amountCents)&&
         Number.isSafeInteger(i.amountMicrocents)&&
         i.unit==='BRL'&&typeof i.occurredAt==='string'))
      throw Error('Extrato não conferido. Nenhum valor foi presumido.');
    state.items=reset?data.items:state.items.concat(data.items);
    state.page=page;state.hasMore=data.hasMore;
    state.error=null;
  }catch(e){
    if(tamaoBenefitsStatementStillCurrent(id,generation))
      state.error=String(e?.message||'Não foi possível carregar o extrato.');
  }finally{
    if(tamaoBenefitsStatementStillCurrent(id,generation)){
      state.busy=false;tamaoBenefitsStatementRender();
    }
  }
}
async function tamaoBenefitsStatementOpen(){
  const {id}=tamaoBenefitsStatementSession();
  if(!id||!globalThis.liveReady?.())return;
  tamaoBenefitStatement.opened=true;
  if(!tamaoBenefitStatement.items.length&&!tamaoBenefitStatement.busy)
    await tamaoBenefitsStatementFetch(true);
  else tamaoBenefitsStatementRender();
}
async function tamaoBenefitsStatementFilter(key){
  if(!['all','rede','cashback','clube'].includes(key))return;
  const state=tamaoBenefitStatement;
  tamaoBenefitsStatementSession();
  if(state.busy||!state.opened||state.category===key)return;
  state.category=key;state.items=[];state.page=0;state.hasMore=false;
  await tamaoBenefitsStatementFetch(true);
}
function tamaoBenefitsStatementMoney(e){
  const cash=Math.abs(Number(e.amountCents));
  const micro=Math.abs(Number(e.amountMicrocents));
  const label=typeof BRL!=='undefined'?BRL.format(cash/100):
    (cash/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const value=micro>0&&cash===0?'menos de R$ 0,01':label;
  // Coupon face value is not withdrawable cash and can be used or expired.
  if(e.money_type==='discount'){
    const description={used:'Desconto utilizado',cancelled:'Cupom cancelado',
      expired:'Cupom vencido',reserved:'Cupom reservado',review:'Cupom em análise'};
    return (description[e.status]||'Cupom de desconto')+': '+value;
  }
  // A withdrawal request must never look like a paid bank transfer.
  if(e.money_type==='transfer'){
    const description={paid:'Saque pago',approved:'Saque aprovado',
      cancelled:'Saque cancelado',review:'Saque em conferência'};
    return (description[e.status]||'Saque solicitado')+': '+value;
  }
  return (Number(e.amountMicrocents)<0?'−':'+')+value;
}
function tamaoBenefitsStatementPanel(){
  tamaoBenefitsStatementSession();
  const state=tamaoBenefitStatement;
  if(!state.opened)return '';
  const filters=[['all','Tudo'],['rede','Rede'],['cashback','Cashback'],['clube','Cupons']];
  const titles={
    pending:'Em validação',validated:'Validado, sem saque',reserved:'Reservado',
    reversed:'Revertido',cancelled:'Cancelado',expired:'Vencido',
    used:'Utilizado',available:'Disponível como cupom',recorded:'Registrado',
    moved:'Transferência interna',review:'Em conferência',approved:'Saque aprovado',
    paid:'Pago com comprovante'
  };
  const tabs=filters.map(([key,name])=>
    '<button type="button" class="'+(state.category===key?'primary':'secondary')+
    ' small" aria-pressed="'+(state.category===key?'true':'false')+
    '" onclick="tamaoBenefitsStatementFilter(\''+key+'\')">'+name+'</button>'
  ).join('');
  const kindNames={
    wallet:'Movimento de saldo',network:'Participação na Rede',
    discount:'Cupom de desconto',transfer:'Solicitação de saque'
  };
  let previousMonth='';
  const entries=state.items.map(e=>{
    const money=tamaoBenefitsStatementMoney(e);
    const date=new Date(e.occurredAt);
    const validDate=Number.isFinite(date.getTime());
    const when=validDate?
      new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(date):
      'Data indisponível';
    const period=validDate?
      new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(date):
      'Data a confirmar';
    const monthTitle=period.charAt(0).toLocaleUpperCase('pt-BR')+period.slice(1);
    const monthHeading=previousMonth===period?'':'<h3 class="tamao-statement-month">'+
      esc(monthTitle)+'</h3>';
    previousMonth=period;
    const title=String(e.title).slice(0,100);
    const origin=String(e.origin).slice(0,100);
    const detail=String(e.detail).slice(0,250);
    const status=titles[e.status]||'Registrado';
    const tone=['reversed','cancelled','expired'].includes(e.status)?'inactive':
      ['pending','review','reserved','approved','validated'].includes(e.status)?'waiting':
      ['paid','used','available'].includes(e.status)?'complete':'neutral';
    const kind=kindNames[e.money_type]||'Benefício registrado';
    return monthHeading+'<article class="card flat tamao-benefit-statement-entry tamao-statement-'+tone+'">'+
      '<div class="tamao-statement-entry-top">'+
        '<div class="tamao-statement-entry-label"><span class="tamao-statement-kind">'+esc(kind)+'</span>'+
          '<strong>'+esc(title)+'</strong><small>'+esc(origin)+' · '+esc(when)+'</small></div>'+
        '<div class="tamao-statement-entry-money"><strong>'+esc(money)+'</strong>'+
          '<span class="tamao-statement-status">'+esc(status)+'</span></div>'+
      '</div>'+
      '<p class="tamao-statement-entry-detail">'+esc(detail)+'</p></article>';
  }).join('');
  return '<section class="section tamao-member-benefit-statement" aria-label="Extrato de benefícios por origem">'+
    '<div class="section-head"><div><span class="section-kicker">CADA VANTAGEM TEM UMA HISTÓRIA</span>'+
    '<h2>Seu extrato de benefícios</h2>'+
    '<p>Veja de onde veio cada crédito, comissão e desconto e acompanhe as conferências.</p>'+
    '</div></div>'+
    '<nav class="field-row tamao-statement-filters" aria-label="Filtrar extrato">'+tabs+'</nav>'+
    '<div class="form-stack" aria-live="polite">'+entries+
    (!entries&&!state.busy&&!state.error?
      '<p class="muted tiny">Ainda não há lançamentos nesta categoria. Os benefícios aparecem aqui quando são registrados.</p>':'')+
    (state.error?'<div class="notice" role="alert">'+esc(state.error)+
      ' <button class="ghost small" onclick="tamaoBenefitsStatementFetch(true)">Tentar novamente</button></div>':'')+
    (state.busy?'<p class="muted tiny" role="status">Conferindo seus lançamentos…</p>':'')+
    (!state.busy&&state.hasMore?
      '<button type="button" class="secondary" onclick="tamaoBenefitsStatementFetch(false)">Ver mais lançamentos</button>':'')+
    '</div>'+
    '<p class="tiny muted">Cashback é crédito para compras; cupons são descontos. Comissões e participações da Rede podem ter regras próprias de validação e saque. Uma transferência entre saldos não é um ganho novo, e valores em análise não são dinheiro disponível.</p>'+
    '</section>';
}
globalThis.tamaoBenefitsStatementOpen=tamaoBenefitsStatementOpen;
globalThis.tamaoBenefitsStatementFilter=tamaoBenefitsStatementFilter;
globalThis.tamaoBenefitsStatementFetch=tamaoBenefitsStatementFetch;
globalThis.tamaoBenefitsStatementPanel=tamaoBenefitsStatementPanel;
