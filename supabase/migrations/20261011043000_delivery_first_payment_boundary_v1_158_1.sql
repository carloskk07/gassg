-- TAMÃO V1.158.1 — first commercial capability: pay the seller on delivery.
-- No payment into TAMÃO, no advance-payment authorization by implication.
-- This migration is intentionally fail-closed; prepaid ordering requires a
-- separate, audited quote/order timing flow in a subsequent migration.

alter table public.quotes
  add column if not exists payment_timing_requested text not null default 'on_delivery';
alter table public.quotes
  drop constraint if exists quotes_payment_timing_requested_check;
alter table public.quotes
  add constraint quotes_payment_timing_requested_check
    check (payment_timing_requested in ('on_delivery','prepaid'));

alter table public.orders
  add column if not exists payment_timing text not null default 'on_delivery';
alter table public.orders
  drop constraint if exists orders_payment_timing_check;
alter table public.orders
  add constraint orders_payment_timing_check
    check (payment_timing in ('on_delivery','prepaid'));

-- Preserve historical payment evidence: an order that already had a hosted
-- or Pix provider checkout must not silently become a delivery-only order.
-- This is an evidence-based backfill, never a grant of new prepaid eligibility.
update public.orders o
set payment_timing='prepaid'
where exists(
  select 1 from public.merchant_sale_payment_attempts a
  where a.order_id=o.id
    and a.checkout_mode in ('hosted','pix','external_link')
    and a.status in (
      'preparing','checkout_ready','pending','approved','review_required',
      'refunded','cancelled','expired','rejected'
    )
);

-- A legacy manual/external Pix route records acceptance of Pix without
-- authorizing a hosted checkout. Convert only that explicitly active,
-- merchant-confirmed route into Pix accepted at the moment of delivery.
-- Never convert automated, connected, inactive or other-provider routes.
update public.merchant_payment_routes r
set channel='delivery',
    customer_label='Pix na entrega',
    updated_at=clock_timestamp()
where r.provider='manual'
  and r.payment_method='pix'
  and r.channel='external'
  and r.verification_mode='merchant_confirmed'
  and r.active
  and not exists (
    select 1 from public.merchant_payment_routes existing
    where existing.merchant_id=r.merchant_id
      and existing.payment_method='pix'
      and existing.provider='manual'
      and existing.channel='delivery'
  );

-- This single server-side policy is reusable by the order trigger and
-- future city/product capabilities. Active method AND suitable delivery
-- route are both required; a route marked online/external does not qualify.
create or replace function public.merchant_delivery_payment_allowed(
  p_merchant_id uuid,p_payment_method text
)
returns boolean
language sql stable security definer
set search_path to pg_catalog
as $func$
select p_merchant_id is not null
  and p_payment_method in ('cash','pix','card')
  and exists(
    select 1 from public.merchant_payment_methods pm
    where pm.merchant_id=p_merchant_id
      and pm.payment_method=p_payment_method and pm.active
  )
  and exists(
    select 1 from public.merchant_payment_routes r
    where r.merchant_id=p_merchant_id and r.active
      and r.channel='delivery'
      and (
        r.payment_method=p_payment_method
        or (p_payment_method='card'
          and r.payment_method in ('card_credit','card_debit'))
      )
      and r.verification_mode='merchant_confirmed'
  );
$func$;
revoke all on function public.merchant_delivery_payment_allowed(uuid,text)
  from public,anon,authenticated;
grant execute on function public.merchant_delivery_payment_allowed(uuid,text)
  to service_role;

-- Do not rely only on get-offers: creating a quote or replaying create-order
-- cannot authorize a non-delivery route. Existing orders remain executable;
-- re-assignments or payment-method changes are checked.
create or replace function public.guard_new_order_delivery_payment()
returns trigger
language plpgsql security definer
set search_path to pg_catalog
as $func$
begin
  if tg_op='UPDATE' then
    if new.payment_timing is distinct from old.payment_timing then
      raise exception 'ORDER_PAYMENT_TIMING_IMMUTABLE'
        using errcode='40001';
    end if;
    if new.merchant_id is not distinct from old.merchant_id
       and new.payment_method is not distinct from old.payment_method then
      return new;
    end if;
  end if;
  if new.payment_timing='on_delivery'
     and new.merchant_id is not null
     and not public.merchant_delivery_payment_allowed(
       new.merchant_id,new.payment_method
     ) then
    raise exception 'ORDER_DELIVERY_PAYMENT_ROUTE_NOT_AUTHORIZED'
      using errcode='40001';
  end if;
  return new;
end;
$func$;
drop trigger if exists guard_new_order_delivery_payment_trg on public.orders;
create trigger guard_new_order_delivery_payment_trg
before insert or update of merchant_id,payment_method,payment_timing
on public.orders
for each row execute function public.guard_new_order_delivery_payment();
revoke all on function public.guard_new_order_delivery_payment()
  from public,anon,authenticated;
grant execute on function public.guard_new_order_delivery_payment()
  to service_role;

-- Prevent an automated charge from being prepared against a delivery-only
-- order, even if a future endpoint accidentally selects an online route.
-- Existing payment attempts are not rewritten and callbacks can still settle.
create or replace function public.guard_new_prepaid_attempt()
returns trigger
language plpgsql security definer
set search_path to pg_catalog
as $func$
begin
  if new.checkout_mode in ('hosted','pix','external_link') then
    if not exists(
      select 1
      from public.orders o
      join public.merchant_payment_routes r
        on r.id=new.payment_route_id
       and r.merchant_id=o.merchant_id
       and r.active
       and r.channel='online'
       and r.verification_mode='provider_api'
      join public.merchant_payment_provider_accounts a
        on a.id=r.connection_id
       and a.merchant_id=r.merchant_id
       and a.provider=r.provider
       and a.status='active'
      join public.payment_provider_catalog catalog
        on catalog.provider_key=r.provider
       and catalog.adapter_status='implemented'
      where o.id=new.order_id
        and o.merchant_id=new.merchant_id
        and o.payment_timing='prepaid'
        and o.payment_method in ('pix','card')
        and (
          o.payment_method=r.payment_method
          or (o.payment_method='card'
            and r.payment_method in ('card_credit','card_debit'))
        )
        and coalesce(
          (a.capabilities->>'directSalePaymentsEnabled')::boolean,false
        )
        and coalesce(
          (a.capabilities->>'canValidateProviderTransactions')::boolean,false
        )
    ) then
      raise exception 'PREPAID_PAYMENT_NOT_AUTHORIZED'
        using errcode='40001';
    end if;
  end if;
  return new;
end;
$func$;
drop trigger if exists guard_new_prepaid_attempt_trg
  on public.merchant_sale_payment_attempts;
create trigger guard_new_prepaid_attempt_trg
before insert or update of payment_route_id,checkout_mode
on public.merchant_sale_payment_attempts
for each row execute function public.guard_new_prepaid_attempt();
revoke all on function public.guard_new_prepaid_attempt()
  from public,anon,authenticated;
grant execute on function public.guard_new_prepaid_attempt()
  to service_role;

-- Municipal readiness must mean that at least one customer checkout flow
-- can actually work. Preserve geographic, ANP/compliance, stock, financial,
-- launch and administrative pause gates from V1.152.
create or replace function public.market_city_offer_scope(p_city text,p_state text)
returns uuid[]
language sql stable security definer
set search_path to pg_catalog
as $func$
with requested as (
  select public.market_city_key(p_city) as city_key,
         upper(trim(coalesce(p_state,''))) as state
)
select coalesce(array_agg(m.id order by m.id),array[]::uuid[])
from requested r
join public.merchant_business_details d
  on upper(trim(d.state))=r.state
 and public.market_city_key(d.city)=r.city_key
join public.merchants m on m.id=d.merchant_id
where char_length(r.city_key)>=2
  and r.state ~ '^[A-Z]{2}$'
  and m.status='active'
  and m.online
  and m.accepts_citywide
  and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
  and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
  and public.merchant_operational_compliance_current(m.id)
  and public.merchant_allowed_in_operation_mode(m.id)
  and public.merchant_financial_sales_allowed(m.id)
  and exists (
    select 1 from public.platform_launch_control lc
    where lc.singleton and lc.commerce_enabled
      and lc.operation_mode in ('LIVE','PILOT')
  )
  and not exists (
    select 1 from public.market_cities mc
    where mc.state=r.state and mc.city_key=r.city_key and mc.admin_paused
  )
  and exists (
    select 1 from public.catalog_items ci
    where ci.merchant_id=m.id and ci.active
      and ci.available_stock>0 and ci.price_cents>0
      and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
  )
  and exists (
    select 1 from public.merchant_payment_methods pm
    where pm.merchant_id=m.id and pm.active
      and public.merchant_delivery_payment_allowed(m.id,pm.payment_method)
  );
$func$;
revoke all on function public.market_city_offer_scope(text,text)
  from public,anon,authenticated;
grant execute on function public.market_city_offer_scope(text,text)
  to service_role;

-- Keep the owner/manager self-service checklist aligned with the actual
-- transaction authority, avoiding false positives for external/online routes.
-- V1.158: self-service, owner/manager-scoped, read-only operational diagnostics.
-- Mirrors V1.152 merchant-city quotation gates; never toggles flags or overrides controls.
create or replace function public.merchant_enablement_diagnostic_v1_158(p_actor_user_id uuid,p_merchant_id uuid)
returns table(
  merchant_id uuid, merchant_name text, cnpj text, city text, state text,
  merchant_status text, ready boolean, blocker_count integer,
  checks jsonb, checked_at timestamptz
)
language sql stable security definer
set search_path to pg_catalog
as $func$
with target as materialized (
  select m.id,m.name,m.cnpj,m.status,m.online,m.accepts_citywide,
    m.last_seen_at,m.delivery_fee_confirmed_at,
    d.city,d.state
  from public.merchants m
  left join public.merchant_business_details d on d.merchant_id=m.id
  where m.id=p_merchant_id
    and exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=m.id and mm.user_id=p_actor_user_id
        and mm.active and mm.member_role in ('owner','manager')
    )
  limit 1
), checked as (
  select t.*,
    (coalesce(t.city,'')<>'' and t.state ~ '^[A-Z]{2}$') as has_region,
    exists (
      select 1 from public.platform_launch_control lc
      where lc.singleton and lc.commerce_enabled and lc.operation_mode in ('LIVE','PILOT')
    ) as global_commerce_enabled,
    public.merchant_allowed_in_operation_mode(t.id) as mode_allowed,
    public.merchant_cnpj_compliance_current(t.id) as cnpj_ok,
    public.merchant_anp_compliance_current(t.id) as anp_ok,
    public.merchant_financial_sales_allowed(t.id) as finance_ok,
    exists (
      select 1 from public.catalog_items ci
      where ci.merchant_id=t.id and ci.active
        and ci.available_stock>0 and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    ) as stock_price_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
    ) as payment_method_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
        and public.merchant_delivery_payment_allowed(t.id,pm.payment_method)
    ) as payment_route_ok,
    not exists (
      select 1 from public.market_cities mc
      where mc.state=upper(trim(t.state))
        and mc.city_key=public.market_city_key(t.city)
        and mc.admin_paused
    ) as city_not_paused,
    case
      when t.state ~ '^[A-Z]{2}$' and length(coalesce(t.city,''))>=2 then
        t.id=any(public.market_city_offer_scope(t.city,t.state))
      else false
    end as authoritative_offer_ready
  from target t
)
select c.id,c.name,c.cnpj,c.city,c.state,c.status,
  c.authoritative_offer_ready as ready,
  (select count(*)::integer from (
      values
      (c.status='active'),
      (c.online),
      (c.accepts_citywide),
      (c.last_seen_at>=statement_timestamp()-interval '10 minutes'),
      (c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'),
      (c.has_region),
      (c.cnpj_ok),
      (c.anp_ok),
      (c.mode_allowed),
      (c.global_commerce_enabled),
      (c.city_not_paused),
      (c.finance_ok),
      (c.stock_price_ok),
      (c.payment_method_ok),
      (c.payment_route_ok),
      (c.authoritative_offer_ready)
    ) as req(ok) where req.ok is not true) as blocker_count,
  (select coalesce(jsonb_agg(
      jsonb_build_object('key',req.key,'label',req.label,'ok',coalesce(req.ok,false),
        'action',req.action,'owner',req.owner,'scope',req.scope)
       order by req.sort
    ),'[]'::jsonb)
    from (values
      (10,'merchant_status','Cadastro e ativação',c.status='active',
        'Validar e ativar o cadastro no Admin após aprovação documental','admin','merchant'),
      (20,'cnpj','Regularidade do CNPJ',c.cnpj_ok,
        'Conferir documento, validade e confirmação do CNPJ','admin','merchant'),
      (30,'anp','Regularidade ANP quando houver GLP ativo',c.anp_ok,
        'Conferir autorização ANP quando a revenda anunciar GLP','admin','merchant'),
      (40,'operation_mode','Modo operacional da revenda',c.mode_allowed,
        'Verificar regras do modo operacional vigente, inclusive exigências específicas','admin','global'),
      (50,'global_commerce','Comércio habilitado na plataforma',c.global_commerce_enabled,
        'Verificar controles globais do TAMÃO; não habilitar vendas somente para eliminar bloqueio','admin','global'),
      (60,'location','Município e UF informados',c.has_region,
        'Conferir o endereço da revenda e seu município de atuação','admin','merchant'),
      (70,'city_pause','Cidade sem pausa administrativa',c.city_not_paused,
        'Conferir o motivo de pausa da cidade no painel de expansão','admin','city'),
      (80,'financial','Situação financeira liberada',c.finance_ok,
        'Conferir suspensão de vendas e pendências financeiras','admin','merchant'),
      (90,'inventory','Produto ativo com estoque e preço recente',c.stock_price_ok,
        'Ativar um produto permitido, informar estoque positivo e confirmar preço atualizado','merchant','merchant'),
      (100,'payment_method','Forma de pagamento ativa',c.payment_method_ok,
        'Habilitar uma forma de pagamento aceita pelo estabelecimento','merchant','merchant'),
      (110,'payment_route','Pagamento na entrega disponível',c.payment_route_ok,
        'Ative Pix, dinheiro ou cartão na entrega; não é necessário conectar um PSP para começar','merchant','merchant'),
      (120,'delivery_area','Cobertura de entrega da cidade',c.accepts_citywide,
        'Confirmar capacidade de atender a cidade conforme as regras do produto','merchant','merchant'),
      (130,'delivery_fee','Preço de entrega atualizado',c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours',
        'Confirmar taxa de entrega da revenda para os próximos pedidos','merchant','merchant'),
      (140,'online','Revenda disponível',c.online,
        'Entrar no painel da revenda e confirmar disponibilidade','merchant','realtime'),
      (150,'heartbeat','Presença atualizada',c.last_seen_at>=statement_timestamp()-interval '10 minutes',
        'Conferir conexão e presença recente da revenda','merchant','realtime'),
      (160,'quote_authority','Autorização final para novas cotações',c.authoritative_offer_ready,
        'Revisar os bloqueios acima; o motor de cotações é a autoridade final','system','realtime')
    ) as req(sort,key,label,ok,action,owner,scope)
  ) as checks,
  statement_timestamp() as checked_at
from checked c
order by c.authoritative_offer_ready asc, c.name,c.id;
$func$;
revoke all on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid)
  to service_role;
