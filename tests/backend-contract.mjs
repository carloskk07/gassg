import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const normalized=sql.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();

function assertSqlBalanced(source){
  let depth=0;
  let single=false;
  let dollar=false;
  let lineComment=false;

  for(let i=0;i<source.length;i++){
    const ch=source[i];
    const next=source[i+1];

    if(lineComment){
      if(ch==='\n') lineComment=false;
      continue;
    }

    if(!single && !dollar && ch==='-' && next==='-'){
      lineComment=true;
      i++;
      continue;
    }

    if(!single && ch==='$' && next==='$'){
      dollar=!dollar;
      i++;
      continue;
    }

    if(dollar) continue;

    if(ch==="'"){
      if(single && next==="'"){
        i++;
        continue;
      }
      single=!single;
      continue;
    }

    if(single) continue;

    if(ch==='(') depth++;
    if(ch===')') depth--;

    assert.ok(depth>=0,'SQL possui parêntese de fechamento sem abertura');
  }

  assert.equal(single,false,'SQL terminou dentro de string');
  assert.equal(dollar,false,'SQL terminou dentro de bloco dollar-quoted');
  assert.equal(depth,0,'SQL possui parênteses desbalanceados');
}

assertSqlBalanced(sql);

const tables=[
  'profiles',
  'merchants',
  'merchant_members',
  'catalog_items',
  'quotes',
  'quote_items',
  'orders',
  'order_items',
  'order_events',
  'wallet_entries',
  'referrals',
  'merchant_applications',
  'action_requests'
];

for(const table of tables){
  assert.match(normalized,new RegExp('create table if not exists public\\.'+table+'\\b'),table+' precisa existir');
  assert.match(normalized,new RegExp('alter table public\\.'+table+' enable row level security'),table+' precisa ter RLS');
}

assert.match(
  normalized,
  /revoke all on table[\s\S]*from anon, authenticated/,
  'anon/authenticated devem começar sem privilégios implícitos'
);

assert.match(
  normalized,
  /grant select on table public\.profiles, public\.merchants, public\.merchant_members, public\.catalog_items, public\.orders, public\.order_items, public\.order_events, public\.wallet_entries, public\.referrals, public\.merchant_applications to authenticated/,
  'leituras autenticadas precisam ser explícitas'
);

assert.doesNotMatch(
  normalized,
  /grant\s+(insert|update|delete|all)[\s\S]{0,240}\bto authenticated\b/,
  'frontend não pode escrever diretamente nas tabelas críticas'
);

assert.doesNotMatch(normalized,/security definer/,'schema inicial não deve introduzir SECURITY DEFINER');
assert.doesNotMatch(sql,/sb_secret_|service_role\s*[:=]\s*['"][a-z0-9._-]+/i,'nenhuma chave secreta pode estar no repositório');

assert.match(normalized,/create table if not exists public\.profiles/,'perfil mínimo por usuário precisa existir');
assert.match(normalized,/referral_code text not null unique/,'código de indicação precisa ser único e server-side');

assert.match(normalized,/merchant_applications_live_cnpj_idx/,'CNPJ não pode ter aplicações pendentes ou aprovadas duplicadas');

assert.match(normalized,/create table if not exists public\.quotes/,'cotação server-side precisa existir');
assert.match(normalized,/expires_at timestamptz not null/,'cotação precisa expirar');
assert.match(normalized,/consumed_at timestamptz/,'cotação precisa ser consumível uma única vez');

assert.match(normalized,/create table if not exists public\.action_requests/,'requisições idempotentes precisam existir');
assert.match(normalized,/idempotency_key text primary key/,'ação server-side precisa de chave idempotente');
assert.match(normalized,/request_hash text not null/,'reuso de chave com payload diferente precisa ser detectável');

assert.doesNotMatch(normalized,/create policy[^;]+on public\.quotes/,'clientes não podem consultar quotes diretamente');
assert.doesNotMatch(normalized,/create policy[^;]+on public\.quote_items/,'clientes não podem consultar preços congelados diretamente');
assert.doesNotMatch(normalized,/create policy[^;]+on public\.action_requests/,'clientes não podem consultar tabela de idempotência');

assert.match(normalized,/gross_total_cents integer/,'total bruto precisa ser inteiro em centavos');
assert.match(normalized,/cashback_reserved_cents integer/,'cashback reservado precisa ser inteiro em centavos');
assert.match(normalized,/amount_cents integer not null/,'ledger precisa usar centavos inteiros');
assert.match(normalized,/idempotency_key text not null unique/,'ledger precisa de idempotência');
assert.match(normalized,/bucket text not null check \(bucket in \('cashback','commission_pending','commission_available'\)\)/,'ledger precisa separar cashback e comissões');
assert.match(normalized,/commission_withdrawal/,'ledger precisa suportar saque futuro como débito auditável');
assert.match(normalized,/cashback_reversal/,'ledger precisa suportar reversão de cashback');
assert.match(normalized,/referral_pending_release/,'movimento de comissão pendente precisa ter saída explícita');
assert.match(normalized,/amount_cents < 0/,'débitos financeiros precisam ter sinal negativo obrigatório');

assert.match(normalized,/pin_hash text not null/,'PIN não pode ser armazenado em texto puro');
assert.doesNotMatch(normalized,/\bpin\s+text\b/,'PIN em texto puro é proibido');

assert.match(normalized,/cnpj ~ '\^\[0-9a-z\]\{12\}\[0-9\]\{2\}\$'/,'CNPJ alfanumérico atual precisa ser aceito');

assert.match(normalized,/attempted_merchant_ids uuid\[\]/,'matching precisa registrar revendas já tentadas');
assert.match(normalized,/supplier_name_snapshot text/,'identidade confirmada da revenda precisa ser snapshot do pedido');

assert.doesNotMatch(
  normalized,
  /status = 'active' or exists \( select 1 from public\.merchant_members/,
  'cliente não pode ganhar acesso genérico ao cadastro de revendas'
);

assert.match(normalized,/create policy "read own merchant profile"/,'revenda só pode ler o próprio cadastro');
assert.match(normalized,/create policy "read own merchant catalog"/,'revenda só pode ler o próprio catálogo');

assert.match(normalized,/status <> 'requote_required'[\s\S]*proposed_merchant_id is not null[\s\S]*proposed_total_cents is not null/,'requote precisa ter proposta completa');
assert.match(normalized,/status not in \('out_for_delivery','arriving','delivered','settled'\)[\s\S]*dispatched_at is not null/,'status de rota exige saída confirmada');
assert.match(normalized,/status not in \('delivered','settled'\)[\s\S]*delivered_at is not null/,'entrega exige timestamp real');
assert.match(normalized,/status <> 'settled'[\s\S]*settled_at is not null/,'settlement exige timestamp real');
assert.match(normalized,/orders_one_active_per_customer_idx/,'banco precisa impedir dois pedidos ativos por cliente');
assert.match(normalized,/total_cents = gross_total_cents - cashback_reserved_cents/,'banco precisa garantir total líquido');
assert.match(normalized,/version integer not null default 1/,'pedido precisa suportar concorrência otimista');

assert.match(normalized,/publication supabase_realtime add table public\.orders/,'orders precisa estar preparado para Realtime');
assert.match(normalized,/publication supabase_realtime add table public\.order_events/,'order_events precisa estar preparado para Realtime');

console.log('Backend contract passou: SQL íntegro, RLS, grants, ledger, quotes, PIN hash, centavos e Realtime verificados.');
