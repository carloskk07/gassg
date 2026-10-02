-- Chama São Gabriel — first real merchant pilot v1.28
-- Stages a real commercial lead without fabricating legal/regulatory data and
-- adds server-only load signals for quality-first marketplace distribution.

create table if not exists public.pilot_partner_drafts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique check (char_length(display_name) between 2 and 120),
  proposed_product_code text not null default 'P13'
    check (
      proposed_product_code in ('WATER20','CHARCOAL4','WOOD','ICE5')
      or proposed_product_code ~ '^P([1-9]|[1-8][0-9]|90)$'
    ),
  proposed_delivered_price_cents integer not null
    check (proposed_delivered_price_cents between 1 and 100000000),
  delivery_included boolean not null default true,
  price_status text not null default 'proposed'
    check (price_status in ('proposed','confirmed')),
  onboarding_status text not null default 'awaiting_legal_data'
    check (onboarding_status in ('awaiting_legal_data','ready_for_review','converted','cancelled')),
  merchant_id uuid references public.merchants(id) on delete set null,
  notes text check (notes is null or char_length(notes)<=2000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.pilot_partner_drafts enable row level security;
revoke all on table public.pilot_partner_drafts from public, anon, authenticated;
grant all on table public.pilot_partner_drafts to service_role;

create index if not exists pilot_partner_drafts_status_idx
  on public.pilot_partner_drafts(onboarding_status,created_at desc);

insert into public.pilot_partner_drafts(
  display_name,proposed_product_code,proposed_delivered_price_cents,
  delivery_included,price_status,onboarding_status,notes
)
values(
  'Gas e Lenheira do JR','P13',11590,
  true,'proposed','awaiting_legal_data',
  'Primeiro parceiro piloto. Preço comercial informado verbalmente: R$ 115,90 entregue. Não publicar nem ativar como oferta real até cadastrar e validar os dados legais, regulatórios e operacionais.'
)
on conflict(display_name) do update
set proposed_product_code=excluded.proposed_product_code,
    proposed_delivered_price_cents=excluded.proposed_delivered_price_cents,
    delivery_included=excluded.delivery_included,
    price_status='proposed',
    onboarding_status=case
      when public.pilot_partner_drafts.onboarding_status='converted' then 'converted'
      else 'awaiting_legal_data'
    end,
    notes=excluded.notes,
    updated_at=clock_timestamp();

create or replace function public.merchant_offer_load(p_merchant_ids uuid[])
returns table(
  merchant_id uuid,
  active_orders integer,
  recent_orders_7d integer
)
language sql
security definer
set search_path=pg_catalog
as $$
  with requested as (
    select unnest(coalesce(p_merchant_ids,'{}'::uuid[])) as merchant_id
  ),
  active as (
    select o.merchant_id,count(*)::integer as n
    from public.orders o
    where o.merchant_id=any(coalesce(p_merchant_ids,'{}'::uuid[]))
      and o.status in (
        'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
        'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
      )
    group by o.merchant_id
  ),
  recent as (
    select o.merchant_id,count(*)::integer as n
    from public.orders o
    where o.merchant_id=any(coalesce(p_merchant_ids,'{}'::uuid[]))
      and o.created_at>=clock_timestamp()-interval '7 days'
      and o.status<>'CANCELLED'
    group by o.merchant_id
  )
  select r.merchant_id,
         coalesce(a.n,0)::integer,
         coalesce(x.n,0)::integer
  from requested r
  left join active a using(merchant_id)
  left join recent x using(merchant_id);
$$;

revoke all on function public.merchant_offer_load(uuid[]) from public, anon, authenticated;
grant execute on function public.merchant_offer_load(uuid[]) to service_role;
