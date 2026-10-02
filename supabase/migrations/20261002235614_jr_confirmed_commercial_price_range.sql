-- Chama v1.33 — confirmed commercial range for first pilot partner.
-- JR remains staged/server-only; this does not create a live merchant or real offer.

alter table public.pilot_partner_drafts
  add column if not exists pricing_mode text not null default 'fixed',
  add column if not exists min_delivered_price_cents integer,
  add column if not exists preferred_delivered_price_cents integer,
  add column if not exists max_delivered_price_cents integer,
  add column if not exists pricing_strategy text not null default 'balanced';

update public.pilot_partner_drafts
set min_delivered_price_cents=coalesce(min_delivered_price_cents,proposed_delivered_price_cents),
    preferred_delivered_price_cents=coalesce(preferred_delivered_price_cents,proposed_delivered_price_cents),
    max_delivered_price_cents=coalesce(max_delivered_price_cents,proposed_delivered_price_cents);

alter table public.pilot_partner_drafts
  alter column min_delivered_price_cents set not null,
  alter column preferred_delivered_price_cents set not null,
  alter column max_delivered_price_cents set not null;

alter table public.pilot_partner_drafts
  drop constraint if exists pilot_partner_drafts_pricing_mode_check,
  drop constraint if exists pilot_partner_drafts_pricing_strategy_check,
  drop constraint if exists pilot_partner_drafts_price_range_check,
  drop constraint if exists pilot_partner_drafts_fixed_price_range_check;

alter table public.pilot_partner_drafts
  add constraint pilot_partner_drafts_pricing_mode_check
    check (pricing_mode in ('fixed','range')),
  add constraint pilot_partner_drafts_pricing_strategy_check
    check (pricing_strategy in ('volume','balanced','margin')),
  add constraint pilot_partner_drafts_price_range_check
    check (
      min_delivered_price_cents between 1 and 1000000
      and preferred_delivered_price_cents between 1 and 1000000
      and max_delivered_price_cents between 1 and 1000000
      and min_delivered_price_cents<=preferred_delivered_price_cents
      and preferred_delivered_price_cents<=max_delivered_price_cents
    ),
  add constraint pilot_partner_drafts_fixed_price_range_check
    check (
      pricing_mode='range'
      or (
        min_delivered_price_cents=preferred_delivered_price_cents
        and preferred_delivered_price_cents=max_delivered_price_cents
      )
    );

update public.pilot_partner_drafts
set proposed_delivered_price_cents=12000,
    pricing_mode='range',
    min_delivered_price_cents=11590,
    preferred_delivered_price_cents=12000,
    max_delivered_price_cents=12500,
    pricing_strategy='balanced',
    price_status='confirmed',
    notes='Primeiro parceiro piloto. Faixa comercial P13 confirmada: mínimo R$ 115,90, preço normal R$ 120,00 e máximo R$ 125,00, com entrega incluída. Estratégia inicial do motor: equilibrada, sempre limitada à faixa autorizada. Não publicar nem ativar como oferta real até cadastrar e validar os dados legais, regulatórios e operacionais.',
    updated_at=clock_timestamp()
where display_name='Gas e Lenheira do JR'
  and proposed_product_code='P13';
