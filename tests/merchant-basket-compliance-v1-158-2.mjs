import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20261011063000_merchant_basket_compliance_v1_158_2.sql',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/get-offers/index.ts',import.meta.url),'utf8');
const rollbackTest=fs.readFileSync(new URL('./sql/merchant-basket-compliance-v1-158-2.sql',import.meta.url),'utf8');

const required=[
  'public.merchant_basket_compliance_current',
  'public.merchant_cnpj_compliance_current(p_merchant_id)',
  'public.merchant_anp_verification_current(p_merchant_id)',
  "'regulated_glp','regulated_glp_container'",
  'public.is_glp_product_code(code)',
  'public.is_glp_container_product_code(code)',
  "public.merchant_has_compliant_catalog_item",
  'quote_item_regulatory_authority_trg',
  'order_item_regulatory_authority_trg',
  'order_basket_regulatory_authority_trg',
  'QUOTE_PRODUCT_REGULATORY_NOT_AUTHORIZED',
  'ORDER_PRODUCT_REGULATORY_NOT_AUTHORIZED',
  'ORDER_BASKET_REGULATORY_NOT_AUTHORIZED',
  'CREATE OR REPLACE FUNCTION public.create_quote_snapshot',
  'CREATE OR REPLACE FUNCTION public.create_order_from_quote',
  'CREATE OR REPLACE FUNCTION public.merchant_order_action',
  'CREATE OR REPLACE FUNCTION public.system_rescue_order',
  'CREATE OR REPLACE FUNCTION public.process_order_timeouts',
  'CREATE OR REPLACE FUNCTION public.enforce_compliance_continuity',
  'CREATE OR REPLACE FUNCTION public.process_compliance_expiry',
  'CREATE OR REPLACE FUNCTION public.market_city_offer_scope',
  'CREATE OR REPLACE FUNCTION public.filter_delivery_compatible_merchants',
  'CREATE OR REPLACE FUNCTION public.merchant_enablement_diagnostic_v1_158',
  'public.merchant_basket_compliance_current(m,p_product_codes)',
  'public.merchant_basket_compliance_current(m.id,array[ci.product_code])',
  'revoke all on function public.merchant_basket_compliance_current',
];
for(const part of required)assert.ok(sql.toLowerCase().includes(part.toLowerCase()),'Missing SQL regulatory rule: '+part);

for(const name of [
 'enforce_active_merchant_compliance','admin_set_merchant_status',
 'enforce_compliance_continuity','process_compliance_expiry'
]){
 const begin=sql.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
 assert.ok(begin>=0,'Missing '+name);
 const body=sql.slice(begin,sql.indexOf('$function$;',begin));
 assert.ok(!body.includes('merchant_anp_compliance_current('),
   'ANP expiry must not suspend all products in '+name);
}
for(const name of ['create_order_from_quote','merchant_order_action','system_rescue_order','process_order_timeouts']){
 const begin=sql.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
 const body=sql.slice(begin,sql.indexOf('$function$;',begin));
 assert.ok(body.includes('merchant_basket_compliance_current('),
   'Product-scoped gate missing: '+name);
}
assert.ok(sql.includes("new.status not in ('CANCELLED','SETTLED')"),
  'Cancellation must not be blocked by expired ANP');
assert.ok(edge.includes('"filter_delivery_compatible_merchants"'),
  'Customer offers must use the SQL compatibility authority');
assert.ok(rollbackTest.startsWith('-- PostgreSQL real transaction regression'));
assert.ok(rollbackTest.includes('begin;')&&rollbackTest.includes('rollback;'));
for(const forbidden of ['P13','P13_CONTAINER','CHARCOAL4']){
 assert.ok(rollbackTest.includes(forbidden),'Missing SQL scenario '+forbidden);
}
console.log('V1.158.2: catalog, basket, regulatory guards, rescue, rollback and UX authority contracts passed.');
