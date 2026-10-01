import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const normalized=sql.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();

const tables=[
  'merchants','merchant_members','catalog_items','orders','order_items',
  'order_events','wallet_entries','referrals','merchant_applications'
];

for(const table of tables){
  assert.match(normalized,new RegExp('create table if not exists public\\.'+table+'\\b'),table+' precisa existir');
  assert.match(normalized,new RegExp('alter table public\\.'+table+' enable row level security'),table+' precisa ter RLS');
}

assert.match(normalized,/revoke all on table[\s\S]*from anon, authenticated/,'anon/authenticated devem começar sem privilégios implícitos');
assert.match(normalized,/grant select on table public\.merchants, public\.catalog_items to authenticated/,'catálogo público autenticado precisa de SELECT explícito');
assert.doesNotMatch(normalized,/grant\s+(insert|update|delete|all)[\s\S]{0,200}\bto authenticated\b/,'frontend não pode escrever diretamente nas tabelas críticas');
assert.doesNotMatch(normalized,/security definer/,'schema inicial não deve introduzir SECURITY DEFINER');
assert.doesNotMatch(sql,/sb_secret_|service_role\s*[:=]\s*['"][a-z0-9._-]+/i,'nenhuma chave secreta pode estar no repositório');

assert.match(normalized,/gross_total_cents integer/,'total bruto precisa ser inteiro em centavos');
assert.match(normalized,/cashback_reserved_cents integer/,'cashback reservado precisa ser inteiro em centavos');
assert.match(normalized,/amount_cents integer not null/,'ledger precisa usar centavos inteiros');
assert.match(normalized,/idempotency_key text not null unique/,'ledger precisa de idempotência');
assert.match(normalized,/pin_hash text not null/,'PIN não pode ser armazenado em texto puro');
assert.doesNotMatch(normalized,/\bpin\s+text\b/,'PIN em texto puro é proibido');

assert.match(normalized,/cnpj ~ '\^\[0-9a-z\]\{12\}\[0-9\]\{2\}\$'/,'CNPJ alfanumérico atual precisa ser aceito');
assert.match(normalized,/attempted_merchant_ids uuid\[\]/,'matching precisa registrar revendas já tentadas');
assert.match(normalized,/version integer not null default 1/,'pedido precisa suportar concorrência otimista');

assert.match(normalized,/publication supabase_realtime add table public\.orders/,'orders precisa estar preparado para Realtime');
assert.match(normalized,/publication supabase_realtime add table public\.order_events/,'order_events precisa estar preparado para Realtime');

console.log('Backend contract passou: RLS, grants, ledger, PIN hash, centavos e Realtime verificados.');
