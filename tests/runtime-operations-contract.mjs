import assert from 'node:assert/strict';
import fs from 'node:fs';

const repricing=fs.readFileSync(new URL('../supabase/migrations/20261001071000_freeze_requote_item_prices.sql',import.meta.url),'utf8');
const watchdog=fs.readFileSync(new URL('../supabase/migrations/20261001072000_add_order_timeout_watchdog.sql',import.meta.url),'utf8');
const hardening=fs.readFileSync(new URL('../supabase/migrations/20261001090000_hardening_v1_5.sql',import.meta.url),'utf8');
const requote=fs.readFileSync(new URL('../supabase/migrations/20261001093000_requote_contract_hardening.sql',import.meta.url),'utf8');
const anonRls=fs.readFileSync(new URL('../supabase/migrations/20261001091500_anonymous_auth_rls_hardening.sql',import.meta.url),'utf8');
const summary=fs.readFileSync(new URL('../supabase/migrations/20261001094500_customer_summary_authority.sql',import.meta.url),'utf8');
const settlement=fs.readFileSync(new URL('../supabase/migrations/20261001094700_settlement_payment_confirmation.sql',import.meta.url),'utf8');
const r=repricing.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const w=watchdog.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const h=hardening.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const q=requote.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const a=anonRls.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const s=summary.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const st=settlement.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();

assert.match(r,/create table if not exists public\.order_requote_items/,'re-cotação precisa congelar preços por item');
assert.match(r,/revoke all on table public\.order_requote_items from anon, authenticated/,'snapshot de re-cotação deve ser server-only');
assert.match(r,/sync_order_item_prices_on_supplier_change/,'troca de revenda precisa sincronizar preços');
assert.match(r,/requote_total_mismatch/,'total proposto precisa conferir com itens congelados');
assert.match(r,/order_item_total_mismatch/,'total final precisa conferir com itens da nova revenda');
assert.match(r,/after update of merchant_id, proposed_merchant_id on public\.orders/,'integridade precisa ser protegida por trigger no banco');
assert.match(r,/security definer[\s\S]*set search_path = pg_catalog/,'trigger privilegiado precisa fixar search_path');

assert.match(w,/create extension if not exists pg_cron/,'watchdog precisa de pg_cron');
assert.match(w,/system_reassign_expired_order/,'timeout de aceite precisa ter resgate server-side');
assert.match(w,/process_order_timeouts/,'watchdog principal precisa existir');
assert.match(w,/status='at_risk'/,'preparação atrasada precisa entrar em risco');
assert.match(w,/eta_risk/,'ETA vencido precisa gerar evento');
assert.match(w,/chama-order-watchdog/,'cron do Chama precisa ser nomeado e versionado');
assert.match(w,/\* \* \* \* \*/,'watchdog precisa rodar a cada minuto');
assert.match(w,/revoke all on function public\.system_reassign_expired_order\(uuid\)[\s\S]*from public, anon, authenticated/,'resgate automático não pode ser chamado pelo browser');
assert.match(w,/revoke all on function public\.process_order_timeouts\(\)[\s\S]*from public, anon, authenticated/,'watchdog não pode ser chamado pelo browser');
assert.match(w,/to postgres, service_role/,'watchdog precisa ser restrito a autoridade server-side');

assert.match(h,/create table if not exists public\.api_rate_limits/,'rate limiter precisa persistir buckets server-side');
assert.match(h,/revoke all on table public\.api_rate_limits from anon, authenticated/,'rate buckets não podem ser expostos ao browser');
assert.match(h,/consume_api_quota/,'quota precisa ser atômica no Postgres');
assert.match(h,/grant execute on function public\.consume_api_quota\(uuid,text,integer,integer\)[\s\S]*to service_role/,'quota só pode ser consumida pelo server');
assert.match(h,/alter function public\.merchant_order_action[\s\S]*set search_path to pg_catalog, extensions/,'dispatch precisa resolver pgcrypto em extensions');
assert.match(h,/alter function public\.complete_order_delivery[\s\S]*set search_path to pg_catalog, extensions/,'validação do PIN precisa resolver pgcrypto em extensions');
assert.match(h,/encode\(extensions\.gen_random_bytes\(10\),'hex'\)/,'referral code precisa ser aleatório e independente do UUID');
assert.doesNotMatch(h,/referral_code[\s\S]{0,180}replace\(new\.id::text/,'referral code não pode derivar do auth UUID');
assert.match(h,/status not in \('reassigning','requote_required'\)/,'RLS deve revogar acesso da revenda antiga durante rescue/requote');
assert.match(h,/create or replace function public\.system_rescue_order/,'rescue genérico server-side precisa existir');
assert.match(h,/create or replace function public\.merchant_fail_before_dispatch/,'revenda precisa conseguir falhar com segurança antes do despacho');
assert.match(h,/available_stock=available_stock\+v_item\.quantity/,'falha pós-aceite precisa devolver estoque');
assert.match(h,/merchant_cannot_fulfill/,'rescue precisa registrar motivo operacional');
assert.match(h,/create or replace function public\.process_data_retention/,'dados efêmeros precisam de retenção');
assert.match(h,/chama-data-retention/,'retenção precisa ser agendada');
assert.match(h,/order_delivery_secrets[\s\S]*interval '24 hours'/,'PIN bruto consumido precisa expirar');
assert.match(h,/public\.quotes[\s\S]*interval '24 hours'/,'quotes expirados precisam ser limpos');

assert.match(q,/proposed_delivery_fee_cents/,'re-cotação precisa congelar taxa de entrega');
assert.match(q,/interval '5 minutes'/,'re-cotação precisa ter validade limitada');
assert.match(q,/requote_expired/,'aceite de re-cotação expirada precisa ser bloqueado');
assert.match(q,/system_expire_requote/,'watchdog precisa encerrar re-cotação abandonada');
assert.match(q,/expiredrequotesprocessed/,'watchdog precisa reportar re-cotações expiradas');
assert.match(q,/old\.proposed_delivery_fee_cents/,'troca de fornecedor deve validar taxa congelada, não taxa atual');

assert.match(a,/revoke select on table public\.orders, public\.order_items, public\.order_events from authenticated/,'pedidos reais devem ser lidos apenas por Edge Function');
assert.match(a,/auth\.jwt\(\)->>'is_anonymous'/,'RLS de revenda deve distinguir identidade permanente');
assert.match(s,/customer_financial_summary/,'resumo financeiro mínimo precisa existir');
assert.match(s,/grant execute on function public\.customer_financial_summary\(uuid\) to service_role/,'resumo financeiro deve ser server-only');
assert.match(st,/payment_confirmed_at/,'settlement precisa registrar confirmação de pagamento');
assert.match(st,/payment_confirmation_method='merchant_attestation'/,'piloto deve registrar origem da confirmação de pagamento');
assert.match(st,/status <> 'settled'[\s\S]*payment_confirmed_at is not null/,'constraint deve impedir SETTLED sem pagamento confirmado');
assert.match(st,/payment_confirmed[\s\S]*delivered[\s\S]*settled/,'eventos financeiros e de entrega precisam ser auditáveis');

console.log('Requote + watchdog + hardening v1.5 contract passou.');
