import assert from 'node:assert/strict';
import fs from 'node:fs';

const repricing=fs.readFileSync(new URL('../supabase/migrations/20261001071000_freeze_requote_item_prices.sql',import.meta.url),'utf8');
const watchdog=fs.readFileSync(new URL('../supabase/migrations/20261001072000_add_order_timeout_watchdog.sql',import.meta.url),'utf8');
const r=repricing.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
const w=watchdog.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();

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

console.log('Requote + watchdog contract passou.');
