import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261010180000_prospect_crm_radar_v1_154.sql');
const backend=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const admin=read('js/admin.js');
for(const key of ['admin_update_anp_prospect','admin_expansion_radar'])
  assert.ok(sql.includes('function public.'+key+'('),key+' must exist');
assert.ok(sql.includes("a.admin_role in ('superadmin','operations','compliance')"),'CRM mutações restritas');
assert.ok(sql.includes("v_previous.crm_version<>p_expected_version"),'otimistic version');
assert.ok(sql.includes("'PROSPECT_VERSION_CONFLICT'"),'no lost updates');
assert.ok(sql.includes("'PROSPECT_PARTNER_NOT_VERIFIED'"),'não inventar parceiros');
assert.ok(sql.includes("m.status='active'"),'partner status requires real active merchant');
assert.ok(sql.includes('contact_attempts=contact_attempts+case when v_channel is not null then 1 else 0 end'),'contato apenas após evento explícito');
assert.ok(sql.includes("last_contacted_at=case when v_channel is not null"),'no false contact');
assert.ok(sql.includes("'anp-prospect-crm'"),'audit trail');
assert.ok(sql.includes('p_follow_up_at<statement_timestamp()-interval'), 'follow-up constrained');
assert.ok(sql.includes('count(distinct i.lead_id)'), 'radar dedup customers across CEPs in one city');
assert.ok(sql.includes("l.consent_at is not null"),'no unconsented demand scores');
assert.ok(sql.includes("l.status not in ('closed','converted')"),'suppressed demand');
assert.ok(sql.includes("p.overdue_followups"),'urgency based on recorded follow-ups');
assert.ok(sql.includes('market_city_offer_scope(s.city,s.state)'), 'real eligible merchant signal');
assert.ok(sql.includes('limit least(greatest(coalesce(p_limit,60),1),100)'), 'bound complex read');
for(const sig of [
  'public.admin_expansion_radar(integer)',
  'public.admin_update_anp_prospect(uuid,text,integer,text,text,timestamptz,text)'
]){
  assert.ok(sql.includes('revoke all on function '+sig),'RLS bypass inaccessible');
  assert.ok(sql.includes('grant execute on function '+sig),'service only');
}
assert.ok(!sql.includes('update public.market_cities set commerce_enabled'), 'CRM cannot open cities');
assert.ok(!sql.includes('update public.merchants set status'), 'CRM cannot activate merchants');
assert.ok(backend.includes('"expansion-radar"')&&backend.includes('"prospect-crm"'));
assert.ok(backend.includes('admin_update_anp_prospect'));
assert.ok(backend.includes('admin_expansion_radar'));
assert.ok(backend.includes('p_expected_version:version'));
assert.ok(backend.includes('crm_version,source_checked_at'));
assert.ok(admin.includes('adminLoadExpansionRadar().catch'));
assert.ok(ui.includes('function adminExpansionRadarSection()'));
assert.ok(ui.includes('function adminProspectCrmEditor(record)'));
assert.ok(ui.includes('function adminSaveProspect(cnpj,expectedVersion)'));
assert.ok(ui.includes('adminPerform(\'prospect-crm\''));
assert.ok(ui.includes('Não registrar contato'));
assert.ok(ui.includes('Marque contato somente após realizá-lo'));
assert.ok(ui.includes('não é previsão de vendas'));

function extract(name){
  const begin=ui.indexOf('function '+name+'(');
  assert.ok(begin>=0,name+' missing');
  const end=ui.indexOf('\n}',begin);
  assert.ok(end>begin,name+' malformed');
  return ui.slice(begin,end+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const stage="const PROSPECT_STAGE_LABELS={uncontacted:'Não contatada',contacted:'Contatada',interested:'Interessada',onboarding:'Em cadastro',partner:'Parceira confirmada',dismissed:'Descartada'};";
const editor=vm.runInNewContext(stage+'\n'+extract('adminProspectCrmEditor')+';adminProspectCrmEditor',{
  esc,adminCurrentRole:()=> 'operations',adminRuntime:{actionPending:false}
});
const record={cnpj:'12345678000190',prospect_status:'uncontacted',crm_version:4,notes:'<img src=x onerror=alert(1)>'};
const html=editor(record);
assert.ok(html.includes('expectedVersion')===false);
assert.ok(html.includes('adminSaveProspect(&#39;')===false);
assert.ok(html.includes('adminSaveProspect(\\'12345678000190\\',4)'));
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!html.includes('<img'));
assert.ok(html.includes('Não registrar contato'));
const readonly=vm.runInNewContext(stage+'\n'+extract('adminProspectCrmEditor')+';adminProspectCrmEditor',{
  esc,adminCurrentRole:()=> 'readonly',adminRuntime:{actionPending:false}
});
assert.equal(readonly(record),'','readonly cannot edit');
const radar=vm.runInNewContext(extract('adminRadarCityCard')+';adminRadarCityCard',{esc});
const malicious=radar({city:'<img src=x>',state:'RS',priority_score:34,
  anp_prospects:17,uncontacted:17,interested_customers:0,eligible_merchants:0});
assert.ok(malicious.includes('&lt;img src=x&gt;'));
assert.ok(!malicious.includes('<img'));
assert.ok(malicious.includes('data-city="RS|&lt;img'));
assert.ok(!malicious.includes("adminProspectSelectCity('"),'handler must use dataset');
console.log('V1.154 CRM, radar, conflict version, availability semantics and XSS tests passed.');
