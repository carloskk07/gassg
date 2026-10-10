import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261010150000_multicity_commerce_boundary_v1_152.sql');
const postal=read('supabase/functions/_shared/postal-code.js');
const offers=read('supabase/functions/get-offers/index.ts');
const customer=read('js/customer.js');
const admin=read('supabase/functions/admin-ops/index.ts');
const pane=read('js/admin-acquisition.js');

for(const gate of [
  "m.status='active'","m.online","m.accepts_citywide",
  "merchant_operational_compliance_current","merchant_financial_sales_allowed",
  "merchant_allowed_in_operation_mode",
  "m.last_seen_at>=statement_timestamp()-interval '10 minutes'",
  "m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'",
  "ci.available_stock>0","ci.price_cents>0",
  "ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'",
  "pm.active","pr.active","lc.commerce_enabled","mc.admin_paused"
])assert.ok(sql.includes(gate),'escopo municipal deve impor: '+gate);

assert.ok(sql.includes('join public.merchant_business_details d'));
assert.ok(sql.includes("upper(trim(d.state))=r.state"));
assert.ok(sql.includes("public.market_city_key(d.city)=r.city_key"));
assert.ok(sql.includes("before insert or update of merchant_id,postal_code on public.quotes"));
assert.ok(sql.includes("pc.service_area_allowed"));
assert.ok(sql.includes("if not new.merchant_id=any(v_ids)"));
assert.ok(sql.includes("raise exception 'MERCHANT_CITY_NOT_READY'"));
assert.ok(sql.includes('orders_city_reassignment_guard'));
assert.ok(sql.includes("before update of merchant_id,proposed_merchant_id on public.orders"));
assert.ok(sql.includes('ORDER_PROPOSED_MERCHANT_CITY_CONFLICT'));
assert.ok(sql.includes('ORDER_MERCHANT_CITY_CONFLICT'));
assert.ok(sql.includes('admin_set_market_city_pause'));
assert.ok(sql.includes("a.admin_role in ('superadmin','operations')"));
assert.ok(sql.includes("'market-city-pause','market_city'"));
assert.ok(sql.includes("grant execute on function public.market_city_offer_scope(text,text) to service_role"));
assert.ok(sql.includes('from public,anon,authenticated'));
assert.ok(sql.includes("admin_paused boolean not null default false"),'cidade não inicia pausada');

assert.ok(postal.includes('await cityServiceEligible(admin,cached.city,cached.state)'),
  'cache antigo não pode congelar cidades ou manter cidade aberta sem elegibilidade');
assert.ok(postal.includes('await cityServiceEligible(admin,resolved.city,resolved.state)'));
assert.ok(postal.includes('market_city_ready'));
assert.ok(postal.includes('service_area_allowed:allowed'));
assert.ok(postal.includes('POSTAL_CODE_OUTSIDE_SERVICE_AREA'));
assert.ok(offers.includes('market_city_offer_scope'));
assert.ok(offers.includes('p_city:postal.city,p_state:postal.state'));
assert.ok(offers.includes('.in("id",cityMerchantIds)'));
assert.ok(offers.includes('regionAvailable:false'));
assert.ok(admin.includes('"market-city-pause"'));
assert.ok(admin.includes('admin_set_market_city_pause'));
assert.ok(pane.includes('adminPauseMarketCity'));
assert.ok(pane.includes('eligibleMerchantCount'));
assert.ok(pane.includes('AGUARDANDO REVENDA APTA'));

const begin=customer.indexOf('function startCustomerAvailability()');
const end=customer.indexOf('\n}',begin);
assert.ok(begin>=0&&end>begin);
const snippet=customer.slice(begin,end+2);
function start(ready){
  let action='';
  const ctx={
    globalThis:{liveReady:()=>ready,__CHAMA_TEST__:false},
    startHomeOrder:()=>{action='order';},
    openPrelaunchCustomerLead:()=>{action='lead';}
  };
  vm.runInNewContext(snippet+';startCustomerAvailability();',ctx);
  return action;
}
assert.equal(start(true),'order','cidade com backend operacional consulta a oferta');
assert.equal(start(false),'lead','fora do backend o fluxo preserva interesse consentido');
console.log('V1.152 passou: isolamento municipal, antifraude de cotações, pausa auditada e consulta antes do aviso.');
