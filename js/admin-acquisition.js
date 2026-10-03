function adminLeadWhatsApp(raw){
  const digits=String(raw||'').replace(/\D/g,'');
  return digits.length===10||digits.length===11?'55'+digits:digits;
}
function adminLeadInterestLabel(value){
  return ({gas:'Gás',water:'Água',charcoal:'Carvão',firewood:'Lenha',ice:'Gelo',other:'Outros'})[value]||String(value||'');
}
function adminPrelaunchLeadCard(x){
  const merchant=x.lead_type==='merchant';
  const type=merchant?'PARCEIRO':'CLIENTE';
  const title=merchant?(x.business_name||x.contact_name||'Empresa'):(x.contact_name||'Novo interessado');
  const interests=(x.interests||[]).map(adminLeadInterestLabel).join(' • ')||'—';
  const source=[x.source,x.medium,x.campaign].filter(Boolean).join(' / ')||'acesso direto';
  const wa=adminLeadWhatsApp(x.phone);
  return [
    '<article class="card flat">',
      '<div class="status-bar"><div><span class="status-pill '+(merchant?'online':'')+'">'+type+'</span>',
      '<h3 style="margin:8px 0 3px">'+esc(title)+'</h3>',
      '<div class="tiny muted">'+esc(x.contact_name||'')+(x.postal_code?' • CEP '+esc(x.postal_code):'')+'</div></div>',
      '<small>'+new Date(x.created_at).toLocaleString('pt-BR')+'</small></div>',
      '<div class="list-row"><span>Interesses</span><strong>'+esc(interests)+'</strong></div>',
      '<div class="list-row"><span>Origem</span><strong>'+esc(source)+'</strong></div>',
      x.note?'<p class="muted tiny">'+esc(x.note)+'</p>':'',
      '<div class="order-actions"><a class="secondary small" href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a><span class="tiny muted">envios: '+Number(x.submission_count||1)+'</span></div>',
    '</article>'
  ].join('');
}
function adminPrelaunchLeadsSection(data){
  const leads=Array.isArray(data?.prelaunchLeads)?data.prelaunchLeads:[];
  const customers=leads.filter(x=>x.lead_type==='customer').length;
  const merchants=leads.filter(x=>x.lead_type==='merchant').length;
  return [
    '<section class="section">',
      '<div class="section-head"><div><span class="section-kicker">AQUISIÇÃO • PRÉ-LANÇAMENTO</span><h2>Clientes e parceiros interessados</h2><p>Leads captados pelo site com origem de campanha, categorias de interesse e WhatsApp para contato.</p></div><span class="status-pill online">'+leads.length+' lead(s)</span></div>',
      '<div class="merchant-kpis"><div class="kpi"><span class="label">Clientes interessados</span><strong>'+customers+'</strong></div><div class="kpi"><span class="label">Empresas interessadas</span><strong>'+merchants+'</strong></div></div>',
      '<div class="grid cards-3" style="margin-top:14px">'+(leads.length?leads.slice(0,60).map(adminPrelaunchLeadCard).join(''):'<div class="empty card">Nenhum lead captado ainda.</div>')+'</div>',
    '</section>'
  ].join('');
}
