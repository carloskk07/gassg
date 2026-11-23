// V1.1158 — saques manuais com aceite verificável do regulamento vigente.
const TAMAO_NETWORK_REDEMPTION_TERMS_URL='https://tamao.com.br/rede-regulamento-2026-11-22.html';
// V1.1034 — one-click, user-scoped manual withdrawal request. No PSP call.
const tamaoManualWithdrawal={userId:null,status:null,error:null,pending:false,key:null,generation:0};
// A different authenticated participant must never inherit a pending request,
// idempotency key, error or in-flight response from another browser session.
function tamaoManualPayoutSession(){
  const user=String(globalThis.liveRuntime?.session?.user?.id||'');
  const s=tamaoManualWithdrawal;
  if(s.userId!==user){
    s.userId=user;s.status=null;s.error=null;s.pending=false;s.key=null;
    s.generation++;
  }
  return {user,generation:s.generation};
}
function tamaoManualPayoutIsCurrent(user,generation){
  return tamaoManualWithdrawal.userId===user&&
    tamaoManualWithdrawal.generation===generation&&
    String(globalThis.liveRuntime?.session?.user?.id||'')===user;
}
async function tamaoManualPayoutInvoke(body={},key=null){
  const user=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!globalThis.liveReady?.()||!user)throw Error('Entre em sua conta para consultar os saques.');
  const token=await liveAccessToken();
  if(String(globalThis.liveRuntime?.session?.user?.id||'')!==user)
    throw Error('A sessão mudou.');
  const headers={'Content-Type':'application/json',
    apikey:CHAMA_BACKEND.publishableKey,
    Authorization:'Bearer '+token};
  if(key)headers['Idempotency-Key']=key;
  const response=await globalThis.chamaFetch(
    CHAMA_BACKEND.url+'/functions/v1/network-payout-ops',{
      method:'POST',cache:'no-store',headers,body:JSON.stringify(body)
    });
  let data=null;try{data=await response.json()}catch{}
  if(!response.ok)throw Error(data?.message||'Não foi possível validar o saque. Confira o extrato.');
  if(String(globalThis.liveRuntime?.session?.user?.id||'')!==user)
    throw Error('A sessão mudou.');
  return data;
}
async function tamaoManualPayoutRefresh(){
  const {user,generation}=tamaoManualPayoutSession();
  const s=tamaoManualWithdrawal;
  if(!user||s.pending)return;
  s.pending=true;
  try{
    const result=await tamaoManualPayoutInvoke({action:'manual-status'});
    if(!tamaoManualPayoutIsCurrent(user,generation))return;
    if(result?.source!=='network_manual_payout_status_v1_1034'||
       result?.readOnly!==true||result?.mode!=='manual'||
       result?.automaticPayouts!==false||
       !Number.isSafeInteger(Number(result.availableCents)))
      throw Error('Extrato de saques indisponível.');
    s.status=result;
    s.error=null;
  }catch(e){
    if(tamaoManualPayoutIsCurrent(user,generation))
      s.error=String(e?.message||e);
  }finally{
    if(tamaoManualPayoutIsCurrent(user,generation)){
      s.pending=false;
      if(['refer','earn'].includes(String(route())))render();
    }
  }
}
async function tamaoManualPayoutRequest(){
  const {user,generation}=tamaoManualPayoutSession();
  const s=tamaoManualWithdrawal;
  if(!user||s.pending||s.status?.canRequest!==true)return;
  if(globalThis.document?.getElementById('network-manual-terms-accept')?.checked!==true){
    toast('Leia e aceite o Regulamento da Rede para solicitar o saque.');
    return;
  }
  const min=BRL.format(Number(s.status.minimumCents)/100);
  if(!confirm('Solicitar saque manual do saldo validado? O mínimo é '+min+
    '. O TAMÃO conferirá os dados antes de aprovar; após a aprovação, o prazo é de até 3 dias corridos.'))return;
  if(!s.key)s.key='NETMANUAL'+crypto.randomUUID().replaceAll('-','');
  s.pending=true;
  try{
    const result=await tamaoManualPayoutInvoke({action:'manual-request',termsAccepted:true,termsReference:TAMAO_NETWORK_REDEMPTION_TERMS_URL},s.key);
    if(!tamaoManualPayoutIsCurrent(user,generation))return;
    if(result?.source!=='network_manual_request_v1_1034'||
       result?.state!=='requested'||result?.moneyMoved!==false)
      throw Error('Solicitação ainda não confirmada.');
    s.key=null;
    toast('Solicitação recebida. Aguardando conferência financeira e do destinatário.');
    s.status=null;
  }catch(e){
    if(tamaoManualPayoutIsCurrent(user,generation))
      toast(String(e?.message||e)+' Consulte o status antes de solicitar novamente.');
  }finally{
    if(tamaoManualPayoutIsCurrent(user,generation)){
      s.pending=false;
      await tamaoManualPayoutRefresh();
    }
  }
}
function tamaoNetworkManualPayoutDetailsPanel(){
  const {user}=tamaoManualPayoutSession();
  if(!user)return '';
  const s=tamaoManualWithdrawal;
  const d=s.userId===user?s.status:null;
  const req=d?.request;
  const due=req?.dueAt?new Date(req.dueAt):null;
  const statusLabels={
    requested:'Solicitado — aguardando conferência',
    approved:'Conferido — aguardando Pix manual',
    paid:'Pagamento manual conferido',
    cancelled:'Solicitação cancelada',
    review:'Retido para revisão financeira'
  };
  const disabled=s.pending?'disabled':'';
  return '<section class="card flat network-manual-payout" aria-label="Saques manuais da Rede">'+
    '<h3>Saques da Rede TAMÃO</h3>'+
    '<p class="tiny muted">Os saques serão pagos manualmente, depois da conferência de identidade, saldo e limite mínimo. O prazo é de até 3 dias corridos após a aprovação.</p>'+
    '<button type="button" class="secondary small" onclick="tamaoManualPayoutRefresh()" '+
    disabled+'>Consultar meu saque</button>'+
    (s.error?'<p class="notice">'+esc(s.error)+'</p>':'')+
    (d?
      '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Disponível para solicitar</span><strong>'+
        BRL.format(Number(d.availableCents)/100)+'</strong></div>'+
      '<div class="kpi"><span class="label">Saque mínimo</span><strong>'+
        (d.minimumCents==null?'A definir':BRL.format(Number(d.minimumCents)/100))+
      '</strong></div></div>'+
      (req?'<p><strong>'+esc(statusLabels[req.state]||'Em análise')+'</strong>'+
        ' • '+BRL.format(Number(req.amountCents)/100)+
        (due&&Number.isFinite(due.getTime())?
         '<br><small>Prazo após aprovação: '+esc(due.toLocaleString('pt-BR'))+'</small>':
         '<br><small>O prazo de pagamento ainda não começou.</small>')+'</p>':'')+
      (!d.minimumConfigured?'<p class="notice">O valor mínimo ainda será definido pela administração. Nenhum saque pode ser solicitado antes disso.</p>':'')+
      (d.minimumConfigured&&!d.accrualEnabled?
        '<p class="notice">A apuração de receitas pode estar ativa, mas a retirada exige termos aprovados para cada modalidade, saldo maduro e verificação de identidade.</p>':'')+
      (d.canRequest===true?
        '<label class="check-row lead-consent"><input type="checkbox" id="network-manual-terms-accept"><span>Li e concordo com o <a href="'+TAMAO_NETWORK_REDEMPTION_TERMS_URL+'" target="_blank" rel="noopener noreferrer">Regulamento da Rede TAMÃO (22/11/2026)</a> e entendo que o pagamento depende de aprovação e comprovação financeira.</span></label>'+
        '<button type="button" class="primary small" onclick="tamaoManualPayoutRequest()" '+
        disabled+'>Solicitar saque manual</button>':
        (!req||!['requested','approved','review'].includes(req.state)?
          '<p class="tiny muted">O botão será liberado ao atingir o mínimo com bonificações validadas e sem solicitação pendente.</p>':''))+
      '<p class="tiny muted">O pagamento não é automático nem depende de você vender ou transferir saldos para outras pessoas.</p>'
    :'<p class="tiny muted">Consulte para ver o saldo validado, o mínimo vigente e a situação do seu saque.</p>')+
    '</section>';
}


globalThis.tamaoNetworkManualPayoutDetailsPanel=tamaoNetworkManualPayoutDetailsPanel;
globalThis.tamaoManualPayoutRefresh=tamaoManualPayoutRefresh;
globalThis.tamaoManualPayoutRequest=tamaoManualPayoutRequest;
