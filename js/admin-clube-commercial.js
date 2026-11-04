// Loaded only on demand from Admin > Financeiro > Política comercial.
// The seller enters their OWN legal identity; neither the server nor the
// assistant guesses it, and no payment is initiated by this page.
const clubeLaunchState={
 userId:null,status:'idle',pending:false,data:null,error:null,requestId:null
};
function adminClubeCommercialPanel(){
 if(adminCurrentRole()!=='superadmin')return '';
 const uid=String(adminRuntime.session?.user?.id||'');
 if(!uid)return '';
 if(clubeLaunchState.userId!==uid){
  Object.assign(clubeLaunchState,{userId:uid,status:'idle',pending:false,
    data:null,error:null,requestId:null});
 }
 if(clubeLaunchState.status==='idle'&&!clubeLaunchState.pending){
  clubeLaunchState.status='loading';
  Promise.resolve().then(adminClubeCommercialRefresh);
 }
 const state=clubeLaunchState;
 const info=state.data||{};
 const money=n=>BRL.format((Number(n)||0)/100);
 const enabled=info.commercialEnabled===true;
 const safety=info.privateEmergencyStop===true
  ?'<p class="notice danger">Bloqueio privado de emergência ativo. A loja permanece fechada.</p>':'';
 const inactive=state.status==='ready'&&!enabled;
 const input=(id,title,placeholder,type='text')=>
  '<label>'+title+'<input id="clube-release-'+id+
   '" class="input" type="'+type+'" autocomplete="off" maxlength="260" placeholder="'+placeholder+'"></label>';
 const check=(id,title)=>
  '<label class="check-row"><input id="clube-release-'+id+
  '" type="checkbox"><span>'+title+'</span></label>';
 const form=inactive?'<div class="form-stack">'+
    '<p class="tiny">Para colocar à venda: 3 cupons de R$ 5 por R$ 8,90; pedido mínimo de R$ 50; validade de 180 dias a partir da emissão. Não precisa de revenda cadastrada. A conta que vende precisa ser identificada publicamente.</p>'+
    input('name','Nome civil ou razão social do fornecedor','Nome completo / empresa')+
    input('doc','CPF ou CNPJ do fornecedor','Somente números')+
    input('address','Endereço completo do fornecedor, incluindo CEP','Rua, número, bairro, município, UF e CEP')+
    input('email','E-mail público de suporte e reembolso','contato@exemplo.com','email')+
    check('identity','Autorizo a divulgação do nome, CPF/CNPJ, endereço e contato acima aos compradores, conforme exigências para venda online.')+
    check('terms','Aprovo as condições do pacote publicadas nos Termos do TAMÃO e assumo as obrigações legais do fornecedor.')+
    check('refund','Comprometo-me a atender solicitações de cancelamento e a devolver o Pix quando cabível, inclusive se não houver revenda disponível.')+
    check('merchant','Comprometo-me com a cobertura dos R$ 5 de cada cupom usado e com a compensação futura à revenda; o sistema não declarará repasse liquidado sem comprovante.')+
    check('availability','Sei que não há garantia de revenda ativa na região neste momento e que o prazo de 180 dias começa após a emissão.')+
    '<button type="button" class="primary" onclick="adminClubeCommercialActivate()"'+
      (state.pending?' disabled':'')+'>Ativar comercialmente os cupons de R$ 8,90</button>'+
    '<p class="tiny muted">O sistema confirma a conta de produção do Mercado Pago antes da ativação. Nenhum Pix é criado por este botão.</p>'+
  '</div>':'';
 return '<section class="section" aria-label="Ativação comercial de cupons">'+
   '<div class="section-head"><div><span class="section-kicker">CLUBE TAMÃO • LANÇAMENTO</span>'+
    '<h3>Ativar venda de cupons aos clientes</h3>'+
    '<p>Libere ou suspenda os pacotes sem exigir revendas cadastradas.</p></div>'+
    '<button class="secondary small" onclick="adminClubeCommercialRefresh()">Atualizar situação</button></div>'+
   '<div class="card flat form-stack">'+
   '<p>Garantia pessoal disponível: <strong>'+esc(money(info.guaranteeCents))+'</strong> · Comprometido: '+
     esc(money(info.reservedCents))+'</p>'+
   (state.error?'<p class="notice danger" role="alert">'+esc(state.error)+'</p>':'')+
   safety+
   (enabled?'<p class="notice" role="status"><strong>Oferta comercial autorizada.</strong> O catálogo do cliente poderá oferecer o pacote, respeitando bloqueios do Mercado Pago e orçamento disponível.</p>'+
    '<p class="tiny">Fornecedor: '+esc(String(info.seller?.name||''))+'</p>'+
    '<button class="danger-btn" type="button" onclick="adminClubeCommercialSuspend()">Suspender novas vendas imediatamente</button>':'')+
   (state.status==='loading'?'<p role="status">Conferindo condições de liberação…</p>':'')+
   form+'</div></section>';
}
async function adminClubeCommercialRefresh(){
 const uid=String(adminRuntime.session?.user?.id||'');
 if(!uid||adminCurrentRole()!=='superadmin')return;
 clubeLaunchState.pending=true;
 try{
  const x=await adminInvoke({action:'clube-coupon-commercial-status'});
  if(String(adminRuntime.session?.user?.id||'')!==uid)return;
  if(x?.ok!==true||x?.source!=='clube_commercial_release_status_v1_819')
    throw Error('COMMERCE_STATUS_UNVERIFIED');
  clubeLaunchState.data=x;clubeLaunchState.status='ready';
  clubeLaunchState.error=null;
 }catch(err){
  if(String(adminRuntime.session?.user?.id||'')===uid){
   clubeLaunchState.status='failed';
   clubeLaunchState.error=String(err?.message||err);
  }
 }finally{
  clubeLaunchState.pending=false;
  if(String(adminRuntime.session?.user?.id||'')===uid)render();
 }
}
async function adminClubeCommercialActivate(){
 const uid=String(adminRuntime.session?.user?.id||'');
 if(!uid||adminCurrentRole()!=='superadmin'||clubeLaunchState.pending)return;
 const value=id=>String(document.getElementById('clube-release-'+id)?.value||'').trim();
 const checked=id=>document.getElementById('clube-release-'+id)?.checked===true;
 const sellerName=value('name'),sellerTaxDocument=value('doc'),
       sellerAddress=value('address'),sellerSupportEmail=value('email');
 if(!sellerName||!sellerTaxDocument||!sellerAddress||!sellerSupportEmail||
  !['identity','terms','refund','merchant','availability'].every(checked)){
   clubeLaunchState.error='Preencha a identidade do fornecedor e confirme todas as condições.';
   render();return;
 }
 if(!window.confirm('Autorizar agora cobranças reais de R$ 8,90 aos clientes? Você se responsabiliza pelas devoluções e pelo desconto custeado.'))return;
 clubeLaunchState.pending=true;
 const requestId=clubeLaunchState.requestId||crypto.randomUUID();
 clubeLaunchState.requestId=requestId;
 try{
  const result=await adminInvoke({action:'clube-coupon-commercial-release',
   requestId,sellerName,sellerTaxDocument,sellerAddress,sellerSupportEmail,
   acceptPublicSellerDisclosure:true,acceptRefund:true,
   acceptMerchantReimbursement:true,acceptNoMerchantYet:true,
   termsVersion:'clube_coupon_terms_v1_813'
  });
  if(String(adminRuntime.session?.user?.id||'')!==uid)return;
  if(result?.source!=='clube_commercial_release_v1_819'||
     result?.ok!==true||result.commercialEnabled!==true)
    throw Error('COUPON_RELEASE_NOT_CONFIRMED');
  clubeLaunchState.requestId=null;
  await adminClubeCommercialRefresh();
 }catch(error){
  if(String(adminRuntime.session?.user?.id||'')===uid){
   clubeLaunchState.error=String(error?.message||error);
   try{await adminClubeCommercialRefresh()}catch{}
  }
 }finally{
  clubeLaunchState.pending=false;
  if(String(adminRuntime.session?.user?.id||'')===uid)render();
 }
}
async function adminClubeCommercialSuspend(){
 const uid=String(adminRuntime.session?.user?.id||'');
 if(!uid||adminCurrentRole()!=='superadmin'||clubeLaunchState.pending||
    !window.confirm('Suspender agora novas compras de cupons? Os cupons já vendidos permanecem no histórico.'))return;
 clubeLaunchState.pending=true;
 try{
  const result=await adminInvoke({action:'clube-coupon-commercial-suspend',
   requestId:crypto.randomUUID()});
  if(result?.ok!==true||result.commercialEnabled!==false)
   throw Error('COUPON_SUSPEND_NOT_CONFIRMED');
  await adminClubeCommercialRefresh();
 }catch(error){clubeLaunchState.error=String(error?.message||error)}
 finally{
  clubeLaunchState.pending=false;
  if(String(adminRuntime.session?.user?.id||'')===uid)render();
 }
}
Object.assign(globalThis,{adminClubeCommercialPanel,adminClubeCommercialRefresh,
 adminClubeCommercialActivate,adminClubeCommercialSuspend});
