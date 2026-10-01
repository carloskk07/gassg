import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20261001070000_reconcile_runtime_v1_4.sql',import.meta.url),'utf8');
const n=sql.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();

for(const fn of ['create_order_from_quote','merchant_order_action','customer_order_action','complete_order_delivery']){
  assert.match(n,new RegExp('create or replace function public\\.'+fn+'\\b'),fn+' precisa estar versionada');
  assert.match(n,new RegExp('revoke all on function public\\.'+fn+'[\\s\\S]*from public, anon, authenticated'),fn+' não pode ser executável pelo browser');
  assert.match(n,new RegExp('grant execute on function public\\.'+fn+'[\\s\\S]*to service_role'),fn+' precisa ser restrita ao server');
}

assert.match(n,/create table if not exists public\.order_delivery_secrets/,'PIN server-only precisa ter tabela própria');
assert.match(n,/revoke all on table public\.order_delivery_secrets from anon, authenticated/,'PIN bruto não pode ser legível pelo browser');
assert.match(n,/revoke select on table public\.orders, public\.order_items, public\.order_events from authenticated/,'identidade interna do pedido não pode vazar por PostgREST');
assert.match(n,/alter table public\.orders alter column pin_hash drop not null/,'PIN deve nascer apenas no despacho');
assert.match(n,/orders_pin_required_after_dispatch/,'hash do PIN deve ser obrigatório depois do despacho');
assert.match(n,/quotes_address_text_check/,'quote precisa ser vinculado ao endereço');
assert.match(n,/on_auth_user_created_chama/,'Auth precisa gerar perfil/referral automaticamente');
assert.match(n,/security definer[\s\S]*set search_path = pg_catalog/,'funções privilegiadas precisam fixar search_path');

assert.doesNotMatch(sql,/sb_secret_[A-Za-z0-9_-]+/,'migration não pode conter secret key');

console.log('Runtime migration contract passou.');
