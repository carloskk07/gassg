// TAMÃO Celebra V1.1046 — lightweight deferred Admin cards.
function adminCelebraPanel(){
 const root=adminNetworkFeePackageState?.celebra;
 if(root?.source!=='network_celebra_admin_v1_1046'||
     root.readOnly!==true||root.moneyMoved!==false||
     root.cashPayoutsEnabled!==false||!Array.isArray(root.items))return '';
 const cards=root.items.map(c=>{
   if(!['natal_2026','ano_novo_2027'].includes(c?.key)||
      typeof c.enabled!=='boolean')return '';
   const proposed=BRL.format((Number(c.budgetLimitCents)||0)/100);
   const spent=BRL.format((Number(c.spentCents)||0)/100);
   const start=new Date(c.startsAt),end=new Date(c.endsAt);
   const canStart=!c.enabled&&!c.termsApproved&&start.getTime()>Date.now();
   const fmt=d=>Number.isFinite(d.getTime())?
     new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',
       day:'2-digit',month:'short',year:'numeric'}).format(d):'';
   const when=fmt(start)+' — '+fmt(new Date(end.getTime()-1000));
   return '<article class="card flat">'+
     '<span class="section-kicker">'+(c.enabled?'HABILITADA':'DESATIVADA')+'</span>'+
     '<h4>'+esc(c.title)+'</h4>'+
     '<p class="muted tiny">'+esc(when)+'</p>'+
     '<p class="tiny">Bônus extra máximo: '+Number(c.extraBps)/100+
       ' ponto percentual do líquido da primeira indicação confirmada, '+
       'até '+BRL.format(Number(c.memberLimitCents)/100)+' por participante.</p>'+
     '<div class="merchant-kpis"><div class="kpi"><span class="label">Teto autorizado</span>'+
       '<strong>'+proposed+'</strong></div>'+
       '<div class="kpi"><span class="label">Contabilizado</span>'+
       '<strong>'+spent+'</strong></div>'+
       '<div class="kpi"><span class="label">Bônus verificados</span>'+
       '<strong>'+Number(c.validatedAwards)+'</strong></div></div>'+
     (adminCurrentRole()!=='superadmin'?'':
       c.enabled?
         '<button type="button" class="secondary small" '+
         'onclick="adminNetworkCelebraToggle(\''+c.key+'\',false)">Suspender novos bônus</button>':
       canStart?
         '<div class="form-stack">'+
         '<label>Teto desta campanha<select class="input" id="celebra-budget-'+c.key+'">'+
         '<option value="2000">R$ 20</option><option value="5000" selected>R$ 50</option>'+
         '<option value="10000">R$ 100</option></select></label>'+
         '<label>Versão dos termos já publicados<input class="input" maxlength="160" '+
         'id="celebra-terms-'+c.key+'" placeholder="Documento e versão aprovados"></label>'+
         '<button type="button" class="primary small" onclick="adminNetworkCelebraToggle(\''+
           c.key+'\',true)">Autorizar para o período</button></div>':
         '<p class="muted tiny">Campanha indisponível para nova ativação ou janela já iniciada.</p>')+
     '</article>';
 }).filter(Boolean).join('');
 return '<section class="section admin-network-celebra" aria-label="Campanhas TAMÃO Celebra">'+
  '<div class="section-head"><div><span class="section-kicker">REDE • RECONHECIMENTO</span>'+
  '<h3>TAMÃO Celebra</h3>'+
  '<p>Você decide o teto e a versão dos termos uma vez. O sistema respeita datas, '+ 
  'comissões comprovadas e limitações de orçamento automaticamente.</p></div></div>'+
  '<div class="grid cards-2">'+cards+'</div>'+
  '<p class="tiny muted">Orçamento máximo não significa dinheiro depositado. '+
  'Os bônus só existem após receita líquida validada, não podem ser sacados nesta versão, '+
  'e não alteram o fundo coletivo de 10%. Uma campanha pode terminar sem pagamentos.</p></section>';
}
globalThis.adminCelebraPanel=adminCelebraPanel;
