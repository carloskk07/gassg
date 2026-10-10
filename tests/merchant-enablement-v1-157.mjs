import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261010163000_merchant_enablement_diagnostic_v1_157.sql');
const canonical=read('supabase/migrations/20261010150000_multicity_commerce_boundary_v1_152.sql');
const backend=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin.js');
const ui=read('js/admin-acquisition.js');
assert.ok(sql.includes('function public.admin_merchant_enablement_v1_157(p_limit integer default 80)'));
assert.ok(sql.includes('stable security definer'));
assert.ok(sql.includes('revoke all on function public.admin_merchant_enablement_v1_157(integer)'));
assert.ok(sql.includes('from public,anon,authenticated'));
assert.ok(sql.includes('grant execute on function public.admin_merchant_enablement_v1_157(integer)'));
assert.ok(sql.includes('to service_role'));
assert.ok(sql.includes('limit least(greatest(coalesce(p_limit,80),1),100)'), 'bounded read');
assert.ok(sql.includes('public.market_city_offer_scope(t.city,t.state)'), 'quote scope remains authority');
for(const g of [
  "c.status='active'","c.online","c.accepts_citywide",
  "c.last_seen_at>=statement_timestamp()-interval '10 minutes'",
  "c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'",
  "c.global_commerce_enabled","c.mode_allowed","c.finance_ok",
  "c.cnpj_ok","c.anp_ok","c.city_not_paused",
  "c.stock_price_ok","c.payment_method_ok","c.payment_route_ok"
])assert.ok(sql.includes(g),'must explain '+g);
for(const gate of ['merchant_allowed_in_operation_mode','merchant_cnpj_compliance_current',
  'merchant_anp_compliance_current','merchant_financial_sales_allowed','catalog_items',
  'merchant_payment_methods','merchant_payment_routes','market_cities','platform_launch_control']){
  assert.ok(sql.includes(gate), 'missing real authority condition '+gate);
  assert.ok(canonical.includes(gate)||['merchant_cnpj_compliance_current','merchant_anp_compliance_current'].includes(gate),
    'mismatch with canonical scope '+gate);
}
assert.ok(!/update public\.(merchants|market_cities|platform_launch_control)/i.test(sql));
assert.ok(!/insert into public\./i.test(sql),'no fake readiness data');
assert.ok(backend.includes('"merchant-enablement"'));
assert.ok(backend.includes('admin.rpc("admin_merchant_enablement_v1_157",{p_limit:80})'));
assert.ok(backend.includes('readOnly:true'));
assert.ok(backend.includes('source:"market_city_offer_scope"'));
assert.ok(backend.includes('["superadmin","operations","compliance","readonly"]'));
for(const str of ["enablement:new Set(['superadmin','readonly','operations','compliance'])",
  "adminMenuButton('enablement','Habilitação'",
  "adminPanel('enablement',adminEnablementSection(d))",
  "if(next==='enablement')adminLoadEnablement().catch"]){
  assert.ok(admin.includes(str),str);
}
assert.ok(ui.includes("async function adminLoadEnablement()"));
assert.ok(ui.includes("function adminEnablementMerchantCard(entry)"));
assert.ok(ui.includes("function adminEnablementCheckRow(check)"));
assert.ok(ui.includes('Revalidar agora'));
assert.ok(admin.includes('adminRuntime.enablementMerchants=[]'),'signout/auth failure must clear privileged diagnostics');
assert.ok(ui.includes("String(adminRuntime.session?.user?.id||'')!==requestingUser"),'drop responses after identity changes');
assert.ok(ui.includes('Sem liberações automáticas.'));
assert.ok(!ui.includes("adminPerform('merchant-enablement'"));
const cut=(source,name)=>{const begin=source.indexOf('function '+name+'(');assert.ok(begin>=0);const end=source.indexOf('\n}',begin);assert.ok(end>begin);return source.slice(begin,end+2);};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const sandbox={esc};
vm.runInNewContext(cut(ui,'adminEnablementCheckRow')+
  '\n'+cut(ui,'adminEnablementMerchantCard')+';this.card=adminEnablementMerchantCard;',sandbox);
const output=sandbox.card({merchant_name:'<img src=x onerror=alert(1)>',city:'Santa Maria',
  state:'RS',cnpj:'12345678000190',merchant_status:'pending',ready:false,
  checks:[{key:'payment_route',label:'<script>alert(1)</script>',ok:false,
    action:'<svg onload=alert(1)>',scope:'merchant'}]});
assert.ok(output.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(output.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(output.includes('&lt;svg onload=alert(1)&gt;'));
assert.ok(!output.includes('<script>')&&!output.includes('<img'));
assert.ok(output.includes('1 bloqueio(s)'));
assert.ok(output.includes('Próxima ação'));
const done=sandbox.card({merchant_name:'Revenda Exemplo',city:'São Gabriel',state:'RS',
  merchant_status:'active',ready:true,checks:[{key:'stock',label:'Estoque',ok:true}]});
assert.ok(done.includes('Apta para cotação'));
assert.ok(done.includes('Conforme'));
console.log('V1.157 passou: SQL restrito, equivalência operacional, sem ativação, painel XSS e status reais');
