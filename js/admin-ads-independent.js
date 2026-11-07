// TAMÃO V1.884 — self-service independent advertisers, private admin moderation.
// This module is only loaded in the protected Admin acquisition workspace.
let adminIndependentAdsState={loadedFor:null,rows:[],deliveryEnabled:false};
let adminIndependentAdsBusy=false;
async function adminIndependentAdsRefresh(){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||adminIndependentAdsBusy)return;
 adminIndependentAdsBusy=true;
 try{
  const r=await adminInvoke({action:'ads-independent-read'});
  if(r?.source!=='admin_ads_independent_read_v1_884'||r?.billingEnabled!==false||
    r?.revenueCents!==0||r?.independentlyAuditedImpressions!==0||
    !Array.isArray(r.rows)||r.rows.length>50)
   throw Error('Estado do Ads independente não confirmado.');
  if(actor!==String(adminRuntime?.session?.user?.id||''))return;
  adminIndependentAdsState={loadedFor:actor,rows:r.rows,deliveryEnabled:r.deliveryEnabled===true};
  render();
 }catch(e){toast(String(e?.message||'Erro ao consultar Ads independente.'))}
 finally{adminIndependentAdsBusy=false}
}
async function adminIndependentAdsAction(decision,campaignId='',version=0){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||adminCurrentRole()!=='superadmin'||adminIndependentAdsBusy)return;
 const control=decision==='enable_delivery'||decision==='disable_delivery';
 const field=document.getElementById(control?'independent-ads-control-reason':'independent-ads-reason-'+campaignId);
 const reason=String(field?.value||'').trim();
 if(reason.length<12||reason.length>500)return toast('Informe um motivo de 12 a 500 caracteres.');
 const current=adminIndependentAdsState;
 if(current.loadedFor!==actor)return toast('Atualize a lista antes de decidir.');
 const row=current.rows.find(x=>x.id===campaignId);
 if(!control&&(!row||Number(row.version)!==version))return toast('A campanha mudou. Atualize antes de decidir.');
 adminIndependentAdsBusy=true;
 try{
  const r=await adminPerform('ads-independent-action',{
   decision,campaignId:control?'':campaignId,expectedVersion:control?null:version,reason
  });
  if(r?.source!=='admin_ads_independent_action_v1_884'||
     r?.billingEnabled!==false||r?.paymentCreated!==false)
    throw Error('A decisão não foi confirmada pelo servidor.');
  toast(control?'Estado de entrega atualizado sem habilitar cobrança.':'Análise da campanha registrada.');
 }catch(e){toast(String(e?.message||'Falha ao decidir.'))}
 finally{adminIndependentAdsBusy=false}
 await adminIndependentAdsRefresh();
}
function adminAdsIndependentSection(){
 const role=String(adminCurrentRole());
 if(!['superadmin','operations','compliance','finance'].includes(role))return '';
 const actor=String(adminRuntime?.session?.user?.id||'');
 const v=adminIndependentAdsState.loadedFor===actor?adminIndependentAdsState:null;
 const canAct=role==='superadmin';
 const delivery=v?.deliveryEnabled===true;
 const actions=c=>{
  if(!canAct)return '';
  const status=String(c.status||'');
  const version=Number(c.version)||0;
  const endsAt=Date.parse(String(c.runEndsAt||''));
  const expired=Number.isFinite(endsAt)&&endsAt<=Date.now();
  const id=String(c.id||'');
  const b=(action,label)=>'<button type="button" class="secondary small" '+
    'onclick="adminIndependentAdsAction(\''+action+'\',\''+id+'\','+version+')" '+
    (adminIndependentAdsBusy?'disabled':'')+'>'+label+'</button>';
  const buttons=status==='submitted'?b('approve','Aprovar criativo')+b('reject','Rejeitar'):
    status==='approved'&&delivery?b('publish','Iniciar publicação'):
    status==='active'?(expired?b('end','Encerrar campanha expirada'):
      b('pause','Pausar campanha')+b('end','Encerrar definitivamente')):
    status==='paused'?((delivery&&!expired?b('resume','Retomar campanha'):'')+
      b('end','Encerrar definitivamente')):'';
  if(!buttons&&status!=='approved')return '';
  return '<label for="independent-ads-reason-'+id+'">Justificativa</label>'+
   '<textarea id="independent-ads-reason-'+id+'" rows="2" class="input" maxlength="500" '+
   'placeholder="Explique o motivo da decisão"></textarea>'+
   '<div class="row flex-wrap">'+buttons+'</div>';
 };
 const rows=v?.rows?.map(c=>
  '<article class="card flat"><strong>'+esc(String(c.advertiser||''))+' · '+esc(String(c.title||''))+'</strong>'+
  '<p>'+esc(String(c.city||''))+'/'+esc(String(c.state||''))+
  ' · '+esc(String(c.effectiveStatus||c.status||''))+' · Versão '+Number(c.version||0)+'</p>'+
  '<p>'+esc(String(c.description||''))+'</p>'+
  '<small>Destino: '+esc(String(c.destination||''))+'</small>'+
  '<p>Prazo original: '+(c.runEndsAt?esc(String(c.runEndsAt).slice(0,10)):'aguardando início')+
  ' · Retomar nunca prorroga o prazo.</p>'+
  '<p>Orçamento máximo: '+adminMoney(Number(c.budgetCents||0))+
  ' · Sinais de visibilidade: '+Number(c.reportedViewSignals||0)+
  ' · Exibições faturáveis: 0</p>'+actions(c)+'</article>'
 ).join('')||'';
 return '<section class="section" aria-label="Publicação independente do TAMÃO Ads">'+
  '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • ANUNCIANTES INDEPENDENTES</span>'+
  '<h3>Campanhas sem cadastro de revenda</h3>'+
  '<p>Análise e entrega não faturável. Sinais do navegador não constituem prova de cobrança.</p></div>'+
  '<button type="button" class="secondary small" onclick="adminIndependentAdsRefresh()" '+
  (adminIndependentAdsBusy?'disabled':'')+'>Atualizar campanhas</button></div>'+
  '<div class="merchant-kpis"><div class="kpi"><span class="label">Entrega pública independente</span>'+
   '<strong>'+(delivery?'Habilitada':'Desligada')+'</strong></div>'+
   '<div class="kpi"><span class="label">Cobrança Ads</span><strong>Bloqueada</strong></div>'+
   '<div class="kpi"><span class="label">Campanhas</span><strong>'+Number(v?.rows?.length||0)+'</strong></div></div>'+
  (canAct?'<div class="card flat"><label for="independent-ads-control-reason">Motivo para autorizar ou interromper</label>'+
    '<textarea id="independent-ads-control-reason" class="input" maxlength="500" rows="2" '+
    'placeholder="Revisão de segurança e inventário verificado"></textarea>'+
    '<button class="secondary small" type="button" onclick="adminIndependentAdsAction(\''+
    (delivery?'disable_delivery':'enable_delivery')+'\')" '+
    (adminIndependentAdsBusy?'disabled':'')+'>'+
    (delivery?'Interromper entrega imediatamente':'Autorizar entrega não faturável')+'</button>'+
    '<p class="tiny muted">A autorização exige campanha revisada e não libera faturamento, Pix nem repasses.</p></div>':'')+
  (v?'<div class="grid cards-2">'+(rows||'<p>Sem campanhas enviadas até agora.</p>')+'</div>':
   '<p class="muted">Atualize para conferir propostas reais e os controles de publicação.</p>')+
  '</section>';
}
