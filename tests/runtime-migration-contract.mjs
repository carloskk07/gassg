import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20261001070000_reconcile_runtime_v1_4.sql',import.meta.url),'utf8');
const n=sql.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const defaultPrivileges=fs.readFileSync(new URL('../supabase/migrations/20261002173404_lock_default_data_api_privileges.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const maintainPrivileges=fs.readFileSync(new URL('../supabase/migrations/20261002173435_revoke_default_maintain_privilege.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const sequenceHardening=fs.readFileSync(new URL('../supabase/migrations/20261002200242_server_only_sequence_and_pilot_fk_hardening.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const moneySafety=fs.readFileSync(new URL('../supabase/migrations/20261002202113_int4_cart_money_safety.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const adminEmailBootstrap=fs.readFileSync(new URL('../supabase/migrations/20261002213038_platform_admin_email_bootstrap_reservation.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const authorizedPricing=fs.readFileSync(new URL('../supabase/migrations/20261002214500_authorized_price_ranges.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const authorizedPricingFreshness=fs.readFileSync(new URL('../supabase/migrations/20261002215500_authorized_price_range_quote_freshness_fix.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const adminBootstrapFkIndex=fs.readFileSync(new URL('../supabase/migrations/20261002220500_admin_bootstrap_claimed_user_index.sql',import.meta.url),'utf8').replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();

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

assert.match(defaultPrivileges,/revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated/,'defaults de tabelas precisam nascer sem autoridade do browser');
assert.match(defaultPrivileges,/revoke execute on functions from public, anon, authenticated/,'funções futuras não podem nascer públicas');
assert.match(defaultPrivileges,/grant execute on functions to service_role/,'funções futuras precisam preservar autoridade server-side');
assert.match(maintainPrivileges,/revoke maintain on tables from anon, authenticated/,'PG17 MAINTAIN precisa ser revogado explicitamente');
assert.match(sequenceHardening,/revoke all on all sequences in schema public from anon, authenticated/,'sequências existentes precisam ser fechadas para browser');
assert.match(sequenceHardening,/create index if not exists pilot_partner_drafts_merchant_idx/,'FK do staging de parceiro precisa de índice');
assert.match(moneySafety,/catalog_items_unit_price_int4_safe/,'catálogo precisa de constraint monetária explícita');
assert.match(moneySafety,/quote_items_unit_price_int4_safe/,'cotação precisa de constraint monetária explícita');
assert.match(moneySafety,/order_items_unit_price_int4_safe/,'pedido precisa de constraint monetária explícita');
assert.match(adminEmailBootstrap,/create table if not exists public\.platform_admin_bootstrap_reservations/,'bootstrap por e-mail deve usar reserva server-only');
assert.match(adminEmailBootstrap,/email_sha256 bytea primary key/,'e-mail administrativo não pode ser persistido em texto na reserva');
assert.match(adminEmailBootstrap,/u\.email_confirmed_at is not null/,'bootstrap deve exigir e-mail Auth confirmado');
assert.match(adminEmailBootstrap,/u\.is_anonymous is false/,'bootstrap deve exigir identidade permanente');
assert.match(adminEmailBootstrap,/revoke all on table public\.platform_admin_bootstrap_reservations from public, anon, authenticated/,'reserva administrativa não pode ser visível ao browser');
assert.match(adminEmailBootstrap,/chama-first-admin-bootstrap/,'bootstrap reservado deve ter job server-side de ativação');
assert.match(authorizedPricing,/pricing_mode text not null default 'fixed'/,'catálogo precisa suportar modo fixo/faixa');
assert.match(authorizedPricing,/pricing_strategy text not null default 'balanced'/,'catálogo precisa registrar estratégia do parceiro');
assert.match(authorizedPricing,/min_price_cents<=price_cents/,'preço normal precisa ficar acima do mínimo autorizado');
assert.match(authorizedPricing,/price_cents<=max_price_cents/,'preço normal precisa ficar abaixo do máximo autorizado');
assert.match(authorizedPricing,/r\.unit_price_cents between ci\.min_price_cents and ci\.max_price_cents/,'snapshot deve rejeitar preço fora da faixa autorizada');
assert.match(authorizedPricing,/r\.unit_price_cents\*r\.quantity/,'snapshot precisa congelar o preço efetivamente ofertado');
assert.match(authorizedPricingFreshness,/delivery_fee_confirmed_at is null/,'quote ranged precisa preservar freshness da taxa de entrega');
assert.match(authorizedPricingFreshness,/ci\.price_confirmed_at is not null/,'quote ranged precisa preservar freshness por SKU');
assert.match(authorizedPricingFreshness,/for share of ci/,'quote ranged precisa bloquear os SKUs enquanto congela o snapshot');
assert.match(authorizedPricingFreshness,/r\.unit_price_cents between ci\.min_price_cents and ci\.max_price_cents/,'quote ranged precisa validar a faixa após o lock');
assert.match(adminBootstrapFkIndex,/platform_admin_bootstrap_reservations_claimed_user_idx/,'FK de claimed admin precisa de índice de cobertura');

console.log('Runtime migration contract passou.');
