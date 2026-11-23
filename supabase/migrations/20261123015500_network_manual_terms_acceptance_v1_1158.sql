-- V1.1158 — aceite explícito do participante no saque manual.
-- Preparação técnica: NÃO aprova termos, NÃO ativa pagamentos automáticos,
-- NÃO cria créditos e NÃO altera saldos financeiros.
create table if not exists public.network_manual_terms_acceptances_v1_1158 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  request_key text not null
    check (request_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  terms_reference text not null
    check (length(terms_reference) between 12 and 160),
  accepted_at timestamptz not null default clock_timestamp(),
  source text not null default 'manual-withdrawal-request'
    check (source = 'manual-withdrawal-request'),
  unique(user_id,request_key)
);
alter table public.network_manual_terms_acceptances_v1_1158 enable row level security;
revoke all on public.network_manual_terms_acceptances_v1_1158 from public,anon,authenticated;
grant select,insert on public.network_manual_terms_acceptances_v1_1158 to service_role;

create or replace function public.network_manual_payout_request_with_terms_v1_1158(
  p_user uuid,
  p_key text,
  p_terms_reference text,
  p_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_result jsonb;
  v_ref constant text := 'https://tamao.com.br/rede-regulamento-2026-11-22.html';
begin
  if p_accepted is distinct from true
    or p_user is null or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,80}$'
    or p_terms_reference is distinct from v_ref
  then
    raise exception 'NETWORK_MANUAL_TERMS_ACCEPTANCE_REQUIRED' using errcode='42501';
  end if;
  -- O aceite é para a versão efetivamente publicada e aprovada pelo operador.
  -- A validade da modalidade depende dos controles existentes: nenhuma
  -- aprovação unilateral nesta função.
  if not (
    exists(select 1 from public.network_ads_pool_policy_v1_1154 p
      where p.singleton and p.accrual_enabled and p.payouts_enabled=false
        and p.redemption_terms_approved_at is not null
        and p.redemption_terms_reference=v_ref)
    or exists(select 1 from public.network_fee_package_policy_v1_1030 p
      where p.singleton and p.accrual_enabled and p.payouts_enabled=false
        and p.terms_approved_at is not null and p.terms_reference=v_ref)
  ) then
    raise exception 'NETWORK_MANUAL_PUBLISHED_TERMS_NOT_ACTIVE' using errcode='42501';
  end if;

  -- A função financeira legada faz todas as provas de elegibilidade, saldo,
  -- origem, maturação, idempotência, reservas e limite mínimo dentro da
  -- mesma transação. Em caso de erro, o aceite tampouco é registrado.
  v_result:=public.network_manual_payout_request_v1_1034(p_user,p_key);
  insert into public.network_manual_terms_acceptances_v1_1158
    (user_id,request_key,terms_reference)
  values (p_user,p_key,v_ref)
  on conflict (user_id,request_key) do nothing;
  return v_result;
end $function$;

revoke all on function public.network_manual_payout_request_with_terms_v1_1158(uuid,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.network_manual_payout_request_with_terms_v1_1158(uuid,text,text,boolean)
  to service_role;
comment on function public.network_manual_payout_request_with_terms_v1_1158(uuid,text,text,boolean)
  is 'Solicita saque manual validado com aceite explícito registrado no servidor, sem envio Pix.';
