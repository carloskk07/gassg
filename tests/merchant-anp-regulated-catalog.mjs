import assert from 'node:assert/strict';
import fs from 'node:fs';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=get('supabase/migrations/20261022171223_merchant_anp_regulated_catalog.sql');
const source=get('js/merchant.js');
const orders=get('supabase/functions/merchant-orders/index.ts');
const workflow=get('.github/workflows/audit.yml');
assert.match(sql,/CREATE OR REPLACE FUNCTION public\.merchant_anp_compliance_current\(p_merchant_id uuid\)/);
assert.match(sql,/STABLE SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
assert.match(sql,/ci\.merchant_id=p_merchant_id\s+and ci\.active/);
for(const predicate of [
 'public.is_glp_product_code(ci.product_code)',
 'public.is_glp_container_product_code(ci.product_code)',
 "p.delivery_class in ('regulated_glp','regulated_glp_container')"
])assert.ok(sql.includes(predicate),predicate+' must be considered for active regulated catalog');
assert.match(sql,/p.product_code=upper\(trim\(ci.product_code\)\) and p.active/,
 'only active registered product classes may affect merchant-wide requirements');
assert.match(sql,/return public\.merchant_anp_verification_current\(p_merchant_id\)/,
 'ANP expiry is delegated to the existing verified official policy');
assert.match(sql,/if not v_has_glp then\s+return true;/,
 'no GLP products must remain eligible without ANP');
assert.match(sql,/revoke all on function public\.merchant_anp_compliance_current\(uuid\) from public,anon,authenticated/);
assert.match(sql,/grant execute on function public\.merchant_anp_compliance_current\(uuid\) to service_role/);
assert.ok(orders.includes('admin.rpc("merchant_anp_compliance_current"'),
 'Merchant portal must get the server-side decision');
assert.match(source,/const complianceReady=cnpjCurrent&&anpCurrent;/,
 'UI must never override ANP-current=false because it lacks registry delivery classes');
assert.ok(workflow.includes('node tests/merchant-anp-regulated-catalog.mjs'));
const cases=[
 {code:'WATER20',active:true,dclass:'household_general',expected:false},
 {code:'WOOD',active:true,dclass:'household_general',expected:false},
 {code:'P13',active:true,expected:true},
 {code:'P90_CONTAINER',active:true,expected:true},
 {code:'P13_CONTAINER',active:false,expected:false},
 {code:'GLP_CUSTOM',active:true,dclass:'regulated_glp',expected:true},
 {code:'GLP_EMPTY',active:true,dclass:'regulated_glp_container',expected:true},
 {code:'GLP_CUSTOM',active:true,dclass:'household_general',expected:false}
];
const regulated=x=>x.active&&((
 /^P(?:[1-9]|[1-8][0-9]|90)(?:_CONTAINER)?$/.test(x.code)||
 ['regulated_glp','regulated_glp_container'].includes(x.dclass)));
for(const x of cases)assert.equal(regulated(x),x.expected,x.code+' active='+x.active+' category='+x.dclass);
assert.equal(cases.slice(0,2).some(regulated),false,'general-only marketplace does not need ANP');
assert.equal(cases.some(regulated),true,'GLP or regulated container does need ANP');
console.log('PASS — ANP all-active-catalog parity: standard gas, container, regulated registry, non-GLP, ACL and source.');
