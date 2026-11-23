// TAMÃO V1.1159 — assistente de transição para CNPJ. Superadmin, sob demanda.
// Nunca faz transferências, troca credenciais financeiras ou inventa comprovantes.
const adminOperatorState={actor:null,data:null,pending:false,error:null,draft:null};
function adminOperatorSession(){
  const actor=typeof adminReady==='function'&&adminReady()&&
    typeof adminCurrentRole==='function'&&adminCurrentRole()==='superadmin'
      ?String(adminRuntime.session?.user?.id||'')||null:null;
  if(adminOperatorState.actor!==actor){
    adminOperatorState.actor=actor;adminOperatorState.data=null;
    adminOperatorState.error=null;adminOperatorState.pending=false;
    adminOperatorState.draft=null;
  }
  return actor;
}
// Avoid discarding typed legal information when the dashboard refreshes.
// This draft lives in memory only, scoped to the authenticated superadmin and
// the exact server-side revision. It is never treated as a verified document.
function adminOperatorDraftCapture(){
  const actor=adminOperatorSession();
  const d=adminOperatorState.data;
  if(!actor||!d||d.stage==='active')return;
  const entries=[
    ['operator-pj-cnpj','cnpj'],['operator-pj-legal-name','legalName'],
    ['operator-pj-trade-name','tradeName'],
    ['operator-pj-public-address','publicAddress'],
    ['operator-pj-email','contactEmail']
  ];
  const values={};
  for(const [id,key] of entries){
    const control=document.getElementById(id);
    values[key]=control?String(control.value):
      String(adminOperatorState.draft?.values?.[key]||'');
  }
  adminOperatorState.draft={actor,revision:d.revision,values};
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
      !Number.isSafeInteger(data.revision)||data.currentEntityKind==null||
      data.financialPreflight?.source!=='platform_operator_financial_preflight_v1_1161'||
      data.financialPreflight?.readOnly!==true||
      data.financialPreflight?.moneyMoved!==false||
      data.financialPreflight?.pspChanged!==false||
      !Number.isSafeInteger(data.financialPreflight?.blockerCount)||
      !Array.isArray(data.financialPreflight?.checks)||
      data.financialPreflight.checks.length!==7||
      (data.readyToActivate===true&&data.financialPreflight.blockerCount!==0))
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
    adminOperatorState.draft=null;
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
  const draft=adminOperatorState.draft?.actor===adminOperatorState.actor&&
    adminOperatorState.draft?.revision===d?.revision
      ?adminOperatorState.draft.values:null;
  const candidate=key=>draft&&Object.hasOwn(draft,key)?draft[key]:d?.candidate?.[key];
  const field=(id,title,value,placeholder='')=>'<label>'+safe(title)+
    '<input class="input" id="'+id+'" maxlength="240" autocomplete="off"'+
    ' value="'+safe(value)+'" placeholder="'+safe(placeholder)+'"'+
    (['operator-pj-cnpj','operator-pj-legal-name','operator-pj-trade-name',
      'operator-pj-public-address','operator-pj-email'].includes(id)
      ?' oninput="adminOperatorDraftCapture()"':'')+'></label>';
  const busy=adminOperatorState.pending?'disabled':'';
  const verified=d?Number(d.verifiedGates||0):0,total=d?Number(d.totalGates||0):12;
  const preflight=d?.financialPreflight;
  const blockers=preflight?.blockerCount??null;
  const mode=d?.stage==='active'?'Pessoa jurídica ativa':
    d?.stage==='draft'?'Cadastro PJ em preparação':'Operação atual preservada';
  return '<section class="section admin-operator-pj" aria-label="Transição TAMÃO para CNPJ">'+
    '<div class="section-head"><div><span class="section-kicker">ADMIN • IDENTIDADE JURÍDICA</span>'+
    '<h3>Preparar migração para CNPJ</h3>'+
    '<p>Dados de empresa e 12 verificações documentais. Nada muda para os clientes até a virada comprovada.</p>'+
    '</div><button type="button" class="secondary small" onclick="adminOperatorRefresh()" '+busy+'>Atualizar</button></div>'+
    (adminOperatorState.error?'<p class="notice danger">'+safe(adminOperatorState.error)+'</p>':'')+
    '<div class="card flat"><div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Identidade vigente</span><strong>'+
       safe(d?.currentEntityKind==='company'?'Pessoa jurídica':'Pessoa física')+'</strong></div>'+
    '<div class="kpi"><span class="label">Etapa</span><strong>'+safe(mode)+'</strong></div>'+
    '<div class="kpi"><span class="label">Conferências externas</span><strong>'+verified+'/'+total+'</strong></div>'+
    '<div class="kpi"><span class="label">Pendências financeiras internas</span><strong>'+
      (blockers===null?'Não conferido':blockers)+'</strong></div>'+
    '</div><p class="tiny muted">Credenciais do Mercado Pago, extratos, saques, recebíveis, contas e histórico permanecem inalterados durante o preparo.</p></div>'+
    (!d?'<p class="muted">Clique em Atualizar para consultar as condições atuais de migração.</p>':
      '<details class="card flat" open><summary>1. Cadastro da futura empresa</summary>'+
      '<div class="form-stack">'+
      field('operator-pj-cnpj','CNPJ numérico ou alfanumérico',candidate('cnpj'),'Somente após emissão oficial')+
      field('operator-pj-legal-name','Razão social oficial',candidate('legalName'))+
      field('operator-pj-trade-name','Nome fantasia',candidate('tradeName'),'TAMÃO, se registrado')+
      field('operator-pj-public-address','Endereço comercial para divulgação',candidate('publicAddress'),'Endereço conforme registro')+
      field('operator-pj-email','E-mail comercial de suporte',candidate('contactEmail'))+
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
      '<details class="card flat" open><summary>3. Conferência financeira automática</summary>'+
      (preflight?'<p class="tiny muted">Leitura do banco, sem emitir Pix, transferir valores ou alterar pagamentos. Verificado em '+
        safe(new Date(preflight.checkedAt).toLocaleString('pt-BR'))+'.</p>'+
        '<div class="form-stack">'+preflight.checks.map(row=>
          '<div class="list-row"><strong>'+safe(row.title)+'</strong>'+
          '<span class="status-pill '+(Number(row.count)>0?'risk':'online')+'">'+
          (Number(row.count)>0?Number(row.count)+' pendente(s)':'Sem pendências')+
          '</span></div>').join('')+'</div>'+
        (blockers>0?'<p class="notice danger">Existem '+blockers+
          ' pendência(s) interna(s). A ativação PJ permanece bloqueada até regularização real.</p>':
          '<p class="tiny muted">Nenhuma pendência identificada nessas sete filas internas. Isso não comprova quitação bancária nem valida a nova conta PJ.</p>'):
        '<p class="notice danger">Não foi possível conferir as filas financeiras. Nenhuma ativação autorizada.</p>')+
      '</details>'+
      '<details class="card flat"><summary>4. Virada definitiva (somente quando tudo estiver comprovado)</summary>'+
      '<p>Esta etapa muda somente a identidade jurídica pública registrada no TAMÃO. Nunca migra sozinha credenciais Pix, contas bancárias, contratos ou operações antigas.</p>'+
      (d.readyToActivate===true&&blockers===0?
        '<button class="primary" onclick="adminOperatorActivate()" '+busy+'>Confirmar virada para PJ</button>':
        '<p class="notice">Indisponível até cadastro real, 12 comprovações externas e ausência de pendências financeiras internas. Nenhuma ativação antecipada.</p>')+
      '</details>')+
    '<p class="tiny muted">Documentos fiscais e financeiros devem ser guardados fora deste formulário. Registre apenas referências verificáveis, nunca senha, token, chave privada ou CPF.</p></section>';
}
globalThis.adminOperatorDraftCapture=adminOperatorDraftCapture;
globalThis.adminOperatorRefresh=adminOperatorRefresh;
globalThis.adminOperatorSave=adminOperatorSave;
globalThis.adminOperatorGate=adminOperatorGate;
globalThis.adminOperatorActivate=adminOperatorActivate;
globalThis.adminOperatorPanel=adminOperatorPanel;
