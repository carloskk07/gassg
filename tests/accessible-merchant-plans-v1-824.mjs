import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261104223500_revenda_accessible_prepaid_plans_v1_824.sql',import.meta.url),'utf8');
const merchants=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
const check=[
 ['flex_daily',900,null],
 ['credit_01990',800,1990],
 ['credit_04990',750,4990],
 ['credit_09990',700,9990],
 ['credit_19990',650,19990]
];
for(const [key,bps,cents] of check){
 assert.ok(sql.includes(key),key);
 if(cents)assert.match(sql,new RegExp("'"+key+"'[^\\n]*,"+bps+","+cents+","+cents+",true"),key+' valor e taxa');
 else assert.match(sql,/set platform_fee_bps=900/);
}
for(const old of ['credit_300','credit_1000','credit_3000'])
 assert.ok(sql.includes("'"+old+"'"),'legacy key preservada: '+old);
assert.ok(sql.includes('LEGACY_PREPAID_BALANCE_REVIEW_REQUIRED'),'bloquear desativacao quando houver credito antigo');
assert.ok(sql.includes('on conflict(plan_key) do nothing'),'idempotencia catalogo');
assert.ok(sql.includes("active=false"),'antigos planos devem sair da vitrine');
assert.ok(sql.includes('ACCESSIBLE_BILLING_CATALOG_CONFLICT'),'detectar valores incorretos');
assert.ok(!sql.includes('insert into public.merchant_fee_credit_ledger'),'migracao nao pode atribuir credito');
assert.ok(merchants.includes('merchantCancelBillingRequestFromUi'),'usuario deve poder cancelar cobranca antiga');
console.log('TAMÃO #824: catálogo comercial de revendas validado.');
