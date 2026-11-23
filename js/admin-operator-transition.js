// TAMÃO V1.1159 — assistente de transição para CNPJ. Superadmin, sob demanda.
// Nunca faz transferências, troca credenciais financeiras ou inventa comprovantes.
const adminOperatorState={actor:null,data:null,pending:false,error:null};
function adminOperatorSession(){
  const actor=typeof adminNetworkPayoutActor==='function'?adminNetworkPayoutActor():null;
  if(adminOperatorState.actor!==actor){
    adminOperatorState.actor=actor;adminOperatorState.data=null;
    adminOperatorState.error=null;adminOperatorState.pending=false;
  }
  return actor;
}
async function adminOperatorInvoke(payload){
  const actor=adminOperatorSession();
  if(!actor)throw Error('Somente o superadmin pode preparar a identidade da plataforma.');
  const token=await adminAccessToken();
  if(actor!==adminOperatorSession())throw Error('A sessão administrativa mudou.');
  const res=await globalThis.chamaFetch(CHAMA_BACKEND.url+'/functions/v1/operator-transition-ops',{
    method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/json',apikey:CHAMA_BACKEND.publishableKey,
      Authorization:'Bearer '+token},
    body:JSON.stringify(payload)
  });
  let data=null;try{data=await res.json()}catch{}
  if(actor!==adminOperatorSession())throw Error('A sessão mudou. Atualize o painel.');
  if(!res.ok)throw Error(data?.message||'Operação de cadastro PJ não validada.');
  if(data?.source!=='platform_operator_transition_v1_1159'||
     data?.moneyMoved!==false||data?.pspChanged!==false)
    throw Error('Resposta de migração não confirmada.');
  return data;
}
async function adminOperatorRefresh(){
  const actor=adminOperatorSession();
  if(!actor||adminOperatorState.pending)return;
  adminOperatorState.pending=true;
  try{
    const data=await adminOperatorInvoke({action:'read'});
    if(data.readOnly!==true||!Array.isArray(data.gates)||
      !Number.isSafeInteger(data.revision)||data.currentEntityKind==null)
      throw Error('Conferência do cadastro PJ indisponível.');
    if(actor!==adminOperatorSession())return;
    adminOperatorState.data=data;adminOperatorState.error=null;
  }catch(e){if(actor===adminOperatorSession())
    adminOperatorState.error=String(e?.message||e);}
  finally{if(actor===adminOperatorSession()){
    adminOperatorState.pending=false;render();
  }}
}
async function adminOperatorSave(){
  const actor=adminOperatorSession(),d=adminOperatorState.data;
  if(!actor||!d||adminOperatorState.pending||d.stage==='active')return;
  const get=id=>String(document.getElementById(id)?.value||'').trim();
  const fields={
    cnpj:get('operator-pj-cnpj'),legalName:get('operator-pj-legal-name'),
    tradeName:get('operator-pj-trade-name'),
    publicAddress:get('operator-pj-public-address'),
    contactEmail:get('operator-pj-email')
  };
  if(!fields.cnpj||!fields.legalName||!fields.tradeName||
    !fields.publicAddress||!fields.contactEmail)
    return toast('Informe o CNPJ, a razão social, o nome fantasia, o endereço e o e-mail reais.');
  if(!confirm('Preparar estes dados reais de pessoa jurídica? Isso zera TODAS as verificações anteriores e NÃO troca a titularidade financeira.'))return;
  adminOperatorState.pending=true;
  try{
    const r=await adminOperatorInvoke({action:'stage',revision:d.revision,...fields,
      confirmation:'PREPARAR DADOS PJ'});
    if(r.stage!=='draft')throw Error('Rascunho não confirmado.');
    toast('Dados da futura PJ preparados. Conta PF e pagamentos atuais preservados.');
  }catch(e){toast(String(e?.message||e))}
  finally{adminOperatorState.pending=false;await adminOperatorRefresh()}
}
async function adminOperatorGate(verified){
  const actor=adminOperatorSession(),d=adminOperatorState.data;
  if(!actor||!d||d.stage!=='draft'||adminOperatorState.pending)return;
  const key=String(document.getElementById('operator-pj-gate')?.value||'');
  const gate=d.gates.find(g=>g.key===key);
  if(!gate)return toast('Escolha a verificação.');
  const evidence=String(document.getElementById('operator-pj-proof')?.value||'').trim();
  if(verified&&evidence.length<16)
    return toast('Informe a referência da comprovação REAL (ao menos 16 caracteres).');
  if(!confirm(verified?
      'Você já CONFERIU o documento/serviço externo original? Nenhuma informação será presumida.':
      'Reabrir esta verificação? A migração não poderá ocorrer até nova conferência.'))
    return;
  adminOperatorState.pending=true;
  try{
    const r=await adminOperatorInvoke({action:'gate',revision:d.revision,gateKey:key,
      verified,evidenceReference:verified?evidence:null,
      confirmation:verified?'EVIDENCIA EXTERNA CONFERIDA':null});
    if(r.gateKey!==key||r.verified!==verified)throw Error('Verificação não registrada.');
    toast(verified?'Comprovação registrada na preparação PJ.':'Verificação reaberta.');
  }catch(e){toast(String(e?.message||e))}
  finally{adminOperatorState.pending=false;await adminOperatorRefresh()}
}
async function adminOperatorActivate(){
  const actor=adminOperatorSession(),d=adminOperatorState.data;
  if(!actor||!d||d.stage!=='draft'||d.readyToActivate!==true||
     adminOperatorState.pending)return;
  if(!confirm('ATENÇÃO: declarar a pessoa jurídica como operadora PUBLICARÁ o CNPJ e a razão social. Só prossiga se a conta PJ, Pix, webhooks, notas fiscais e pendências PF estiverem realmente conferidos.'))return;
  const phrase='CONFIRMO ATIVACAO PJ';
  const typed=prompt('Para registrar a virada de titularidade pública, digite exatamente: '+phrase);
  if(typed!==phrase)return toast('Autorização de virada não confirmada.');
  adminOperatorState.pending=true;
  try{
    const r=await adminOperatorInvoke({action:'activate',revision:d.revision,confirmation:phrase});
    if(r.stage!=='active'||r.historicalLedgerRewritten!==false)
      throw Error('Ativação ainda não foi confirmada.');
    toast('Identidade PJ ativada. Confira a página de Termos e toda a conciliação.');
  }catch(e){toast(String(e?.message||e))}
  finally{adminOperatorState.pending=false;await adminOperatorRefresh()}
}
function adminOperatorPanel(){
  if(!adminOperatorSession())return '';
  const d=adminOperatorState.data;
  const safe=v=>esc(String(v??''));
  const field=(id,title,value,placeholder='')=>'<label>'+safe(title)+
    '<input class="input" id="'+id+'" maxlength="240" autocomplete="off"'+
    ' value="'+safe(value)+'" placeholder="'+safe(placeholder)+'"></label>';
  const busy=adminOperatorState.pending?'disabled':'';
  const verified=d?Number(d.verifiedGates||0):0,total=d?Number(d.totalGates||0):12;
  const mode=d?.stage==='active'?'Pessoa jurídica ativa':
    d?.stage==='draft'?'Cadastro PJ em preparação':'Operação atual preservada';
  return '<section class="section admin-operator-pj" aria-label="Transição TAMÃO para CNPJ">'+
    '<div class="section-head"><div><span class="section-kicker">ADMIN • IDENTIDADE JURÍDICA</span>'+
    '<h3>Preparar migração para CNPJ</h3>'+
    '<p>Dados de empresa, conciliação e operação em uma jornada. Nada muda para os clientes até a virada comprovada.</p>'+
    '</div><button type="button" class="secondary small" onclick="adminOperatorRefresh()" '+busy+'>Atualizar</button></div>'+
    (adminOperatorState.error?'<p class="notice danger">'+safe(adminOperatorState.error)+'</p>':'')+
    '<div class="card flat"><div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Identidade vigente</span><strong>'+
       safe(d?.currentEntityKind==='company'?'Pessoa jurídica':'Pessoa física')+'</strong></div>'+
    '<div class="kpi"><span class="label">Etapa</span><strong>'+safe(mode)+'</strong></div>'+
    '<div class="kpi"><span class="label">Conferências externas</span><strong>'+verified+'/'+total+'</strong></div>'+
    '</div><p class="tiny muted">Credenciais do Mercado Pago, extratos, saques, recebíveis, contas e histórico permanecem inalterados durante o preparo.</p></div>'+
    (!d?'<p class="muted">Clique em Atualizar para consultar as condições atuais de migração.</p>':
      '<details class="card flat" open><summary>1. Cadastro da futura empresa</summary>'+
      '<div class="form-stack">'+
      field('operator-pj-cnpj','CNPJ numérico ou alfanumérico',d.candidate?.cnpj,'Somente após emissão oficial')+
      field('operator-pj-legal-name','Razão social oficial',d.candidate?.legalName)+
      field('operator-pj-trade-name','Nome fantasia',d.candidate?.tradeName,'TAMÃO, se registrado')+
      field('operator-pj-public-address','Endereço comercial para divulgação',d.candidate?.publicAddress,'Endereço conforme registro')+
      field('operator-pj-email','E-mail comercial de suporte',d.candidate?.contactEmail)+
      (d.stage!=='active'?'<button class="secondary" onclick="adminOperatorSave()" '+busy+'>Salvar dados da PJ (não ativar)</button>':
        '<p class="notice">Identidade PJ já ativada e preservada em histórico.</p>')+
      '</div></details>'+
      '<details class="card flat" open><summary>2. Conferências antes da virada</summary>'+
      '<p class="tiny muted">São verificações de documentos e sistemas reais. Não marque itens sem conferir externamente.</p>'+
      '<div class="form-stack">'+d.gates.map(g=>
        '<p class="tiny"><strong>'+(g.verified?'✓ ':'○ ')+safe(g.title)+'</strong>'+
        (g.verified?'<small class="muted"> — '+safe(g.evidenceReference||'Conferido')+'</small>':'')+
        '</p>').join('')+
      (d.stage==='draft'?'<label>Verificação a atualizar<select id="operator-pj-gate" class="input">'+
        d.gates.map(g=>'<option value="'+safe(g.key)+'">'+(g.verified?'✓ ':'○ ')+safe(g.title)+'</option>').join('')+
        '</select></label>'+
        field('operator-pj-proof','Referência do documento/consulta REAL','','Protocolo, documento, referência e data')+
        '<div class="row gap">'+
        '<button class="secondary small" onclick="adminOperatorGate(true)" '+busy+'>Marcar conferido</button>'+
        '<button class="secondary small" onclick="adminOperatorGate(false)" '+busy+'>Reabrir</button>'+
        '</div>':'<p class="tiny muted">As verificações poderão ser iniciadas após salvar os dados oficiais da empresa.</p>')+
      '</div></details>'+
      '<details class="card flat"><summary>3. Virada definitiva (somente quando tudo estiver comprovado)</summary>'+
      '<p>Esta etapa muda somente a identidade jurídica pública registrada no TAMÃO. Nunca migra sozinha credenciais Pix, contas bancárias, contratos ou operações antigas.</p>'+
      (d.readyToActivate===true?
        '<button class="primary" onclick="adminOperatorActivate()" '+busy+'>Confirmar virada para PJ</button>':
        '<p class="notice">Indisponível até cadastro real e 12 comprovações externas. Nenhuma ativação antecipada.</p>')+
      '</details>')+
    '<p class="tiny muted">Documentos fiscais e financeiros devem ser guardados fora deste formulário. Registre apenas referências verificáveis, nunca senha, token, chave privada ou CPF.</p></section>';
}
globalThis.adminOperatorRefresh=adminOperatorRefresh;
globalThis.adminOperatorSave=adminOperatorSave;
globalThis.adminOperatorGate=adminOperatorGate;
globalThis.adminOperatorActivate=adminOperatorActivate;
globalThis.adminOperatorPanel=adminOperatorPanel;
