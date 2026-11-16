/* Deferred superadmin-only Rede Pix Payouts workbench.
 * Owner actions are never retried automatically and are not money proofs. */
const adminNetworkPayoutRuntime={
  overview:null,selected:null,loading:false,error:null,
  actorId:'',lastReservationKey:'',lastReservationPayload:''
};
function adminNetworkPayoutActor(){
  const user=String(adminRuntime.session?.user?.id||'');
  return adminReady()&&adminCurrentRole()==='superadmin'&&user?user:null;
}
async function adminNetworkPayoutInvoke(payload,options={}){
  const actor=adminNetworkPayoutActor();
  if(!actor)throw Error('Acesso exclusivo ao superadmin.');
  const token=await adminAccessToken();
  if(actor!==adminNetworkPayoutActor())throw Error('A sessão administrativa mudou.');
  const headers={
    'Content-Type':'application/json',
    apikey:CHAMA_BACKEND.publishableKey,
    Authorization:'Bearer '+token
  };
  if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
  // The outgoing execution call is ALWAYS single-shot.
  const res=await globalThis.chamaFetch(
    CHAMA_BACKEND.url+'/functions/v1/network-payout-ops',{
      method:'POST',headers,body:JSON.stringify(payload),cache:'no-store'
    });
  let data=null;try{data=await res.json()}catch{}
  if(actor!==adminNetworkPayoutActor())throw Error('A sessão mudou durante a operação.');
  if(!res.ok){
    const e=new Error(data?.message||data?.error||'Operação de saque não confirmada.');
    e.code=data?.error||'PAYOUT_HTTP_ERROR';e.status=res.status;e.data=data;
    throw e;
  }
  return data;
}
async function adminNetworkPayoutRefresh(){
  const actor=adminNetworkPayoutActor();
  if(!actor||adminNetworkPayoutRuntime.loading)return;
  adminNetworkPayoutRuntime.loading=true;adminNetworkPayoutRuntime.error=null;
  try{
    const result=await adminNetworkPayoutInvoke({action:'overview'});
    if(result?.source!=='network_payout_executor_v1_1033'||
      result.readOnly!==true||result.autoTransferEnabled!==false||
      !Array.isArray(result.recentJobs))
      throw Error('Resumo de saques não confirmado pelo servidor.');
    if(adminNetworkPayoutActor()!==actor)return;
    adminNetworkPayoutRuntime.overview=result;
  }catch(e){adminNetworkPayoutRuntime.error=String(e?.message||e)}
  finally{adminNetworkPayoutRuntime.loading=false;render()}
}
async function adminNetworkPayoutSelect(id){
  if(!adminNetworkPayoutActor()||adminNetworkPayoutRuntime.loading)return;
  adminNetworkPayoutRuntime.loading=true;
  try{
    const job=await adminNetworkPayoutInvoke({action:'job',jobId:id});
    if(job?.source!=='network_payout_job_v1_1033'||job.jobId!==id)
      throw Error('Saque não confirmado.');
    adminNetworkPayoutRuntime.selected=job;
    adminNetworkPayoutRuntime.error=null;
  }catch(e){adminNetworkPayoutRuntime.error=String(e?.message||e)}
  finally{adminNetworkPayoutRuntime.loading=false;render()}
}
async function adminNetworkPayoutFileHash(inputId){
  const file=document.getElementById(inputId)?.files?.[0];
  if(!file||!file.size||file.size>5242880)throw Error('Selecione um comprovante de até 5 MB.');
  const bytes=await file.arrayBuffer();
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...digest].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function adminNetworkPayoutGet(id){
  return String(document.getElementById(id)?.value||'').trim();
}
async function adminNetworkPayoutWrite(payload,options={}){
  if(!adminNetworkPayoutActor()||adminNetworkPayoutRuntime.loading)return null;
  adminNetworkPayoutRuntime.loading=true;
  try{
    const data=await adminNetworkPayoutInvoke(payload,options);
    adminNetworkPayoutRuntime.error=null;
    return data;
  }catch(e){
    adminNetworkPayoutRuntime.error=String(e?.message||e);
    throw e;
  }finally{adminNetworkPayoutRuntime.loading=false;render()}
}
async function adminNetworkPayoutRegister(){
  const userId=adminNetworkPayoutGet('network-payout-user-id');
  const cpf=adminNetworkPayoutGet('network-payout-cpf');
  const ref=adminNetworkPayoutGet('network-payout-identity-ref');
  if(!/^[0-9a-f-]{36}$/i.test(userId)||!cpf||ref.length<20)return toast('Informe o usuário, chave CPF e referência da identidade conferida.');
  if(!confirm('Você conferiu DOCUMENTOS REAIS e confirmou que a chave Pix CPF pertence ao beneficiário? Esta ação não transfere dinheiro.'))return;
  try{
    const hash=await adminNetworkPayoutFileHash('network-payout-identity-file');
    const data=await adminNetworkPayoutWrite({
      action:'beneficiary',userId,cpfPixKey:cpf,identityProofReference:ref,
      identityProofSha256:hash,confirmation:'IDENTIDADE E CPF VERIFICADOS'
    });
    if(data?.verified!==true||data?.rawPixReturned!==false)throw Error('Beneficiário não confirmado.');
    const field=document.getElementById('network-payout-cpf');if(field)field.value='';
    toast('Beneficiário protegido e validado. Nenhum Pix enviado.');
    await adminNetworkPayoutRefresh();
  }catch(e){toast(String(e?.message||e))}
}
async function adminNetworkPayoutReserve(){
  const userId=adminNetworkPayoutGet('network-payout-user-id');
  const raw=adminNetworkPayoutGet('network-payout-amount').replace(',','.');
  const cents=Math.round(Number(raw)*100);
  if(!/^[0-9a-f-]{36}$/i.test(userId)||!Number.isSafeInteger(cents)||cents<100)
    return toast('Selecione beneficiário e valor de pelo menos R$ 1.');
  if(!confirm('Reservar '+BRL.format(cents/100)+' das bonificações VÁLIDAS deste beneficiário? Não é um saque.'))return;
  const fingerprint=userId+'|'+cents;
  if(adminNetworkPayoutRuntime.lastReservationPayload!==fingerprint){
    adminNetworkPayoutRuntime.lastReservationPayload=fingerprint;
    adminNetworkPayoutRuntime.lastReservationKey='NTP'+crypto.randomUUID().replaceAll('-','');
  }
  try{
    const key=adminNetworkPayoutRuntime.lastReservationKey;
    const reserved=await adminNetworkPayoutWrite({action:'reserve',userId,amountCents:cents},
      {idempotencyKey:key});
    if(reserved?.source!=='network_payout_reservation_v1_1031'||
      reserved?.moneyMoved!==false||!reserved.reservationId)
      throw Error('Reserva não confirmada.');
    // The reservation is atomic; the follow-up is idempotent and creates
    // no external payout.
    const created=await adminNetworkPayoutWrite({
      action:'prepare',reservationId:reserved.reservationId
    });
    if(created?.source!=='network_payout_job_v1_1033'||!created?.jobId)
      throw Error('Reserva registrada; abra o histórico antes de repetir.');
    adminNetworkPayoutRuntime.lastReservationPayload='';
    await adminNetworkPayoutRefresh();
    await adminNetworkPayoutSelect(created.jobId);
    toast('Saque preparado. Ainda não há permissão para enviar Pix.');
  }catch(e){
    toast(String(e?.message||e)+' Confira o histórico antes de repetir.');
  }
}
async function adminNetworkPayoutAuthorize(){
  const j=adminNetworkPayoutRuntime.selected;
  if(!j||j.state!=='prepared')return;
  if(!confirm('AUTORIZAR transferência de '+BRL.format(j.amountCents/100)+'? Confira comprovante de identidade, destinatário e saldo antes.'))return;
  try{
    const result=await adminNetworkPayoutWrite({
      action:'authorize',jobId:j.jobId,expectedAmountCents:j.amountCents,
      expectedPixKeyHash:j.pixKeyHash,confirmation:'AUTORIZO PIX'
    });
    if(result?.authorized!==true||result?.moneyMoved!==false)throw Error('Autorização não confirmada.');
    await adminNetworkPayoutSelect(j.jobId);
    toast('Autorizado, mas ainda NÃO enviado ao provedor.');
  }catch(e){toast(String(e?.message||e))}
}
async function adminNetworkPayoutExecute(){
  const j=adminNetworkPayoutRuntime.selected;
  if(!j||j.state!=='authorized')return;
  if(!confirm('ENVIAR PIX REAL de '+BRL.format(j.amountCents/100)+' para o beneficiário verificado? Esta ação pode movimentar dinheiro e NÃO será repetida automaticamente.'))return;
  try{
    const result=await adminNetworkPayoutWrite({
      action:'execute',jobId:j.jobId,confirmation:'ENVIAR PIX'
    });
    if(result?.state!=='submitted'||result.recipientCredited!==false)
      throw Error('Resultado de envio inconclusivo. NÃO tente pagar novamente.');
    await adminNetworkPayoutSelect(j.jobId);
    toast('Provedor aceitou o envio. Crédito bancário ainda não comprovado.');
  }catch(e){
    toast(String(e?.message||e)+' Se houver tentativa incerta, NÃO reenvie.');
    await adminNetworkPayoutRefresh();
  }
}
async function adminNetworkPayoutReconcile(){
  const j=adminNetworkPayoutRuntime.selected;
  if(!j?.jobId)return;
  try{
    const result=await adminNetworkPayoutWrite({action:'reconcile',jobId:j.jobId});
    if(result?.source!=='network_payout_observation_v1_1033')
      throw Error('Consulta bancária não validada.');
    await adminNetworkPayoutSelect(j.jobId);
    toast('Status do provedor conferido: '+result.state+'. Ainda precisa de comprovante independente.');
  }catch(e){toast(String(e?.message||e))}
}
async function adminNetworkPayoutRecover(){
  const j=adminNetworkPayoutRuntime.selected;
  if(!j||!['uncertain','dispatching','submitted'].includes(j.state))return;
  const payout=adminNetworkPayoutGet('network-payout-recover-pop');
  const transaction=adminNetworkPayoutGet('network-payout-recover-top');
  if(!/^POP[A-Za-z0-9_-]{8,75}$/.test(payout)||
     !/^TOP[A-Za-z0-9_-]{8,75}$/.test(transaction))
    return toast('Informe os identificadores oficiais POP/TOP obtidos no Mercado Pago.');
  if(!confirm('Reconciliar IDs do provedor SEM gerar outro Pix? Nunca reenvie uma transferência incerta.'))return;
  try{
    const result=await adminNetworkPayoutWrite({
      action:'recover',jobId:j.jobId,
      providerPayoutId:payout,providerTransactionId:transaction
    });
    if(result?.source!=='network_payout_recovered_v1_1033'||
       result.postRetried!==false)throw Error('Recuperação não comprovada.');
    await adminNetworkPayoutSelect(j.jobId);
    toast('Transação encontrada no provedor e vinculada sem novo envio.');
  }catch(e){toast(String(e?.message||e))}
}
async function adminNetworkPayoutConfirmBank(){
  const j=adminNetworkPayoutRuntime.selected;
  if(!j||j.state!=='credited_unverified')return;
  const ref=adminNetworkPayoutGet('network-payout-receipt-ref');
  if(ref.length<20)return toast('Identifique o comprovante bancário independente, não o código informado pelo próprio TAMÃO.');
  if(!confirm('Você confirmou no EXTRATO/COMPROVANTE OFICIAL o Pix, o valor, o beneficiário e a titularidade, independentemente da resposta da API?'))return;
  try{
    const hash=await adminNetworkPayoutFileHash('network-payout-receipt-file');
    const result=await adminNetworkPayoutWrite({
      action:'confirm-bank',jobId:j.jobId,receiptReference:ref,
      receiptSha256:hash,confirmation:'CONFERI COMPROVANTE E TITULAR'
    });
    if(result?.state!=='paid'||result.evidenceRecorded!==true)
      throw Error('Liquidação não comprovada.');
    await adminNetworkPayoutSelect(j.jobId);
    toast('Saque marcado como pago após comprovação independente.');
  }catch(e){toast(String(e?.message||e))}
}
async function adminNetworkPayoutCancelPrepared(){
  const j=adminNetworkPayoutRuntime.selected;
  if(!j||j.state!=='prepared')return;
  if(!confirm('Cancelar esta preparação e liberar a reserva? Nenhum Pix pode ter sido enviado.'))return;
  try{
    const r=await adminNetworkPayoutWrite({action:'cancel-prepared',jobId:j.jobId});
    if(r?.state!=='cancelled'||r?.providerCalled!==false)throw Error('Cancelamento não confirmado.');
    await adminNetworkPayoutSelect(j.jobId);
    toast('Reserva liberada sem Pix.');
  }catch(e){toast(String(e?.message||e))}
}
async function adminNetworkPayoutPolicy(enabled){
  if(!adminNetworkPayoutActor())return;
  if(enabled&&!confirm('Habilitar a EXECUÇÃO REAL por saque com autorização individual? Necessita credenciais exclusivas, assinatura Ed25519, autorização do provedor e termos efetivos.'))return;
  if(!enabled&&!confirm('Suspender imediatamente novas autorizações de Pix de saída?'))return;
  const ref=enabled?adminNetworkPayoutGet('network-payout-policy-ref'):'';
  try{
    const x=await adminNetworkPayoutWrite({
      action:'enable',enabled,approvalReference:ref,
      confirmation:enabled?'AUTORIZO EXECUCAO FINANCEIRA':null
    });
    if(x?.source!=='network_payout_execution_policy_v1_1033'||
      x.executionEnabled!==enabled)throw Error('Decisão não registrada.');
    await adminNetworkPayoutRefresh();
    toast(enabled?'Execução individual autorizada; cada Pix ainda requer decisão.':'Novas execuções de saída suspensas.');
  }catch(e){toast(String(e?.message||e))}
}
function adminNetworkPayoutPanel(){
  if(!adminNetworkPayoutActor())return '';
  const state=adminNetworkPayoutRuntime, d=state.overview,j=state.selected;
  const active=state.loading;
  const field=(id,label,placeholder,type='text')=>'<label>'+esc(label)+
    '<input class="input" type="'+type+'" id="'+id+'" placeholder="'+esc(placeholder)+'"></label>';
  const action=(label,fn,kind='secondary')=>'<button type="button" class="'+kind+' small" '+
    (active?'disabled ':'')+'onclick="'+fn+'">'+esc(label)+'</button>';
  const recent=(d?.recentJobs||[]).map(x=>
    '<div class="list-row"><div><strong>'+BRL.format(Number(x.amountCents||0)/100)+
    '</strong><br><small>'+esc(String(x.state||''))+' • '+esc(String(x.jobId||'').slice(0,8))+
    '</small></div>'+action('Abrir','adminNetworkPayoutSelect(\''+esc(x.jobId)+'\')')+'</div>').join('');
  let details='';
  if(j){
    details='<div class="card flat"><h4>Saque selecionado — '+esc(j.state)+'</h4>'+
      '<p>Valor: <strong>'+BRL.format(Number(j.amountCents||0)/100)+'</strong>'+
      ' • Prova do destinatário: <code>'+esc(String(j.pixKeyHash||'').slice(0,12))+'…</code></p>'+
      '<p class="tiny muted">Referência do provedor: '+esc(j.providerPayoutId||'não enviada')+
      '. Nenhuma ação nesta tela representa pagamento sem confirmação bancária.</p><div class="order-actions">'+
      (j.state==='prepared'?action('Autorizar saída','adminNetworkPayoutAuthorize()')+
        action('Cancelar preparação','adminNetworkPayoutCancelPrepared()','ghost'):'')+
      (j.state==='authorized'?action('Enviar Pix real','adminNetworkPayoutExecute()','primary'):'')+
      (['submitted','credited_unverified','paid','review'].includes(j.state)?
        action('Consultar transação oficial','adminNetworkPayoutReconcile()'):'')+
      '</div>'+
      (['uncertain','dispatching'].includes(j.state)?
        '<div class="form-stack"><h4>Recuperar envio incerto — somente consulta</h4>'+
        '<p class="tiny muted">Localize os IDs de lote e transação pelo código '+esc(j.externalReference)+
        ' no painel oficial do Mercado Pago. NÃO clique em Enviar novamente.</p>'+
        field('network-payout-recover-pop','Lote MP Payouts','POP…')+
        field('network-payout-recover-top','Transação MP Payouts','TOP…')+
        action('Conferir pelo GET (sem Pix)','adminNetworkPayoutRecover()')+'</div>':'')+
      (j.state==='credited_unverified'?
        '<div class="form-stack"><h4>Comprovação independente do crédito</h4>'+
        field('network-payout-receipt-ref','Referência no extrato bancário','Comprovante oficial da transferência')+
        '<label>Arquivo do comprovante local (hash SHA-256; não enviado ao TAMÃO)'+
        '<input type="file" class="input" id="network-payout-receipt-file" accept="application/pdf,image/*"></label>'+
        action('Confirmar titular e comprovante','adminNetworkPayoutConfirmBank()','primary')+
        '</div>':'')+'</div>';
  }
  return '<section class="section admin-network-payouts"><div class="section-head">'+
    '<div><span class="section-kicker">REDE TAMÃO • SAQUES</span>'+
    '<h3>Execução e conciliação de saques Pix</h3>'+
    '<p>Transferências individuais, sem envios automáticos. Reserva não é pagamento; sucesso do provedor não é prova de titularidade.</p></div>'+
    action('Atualizar','adminNetworkPayoutRefresh()')+'</div>'+
    (state.error?'<p class="notice danger">'+esc(state.error)+'</p>':'')+
    (!d?'<p class="muted">Use Atualizar para consultar o status da execução.</p>':
    '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Execução de saques</span><strong>'+
      (d.executionEnabled?'Autorizada por operação':'Bloqueada')+'</strong></div>'+
      '<div class="kpi"><span class="label">Preparações</span><strong>'+Number(d.jobs||0)+'</strong></div>'+
      '<div class="kpi"><span class="label">Em revisão</span><strong>'+Number(d.needsReview||0)+'</strong></div>'+
      '<div class="kpi"><span class="label">Pago com comprovação</span><strong>'+
      BRL.format(Number(d.paidWithIndependentProofCents||0)/100)+'</strong></div></div>'+
      '<p class="tiny muted">Nenhum Pix será enviado enquanto a autorização do provedor e as credenciais exclusivas não estiverem validadas. A apuração de 10% é independente da execução bancária.</p>'+
      (d.executionEnabled?action('Pausar execução','adminNetworkPayoutPolicy(false)','ghost'):
      '<details class="card flat"><summary>Ativação financeira controlada</summary><div class="form-stack">'+
      field('network-payout-policy-ref','Referência comprovada da autorização do provedor e termos',
        'Documento e aprovação do provedor, mínimo 20 caracteres')+
      action('Ativar apenas após provas','adminNetworkPayoutPolicy(true)')+'</div></details>')+
      '<details class="card flat"><summary>Beneficiário e nova reserva</summary>'+
      '<div class="form-stack">'+
      field('network-payout-user-id','ID do usuário beneficiário','UUID da conta cadastrada')+
      field('network-payout-cpf','Chave Pix CPF conferida com a identidade','CPF cadastrado como chave Pix')+
      field('network-payout-identity-ref','Referência da verificação externa de identidade','Documento conferido, processo, data')+
      '<label>Comprovante de identidade (arquivo local, somente hash SHA-256)'+
      '<input class="input" type="file" id="network-payout-identity-file" accept="application/pdf,image/*"></label>'+
      action('Registrar destinatário verificado','adminNetworkPayoutRegister()')+
      '<hr><p class="tiny">A reserva só utilizará bonificações maduras de fontes conciliadas, sem novo dinheiro.</p>'+
      field('network-payout-amount','Valor da reserva (R$)','1,00 ou mais')+
      action('Reservar e preparar saque','adminNetworkPayoutReserve()')+
      '</div></details>'+
      '<details class="card flat" open><summary>Saques recentes</summary><div class="list">'+
      (recent||'<p class="tiny muted">Nenhum saque registrado.</p>')+'</div></details>')+
      details+
    '</section>';
}
globalThis.adminNetworkPayoutPanel=adminNetworkPayoutPanel;
globalThis.adminNetworkPayoutRefresh=adminNetworkPayoutRefresh;
globalThis.adminNetworkPayoutSelect=adminNetworkPayoutSelect;
globalThis.adminNetworkPayoutRegister=adminNetworkPayoutRegister;
globalThis.adminNetworkPayoutReserve=adminNetworkPayoutReserve;
globalThis.adminNetworkPayoutAuthorize=adminNetworkPayoutAuthorize;
globalThis.adminNetworkPayoutExecute=adminNetworkPayoutExecute;
globalThis.adminNetworkPayoutReconcile=adminNetworkPayoutReconcile;
globalThis.adminNetworkPayoutConfirmBank=adminNetworkPayoutConfirmBank;
globalThis.adminNetworkPayoutCancelPrepared=adminNetworkPayoutCancelPrepared;
globalThis.adminNetworkPayoutPolicy=adminNetworkPayoutPolicy;

globalThis.adminNetworkPayoutRecover=adminNetworkPayoutRecover;


// TAMÃO V1.1034: operative payout mode is manual, never an automated PSP POST.
const adminManualPayoutState={queue:null,pending:false,error:null};
async function adminNetworkManualPayoutRefresh(){
  if(!adminNetworkPayoutActor()||adminManualPayoutState.pending)return;
  adminManualPayoutState.pending=true;
  try{
    const data=await adminNetworkPayoutInvoke({action:'manual-queue'});
    if(data?.source!=='network_manual_queue_v1_1034'||
       data?.readOnly!==true||data?.manualOnly!==true||
       data?.paymentDays!==3||!Array.isArray(data.items))
      throw Error('Fila de saques manuais não verificada.');
    adminManualPayoutState.queue=data;
    adminManualPayoutState.error=null;
  }catch(e){adminManualPayoutState.error=String(e?.message||e)}
  finally{adminManualPayoutState.pending=false;render()}
}
async function adminNetworkManualPayoutMinimum(){
  const raw=String(document.getElementById('manual-payout-minimum')?.value||'');
  const cents=raw===''?null:Number(raw);
  if(cents!==null&&(!Number.isSafeInteger(cents)||cents<100))
    return toast('Escolha um valor mínimo válido na lista.');
  if(!confirm(cents===null?'Suspender novas solicitações de saque?':
    'Definir saque mínimo da Rede em '+BRL.format(cents/100)+'? A regra não transfere dinheiro.'))return;
  if(adminManualPayoutState.pending)return;
  adminManualPayoutState.pending=true;
  try{
    const data=await adminNetworkPayoutInvoke({
      action:'manual-set-minimum',minimumCents:cents,confirmation:'DEFINIR LIMITE'
    });
    if(data?.source!=='network_manual_policy_v1_1034'||
      data?.minimumCents!==cents||data?.automaticPayouts!==false||
      data?.moneyMoved!==false)throw Error('Limite não confirmado pelo banco.');
    toast('Limite de saque salvo. Pagamento permanece manual.');
  }catch(e){toast(String(e?.message||e))}
  finally{adminManualPayoutState.pending=false;await adminNetworkManualPayoutRefresh()}
}
async function adminNetworkManualPayoutApprove(id){
  if(adminManualPayoutState.pending)return;
  const req=(adminManualPayoutState.queue?.items||[]).find(x=>x.requestId===id);
  if(!req||req.state!=='requested')return;
  if(!confirm('Conferiu a identidade, a chave Pix CPF e o saldo VALIDADO de '+
     BRL.format(Number(req.amountCents)/100)+'? O prazo de 3 DIAS CORRIDOS só começa após esta aprovação.'))return;
  adminManualPayoutState.pending=true;
  try{
    const data=await adminNetworkPayoutInvoke({action:'manual-approve',
       requestId:id,confirmation:'IDENTIDADE E SALDO CONFERIDOS'});
    if(data?.source!=='network_manual_approval_v1_1034'||
      data?.state!=='approved'||data?.moneyMoved!==false||
      !Number.isFinite(Date.parse(data.dueAt)))
      throw Error('Conferência não confirmada.');
    toast('Conferido. Prazo de até 3 dias corridos iniciado; nenhum Pix enviado automaticamente.');
  }catch(e){toast(String(e?.message||e))}
  finally{adminManualPayoutState.pending=false;await adminNetworkManualPayoutRefresh()}
}
async function adminNetworkManualPayoutCancel(id){
  if(adminManualPayoutState.pending)return;
  const req=(adminManualPayoutState.queue?.items||[]).find(x=>x.requestId===id);
  if(!req||req.state!=='requested')return;
  if(!confirm('Confirma que NÃO HOUVE pagamento bancário e que esta solicitação ainda não foi aprovada? A reserva será liberada.'))return;
  adminManualPayoutState.pending=true;
  try{
    const data=await adminNetworkPayoutInvoke({action:'manual-cancel',
       requestId:id,confirmation:'NAO HOUVE PAGAMENTO'});
    if(data?.source!=='network_manual_cancel_v1_1034'||
      data?.fundsReleased!==true||data?.bankTransferMade!==false)
      throw Error('Cancelamento não confirmado.');
    toast('Solicitação não aprovada cancelada. Saldo devolvido ao disponível.');
  }catch(e){toast(String(e?.message||e))}
  finally{adminManualPayoutState.pending=false;await adminNetworkManualPayoutRefresh()}
}
async function adminNetworkManualPayoutMarkPaid(id){
  if(adminManualPayoutState.pending)return;
  const req=(adminManualPayoutState.queue?.items||[]).find(x=>x.requestId===id);
  if(!req||req.state!=='approved')return;
  const ref=String(document.getElementById('manual-payout-ref-'+id)?.value||'').trim();
  if(ref.length<20)return toast('Informe a referência verificável do Pix bancário já realizado.');
  const file=document.getElementById('manual-payout-file-'+id)?.files?.[0];
  if(!file||!file.size||file.size>5242880)
    return toast('Selecione o comprovante bancário real de até 5 MB.');
  if(!confirm('Você já FEZ o Pix no banco e conferiu o beneficiário, o CPF, o valor exato '+
    BRL.format(Number(req.amountCents)/100)+' e a referência no comprovante? Isto apenas registra o pagamento, não envia dinheiro.'))return;
  adminManualPayoutState.pending=true;
  try{
    const raw=new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
    const sha=[...raw].map(n=>n.toString(16).padStart(2,'0')).join('');
    const data=await adminNetworkPayoutInvoke({
      action:'manual-paid',requestId:id,amountCents:req.amountCents,
      recipientPixHash:req.recipientPixHash,bankReference:ref,
      receiptSha256:sha,confirmation:'CONFERI PIX EXTERNO E DESTINATARIO'
    });
    if(data?.source!=='network_manual_paid_record_v1_1034'||
      data?.state!=='paid'||data?.manualEvidenceRecorded!==true||
      data?.providerApiCalled!==false)
      throw Error('Pagamento manual não registrado.');
    toast('Pagamento externo registrado com comprovante. Nenhum Pix foi criado pelo TAMÃO.');
  }catch(e){toast(String(e?.message||e))}
  finally{adminManualPayoutState.pending=false;await adminNetworkManualPayoutRefresh()}
}
function adminNetworkManualPayoutPanel(){
  if(!adminNetworkPayoutActor())return '';
  const d=adminManualPayoutState.queue,pending=adminManualPayoutState.pending;
  const act=(label,call,variant='secondary')=>
    '<button type="button" class="'+variant+' small" '+
    (pending?'disabled ':'')+'onclick="'+call+'">'+esc(label)+'</button>';
  const item=(r)=>{
    const id=String(r.requestId||'');
    if(!/^[0-9a-f-]{36}$/i.test(id))return '';
    const c=Number(r.amountCents);
    if(!Number.isSafeInteger(c)||c<100)return '';
    const due=r.dueAt?new Date(r.dueAt):null;
    const overdue=r.state==='approved'&&due&&due.getTime()<Date.now();
    return '<article class="card flat"><div class="section-head"><div><strong>'+
      BRL.format(c/100)+'</strong> • '+esc(r.state)+
      (overdue?' • PRAZO VENCIDO':'')+
      '<p class="tiny muted">Conta: '+esc(String(r.userId||''))+
      (due?' • pagar até '+esc(due.toLocaleString('pt-BR')):' • aguardando conferência')+
      '</p></div></div>'+
      (r.state==='requested'?
        '<div class="order-actions">'+act('Aprovar após conferir','adminNetworkManualPayoutApprove(\''+id+'\')','primary')+
        act('Cancelar sem pagar','adminNetworkManualPayoutCancel(\''+id+'\')','ghost')+'</div>':'')+
      (r.state==='approved'?
        '<p class="tiny muted">Efetue o Pix manualmente no seu banco. Confira o CPF com a identidade validada. Registre somente após pagamento efetivo.</p>'+
        '<p class="tiny muted">Hash do CPF verificado: <code>'+esc(String(r.recipientPixHash||'').slice(0,14))+'…</code></p>'+
        '<label>Referência única do Pix bancário'+
        '<input class="input" id="manual-payout-ref-'+id+'" maxlength="200" placeholder="Identificador da transação efetuada no banco"></label>'+
        '<label>Comprovante bancário real (arquivo local; apenas hash SHA-256 no TAMÃO)'+
        '<input class="input" id="manual-payout-file-'+id+'" type="file" accept="application/pdf,image/*"></label>'+
        act('Registrar pagamento já realizado','adminNetworkManualPayoutMarkPaid(\''+id+'\')','primary'):'')+
      (r.state==='review'?'<p class="notice danger">Saldo ou origem sob revisão. Não pague nem libere a reserva sem resolver a divergência.</p>':'')+
      '</article>';
  };
  const min=Number(d?.minimumCents);
  const opts=[1000,2000,3000,5000,10000,20000];
  const selector='<label for="manual-payout-minimum">Limite mínimo para solicitar</label>'+
   '<select class="input" id="manual-payout-minimum">'+
   '<option value="">Suspenso / não definido</option>'+
   opts.map(v=>'<option value="'+v+'" '+(min===v?'selected':'')+'>'+
      BRL.format(v/100)+'</option>').join('')+'</select>';
  return '<section class="section admin-network-payouts"><div class="section-head">'+
    '<div><span class="section-kicker">REDE TAMÃO • FINANCEIRO</span>'+
    '<h3>Saques manuais — até 3 dias corridos</h3>'+
    '<p>Solicitação ao atingir o limite; conferência de saldo e titularidade; Pix feito manualmente por você. Prazo contado da aprovação.</p></div>'+
    act('Atualizar fila','adminNetworkManualPayoutRefresh()')+'</div>'+
    (adminManualPayoutState.error?
      '<p class="notice danger">'+esc(adminManualPayoutState.error)+'</p>':'')+
    (!d?'<p class="muted">Consulte a fila de solicitações para configurar o limite e acompanhar os prazos.</p>':
     '<div class="card flat"><div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Saque mínimo</span><strong>'+
        (d.minimumCents==null?'Não definido':BRL.format(Number(d.minimumCents)/100))+'</strong></div>'+
      '<div class="kpi"><span class="label">Solicitações abertas</span><strong>'+
        d.items.length+'</strong></div>'+
      '<div class="kpi"><span class="label">Prazo vencido</span><strong>'+
        Number(d.overdueCount||0)+'</strong></div></div>'+
      '<div class="form-stack">'+selector+
        act('Salvar limite','adminNetworkManualPayoutMinimum()')+'</div></div>'+
      '<details class="card flat"><summary>Validar identidade e chave Pix de um participante</summary>'+
      '<div class="form-stack">'+
      '<label>ID da conta do participante<input class="input" id="network-payout-user-id" placeholder="UUID do usuário"></label>'+
      '<label>Chave Pix CPF do participante<input class="input" id="network-payout-cpf" placeholder="CPF verificado com documento"></label>'+
      '<label>Referência da conferência<input class="input" id="network-payout-identity-ref" placeholder="Identificação e comprovante da verificação"></label>'+
      '<label>Arquivo local de identificação (somente hash é enviado)'+
      '<input class="input" id="network-payout-identity-file" type="file" accept="application/pdf,image/*"></label>'+
      act('Confirmar beneficiário','adminNetworkPayoutRegister()')+'</div></details>'+
      '<div class="form-stack"><h4>Fila de saques</h4>'+
      (d.items.length?d.items.map(item).join(''):'<p class="tiny muted">Não há saques aguardando.</p>')+'</div>'+
      '<p class="tiny muted">O TAMÃO não realiza Pix nesta modalidade. Após o pagamento externo, guarde o comprovante bancário original; apenas a referência e o hash são registrados aqui. Saques aprovados não liberam saldo ao serem cancelados.</p>')+
    '</section>';
}
globalThis.adminNetworkManualPayoutRefresh=adminNetworkManualPayoutRefresh;
globalThis.adminNetworkManualPayoutMinimum=adminNetworkManualPayoutMinimum;
globalThis.adminNetworkManualPayoutApprove=adminNetworkManualPayoutApprove;
globalThis.adminNetworkManualPayoutMarkPaid=adminNetworkManualPayoutMarkPaid;
globalThis.adminNetworkManualPayoutCancel=adminNetworkManualPayoutCancel;
// Keep the existing lazy boundary; show MANUAL mode first.
globalThis.adminNetworkPayoutPanel=adminNetworkManualPayoutPanel;
globalThis.adminNetworkPayoutRefresh=adminNetworkManualPayoutRefresh;
