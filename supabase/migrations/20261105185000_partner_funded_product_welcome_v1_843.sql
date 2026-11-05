-- TAMÃO #843 — pedido de produtos com R$1 pago pela revenda aderente.
-- NENHUM dinheiro integral de venda passa pela conta da plataforma.
-- Cancelamentos/reversoes continuam usando a mesma carteira e o mesmo lote.
create table public.merchant_welcome_order_uses_v1_843 (
 order_id uuid primary key references public.orders(id) on delete restrict,
 merchant_id uuid not null references public.merchants(id) on delete restrict,
 customer_id uuid not null references auth.users(id) on delete restrict,
 welcome_lot_id uuid not null references public.wallet_entries(id) on delete restrict,
 contract_version integer not null check(contract_version>=1),
 terms_version integer not null check(terms_version=1),
 amount_cents integer not null check(amount_cents=100),
 gross_cents integer not null check(gross_cents>=100),
 net_cents integer not null check(net_cents=gross_cents-amount_cents),
 fee_bps_snapshot integer not null check(fee_bps_snapshot between 1 and 1000),
 trace_wallet_entry_id uuid not null unique references public.wallet_entries(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create index merchant_welcome_order_uses_customer_v1_843_idx
 on public.merchant_welcome_order_uses_v1_843(customer_id,created_at desc);
create index merchant_welcome_order_uses_merchant_v1_843_idx
 on public.merchant_welcome_order_uses_v1_843(merchant_id,created_at desc);
alter table public.merchant_welcome_order_uses_v1_843 enable row level security;
revoke all on public.merchant_welcome_order_uses_v1_843 from public,anon,authenticated;

create function public.merchant_welcome_order_use_immutable_v1_843()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$begin
 raise exception 'PARTNER_WELCOME_APPLICATION_IMMUTABLE' using errcode='42501';
end;$$;
revoke all on function public.merchant_welcome_order_use_immutable_v1_843()
 from public,anon,authenticated;
create trigger merchant_welcome_order_immutable_v1_843_trg
before update or delete on public.merchant_welcome_order_uses_v1_843
for each row execute function public.merchant_welcome_order_use_immutable_v1_843();

alter table public.platform_receivables
 add column benefit_fee_basis_cents_v1_843 integer
 check(benefit_fee_basis_cents_v1_843 is null or benefit_fee_basis_cents_v1_843>=0);

-- Motivo: a taxa comercial reduzida exige que exista antes uma aplicacao
-- com prova exata do lote e um aceite de parceiro validado. O trigger roda
-- apenas quando a reserva de beneficios foi ATOMICAMENTE reconhecida.
create function public.merchant_welcome_fee_snapshot_v1_843()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $fn$
declare
 v_app public.merchant_welcome_order_uses_v1_843%rowtype;
 v_fee integer;
 v_release integer;
 v_terms integer;
begin
 select * into v_app from public.merchant_welcome_order_uses_v1_843
 where order_id=new.id;
 if not found then return new;end if;
 if new.merchant_id is distinct from v_app.merchant_id
    or new.customer_id<>v_app.customer_id
    or new.gross_total_cents<>v_app.gross_cents
    or new.total_cents<>v_app.net_cents
    or new.cashback_reserved_cents<>v_app.amount_cents
    or old.status in ('SETTLED','CANCELLED')
 then raise exception 'PARTNER_WELCOME_ORDER_SNAPSHOT_IMMUTABLE'
   using errcode='23514';end if;
 if old.cashback_reserved_cents>0 then
  -- Outro modulo jamais pode mudar o desconto ja congelado.
  if new.cashback_reserved_cents is distinct from old.cashback_reserved_cents
    or new.total_cents is distinct from old.total_cents
  then raise exception 'PARTNER_WELCOME_ORDER_SNAPSHOT_IMMUTABLE'
    using errcode='23514';end if;
  return new;
 end if;
 if old.cashback_reserved_cents<>0
    or old.total_cents<>old.gross_total_cents
    or old.financial_state<>'pending'
 then raise exception 'PARTNER_WELCOME_NOT_FIRST_RESERVATION'
   using errcode='40001';end if;
 select m.version into v_terms
 from public.merchant_benefit_participations_v1_842 m
 where m.merchant_id=new.merchant_id and m.opted_in
   and m.terms_version=v_app.terms_version for share;
 if v_terms is null or v_terms<>v_app.contract_version
 then raise exception 'PARTNER_WELCOME_CONSENT_CHANGED'
   using errcode='40001';end if;
 if new.billing_plan_key_snapshot='flex_daily'
    and new.platform_fee_bps_snapshot=900 then
   new.platform_fee_bps_snapshot:=800;
 end if;
 v_fee:=floor(new.total_cents::numeric*new.platform_fee_bps_snapshot/10000)::integer;
 v_release:=greatest(old.prepaid_fee_reserved_cents_snapshot-v_fee,0);
 if v_release>0 then
   update public.merchant_billing_accounts
   set credit_reserved_cents=credit_reserved_cents-v_release,
       updated_at=clock_timestamp()
   where merchant_id=new.merchant_id and credit_reserved_cents>=v_release;
   if not found then raise exception 'PARTNER_WELCOME_PREPAID_CREDIT_DRIFT'
     using errcode='40001';end if;
   new.prepaid_fee_reserved_cents_snapshot:=old.prepaid_fee_reserved_cents_snapshot-v_release;
   if new.prepaid_fee_reserved_cents_snapshot=0 then
     new.prepaid_fee_credit_source_plan_key_snapshot:=null;
   end if;
 end if;
 return new;
end;$fn$;
revoke all on function public.merchant_welcome_fee_snapshot_v1_843()
 from public,anon,authenticated;
create trigger zzz_merchant_welcome_fee_snapshot_v1_843
before update of cashback_reserved_cents,total_cents on public.orders
for each row execute function public.merchant_welcome_fee_snapshot_v1_843();

-- Um desconto contratado nunca viaja para outra revenda, nem e recalculado
-- por requote de preco. O comprador deve cancelar e escolher nova cotacao.
create function public.merchant_welcome_no_transfer_v1_843()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$begin
 if exists(select 1 from public.merchant_welcome_order_uses_v1_843 u
       where u.order_id=old.id)
    and (new.merchant_id is distinct from old.merchant_id
      or new.proposed_merchant_id is distinct from old.proposed_merchant_id
      or new.gross_total_cents is distinct from old.gross_total_cents
      or (new.status='REQUOTE_REQUIRED' and old.status<>'REQUOTE_REQUIRED'))
 then raise exception 'PARTNER_WELCOME_NEW_QUOTE_REQUIRED'
   using errcode='40001';end if;
 return new;
end;$$;
revoke all on function public.merchant_welcome_no_transfer_v1_843()
 from public,anon,authenticated;
create trigger zzz_merchant_welcome_no_transfer_v1_843
before update of merchant_id,proposed_merchant_id,gross_total_cents,status
on public.orders for each row execute function public.merchant_welcome_no_transfer_v1_843();

CREATE OR REPLACE FUNCTION public.ensure_order_settlement_accounting(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_platform_fee integer:=0;
  v_credit_applied integer:=0;
  v_due_at timestamptz;
  v_partner_discount integer:=0;
  v_reimbursable integer:=0;
  v_fee_basis integer:=0;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.financial_reversed_at is not null
     or v_order.merchant_id is null
     or v_order.payment_confirmed_at is null
     or v_order.delivered_at is null
     or v_order.settled_at is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
  end if;

  v_credit_applied:=v_order.prepaid_fee_credit_applied_cents;

  select coalesce(sum(u.amount_cents),0)::integer
  into v_partner_discount
  from public.merchant_welcome_order_uses_v1_843 u
  where u.order_id=v_order.id and u.merchant_id=v_order.merchant_id
    and u.customer_id=v_order.customer_id;
  if v_partner_discount>0 and (
    v_partner_discount<>100 or v_order.cashback_reserved_cents<>100
    or v_order.total_cents<>v_order.gross_total_cents-v_partner_discount
    or not exists(select 1 from public.merchant_welcome_order_uses_v1_843 u
      where u.order_id=v_order.id and u.net_cents=v_order.total_cents
        and u.gross_cents=v_order.gross_total_cents
        and u.fee_bps_snapshot=v_order.platform_fee_bps_snapshot)
  ) then raise exception 'PARTNER_WELCOME_RECEIPT_MISMATCH' using errcode='23514';end if;
  v_reimbursable:=v_order.cashback_reserved_cents-v_partner_discount;
  if v_reimbursable<0 then
    raise exception 'PARTNER_WELCOME_REIMBURSEMENT_NEGATIVE' using errcode='23514';end if;
  v_fee_basis:=v_order.gross_total_cents-v_partner_discount;
  v_platform_fee:=floor(
    (v_fee_basis::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  if v_order.prepaid_fee_reserved_cents_snapshot>0
     and v_order.prepaid_fee_credit_consumed_at is null
     and v_order.prepaid_fee_credit_released_at is null then

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_order.merchant_id::text,0)
    );

    update public.merchant_billing_accounts
    set plan_key=case
          when credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot=0
           and greatest(credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,0)=0
            then 'flex_daily'
          else plan_key
        end,
        credit_balance_cents=credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot,
        credit_reserved_cents=greatest(
          credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,
          0
        ),
        updated_at=clock_timestamp()
    where merchant_id=v_order.merchant_id
      and credit_balance_cents>=v_order.prepaid_fee_reserved_cents_snapshot
      and credit_reserved_cents>=v_order.prepaid_fee_reserved_cents_snapshot;

    if found then
      v_credit_applied:=least(
        v_order.prepaid_fee_reserved_cents_snapshot,
        v_platform_fee
      );

      update public.orders
      set prepaid_fee_credit_applied_cents=v_credit_applied,
          prepaid_fee_credit_consumed_at=clock_timestamp()
      where id=v_order.id;

      insert into public.merchant_fee_credit_ledger(
        merchant_id,order_id,entry_type,amount_cents,plan_key,reference
      )
      values(
        v_order.merchant_id,v_order.id,'fee_consumption',
        -v_credit_applied,v_order.prepaid_fee_credit_source_plan_key_snapshot,
        'order-settlement:'||v_order.public_code
      );
    else
      raise exception 'PREPAID_FEE_RESERVATION_INCONSISTENT' using errcode='40001';
    end if;
  end if;

  v_due_at:=public.merchant_settlement_daily_due_at(v_order.settled_at);

  insert into public.platform_receivables(
    order_id,merchant_id,gross_total_cents,
    platform_fee_bps,platform_fee_cents,status,due_at,
    prepaid_credit_applied_cents,benefit_fee_basis_cents_v1_843
  )
  values(
    v_order.id,v_order.merchant_id,v_order.gross_total_cents,
    v_order.platform_fee_bps_snapshot,v_platform_fee,
    'open',v_due_at,v_credit_applied,
    case when v_partner_discount>0 then v_fee_basis else null end
  )
  on conflict(order_id) do nothing;

  -- A replay must neither charge again nor return a fictional zero-credit payment.
  -- The receivable is keyed by order_id; verify the idempotent result matches
  -- the already approved and immutable order snapshot.
  if not exists(
    select 1 from public.platform_receivables pr
    where pr.order_id=v_order.id
      and pr.merchant_id=v_order.merchant_id
      and pr.gross_total_cents=v_order.gross_total_cents
      and pr.platform_fee_bps=v_order.platform_fee_bps_snapshot
      and pr.platform_fee_cents=v_platform_fee
      and pr.due_at=v_due_at
      and pr.prepaid_credit_applied_cents=v_credit_applied
      and pr.benefit_fee_basis_cents_v1_843 is not distinct from
          case when v_partner_discount>0 then v_fee_basis else null end
  ) then
    raise exception 'SETTLEMENT_RECEIVABLE_SNAPSHOT_CONFLICT'
      using errcode='23514';
  end if;

  if v_reimbursable>0 then
    insert into public.merchant_cashback_reimbursements(
      order_id,merchant_id,cashback_cents,status,due_at
    )
    values(
      v_order.id,v_order.merchant_id,v_reimbursable,
      'open',v_due_at
    )
    on conflict(order_id) do nothing;

    -- A replay must never accept a different reimbursement fact just
    -- because the order_id uniqueness constraint suppressed insertion.
    if not exists(
      select 1
      from public.merchant_cashback_reimbursements r
      where r.order_id=v_order.id
        and r.merchant_id=v_order.merchant_id
        and r.cashback_cents=v_reimbursable
        and r.due_at=v_due_at
    ) then
      raise exception 'SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT'
        using errcode='23514';
    end if;
  elsif exists(
    select 1 from public.merchant_cashback_reimbursements r
    where r.order_id=v_order.id
  ) then
    -- Zero cashback orders must not have a reimbursable merchant debt.
    raise exception 'SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT'
      using errcode='23514';
  end if;

  update public.settlement_accounting_failures
  set resolved_at=clock_timestamp(),
      next_retry_at=null,
      dead_lettered_at=null,
      updated_at=clock_timestamp()
  where order_id=v_order.id
    and resolved_at is null;

  return jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'billingPlanKey',v_order.billing_plan_key_snapshot,
    'platformFeeCents',v_platform_fee,
    'prepaidCreditAppliedCents',v_credit_applied,
    'prepaidCreditSourcePlanKey',v_order.prepaid_fee_credit_source_plan_key_snapshot,
    'postpaidDueCents',greatest(v_platform_fee-v_credit_applied,0),
    'cashbackReimbursementCents',v_reimbursable,
    'partnerFundedDiscountCents',v_partner_discount,
    'feeBasisCents',v_fee_basis,
    'dueAt',v_due_at
  );
end;
$function$


create function public.create_product_welcome_order_v1_843(
 p_user_id uuid,p_quote_id uuid,p_payment_method text,
 p_idempotency_key text,p_request_hash text,
 p_referral_code text default null,p_cash_tender_cents integer default null,
 p_customer_phone text default null,p_address_complement text default null,
 p_delivery_reference text default null,p_delivery_notes text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $fn$
declare
 v_quote public.quotes%rowtype;
 v_part public.merchant_benefit_participations_v1_842%rowtype;
 v_grant public.platform_welcome_grants_v1_815%rowtype;
 v_lot public.platform_cashback_source_lots_v1_261%rowtype;
 v_action public.action_requests%rowtype;
 v_existing public.merchant_welcome_order_uses_v1_843%rowtype;
 v_order public.orders%rowtype;
 v_result jsonb;
 v_trace uuid;
 v_order_id uuid;
begin
 if p_user_id is null or p_quote_id is null or p_idempotency_key is null
    or p_request_hash is null then
    raise exception 'PARTNER_WELCOME_INVALID_REQUEST' using errcode='22023';end if;
 -- Mesma trava do checkout de produtos e da tarifa de moto/carro: um premio.
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('cashback-user:'||p_user_id::text,0));
 select * into v_action from public.action_requests
 where idempotency_key=p_idempotency_key for update;
 if found and v_action.completed_at is not null then
   if v_action.user_id<>p_user_id or v_action.action_name<>'create-order'
      or v_action.request_hash<>p_request_hash
   then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
   v_order_id:=(v_action.result_json->>'orderId')::uuid;
   select * into v_existing from public.merchant_welcome_order_uses_v1_843
   where order_id=v_order_id and customer_id=p_user_id;
   select * into v_order from public.orders where id=v_order_id;
   if not found or v_existing.order_id is null
      or v_existing.merchant_id<>v_order.merchant_id
      or v_existing.net_cents<>v_order.total_cents
   then raise exception 'PARTNER_WELCOME_REPLAY_CONFLICT' using errcode='23505';end if;
   return v_action.result_json||jsonb_build_object('welcomeReplayed',true);
 end if;

 select * into v_quote from public.quotes
 where id=p_quote_id and customer_id=p_user_id
   and consumed_at is null and expires_at>clock_timestamp()
 for update;
 if not found or v_quote.gross_total_cents<100
 then raise exception 'PARTNER_WELCOME_QUOTE_INVALID' using errcode='40001';end if;
 select * into v_part from public.merchant_benefit_participations_v1_842
 where merchant_id=v_quote.merchant_id and opted_in and terms_version=1
 for share;
 if not found then raise exception 'PARTNER_WELCOME_MERCHANT_NOT_PARTICIPATING'
   using errcode='42501';end if;
 select * into v_grant from public.platform_welcome_grants_v1_815
 where user_id=p_user_id and amount_cents=100;
 if not found then raise exception 'PARTNER_WELCOME_NOT_GRANTED'
   using errcode='40001';end if;
 select * into v_lot from public.platform_cashback_source_lots_v1_261
 where lot_id=v_grant.wallet_entry_id and user_id=p_user_id for update;
 if not found or v_lot.remaining_cents<100
    or (public.cashback_position(p_user_id)->>'spendableCents')::bigint<100
    or exists(select 1 from public.mobility_welcome_uses_v1_833 m
      where m.rider_id=p_user_id and m.status in ('reserved','spent'))
 then raise exception 'PARTNER_WELCOME_ALREADY_SPENT_OR_RESERVED'
   using errcode='40001';end if;
 if p_cash_tender_cents is not null and
    (p_payment_method<>'cash' or p_cash_tender_cents<v_quote.gross_total_cents-100
     or p_cash_tender_cents>1000000)
 then raise exception 'PARTNER_WELCOME_CASH_TENDER_INVALID' using errcode='22023';end if;

 v_result:=public.create_order_from_quote_v8(
   p_user_id,p_quote_id,p_payment_method,false,p_idempotency_key,
   p_request_hash,p_referral_code,null,p_customer_phone,
   p_address_complement,p_delivery_reference,p_delivery_notes);
 v_order_id:=(v_result->>'orderId')::uuid;
 select * into v_order from public.orders where id=v_order_id for update;
 if not found or v_order.customer_id<>p_user_id
   or v_order.merchant_id<>v_quote.merchant_id
   or v_order.gross_total_cents<>v_quote.gross_total_cents
   or v_order.cashback_reserved_cents<>0
   or v_order.total_cents<>v_order.gross_total_cents
   or v_order.status<>'OFFERED_TO_MERCHANT'
 then raise exception 'PARTNER_WELCOME_ORDER_UNEXPECTED' using errcode='40001';end if;

 insert into public.wallet_entries(
   user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
 ) values(p_user_id,v_order_id,'cashback','cashback_reserve',-100,
   'product:partner-welcome:'||v_order_id::text,
   jsonb_build_object('source','welcome_partner_funded_product',
      'welcomeLotId',v_grant.wallet_entry_id::text,'termsVersion',1))
 returning id into v_trace;
 if not exists(select 1 from public.platform_cashback_trace_events_v1_261 e
   join public.platform_cashback_trace_flows_v1_261 f
     on f.wallet_entry_id=e.wallet_entry_id
   where e.wallet_entry_id=v_trace and e.matched_cents=100
     and f.lot_id=v_grant.wallet_entry_id and f.amount_cents=100
     and f.direction='reserve')
 then raise exception 'PARTNER_WELCOME_LOT_TRACE_UNCONFIRMED'
   using errcode='40001';end if;

 insert into public.merchant_welcome_order_uses_v1_843(
   order_id,merchant_id,customer_id,welcome_lot_id,contract_version,
   terms_version,amount_cents,gross_cents,net_cents,fee_bps_snapshot,
   trace_wallet_entry_id)
 values(v_order_id,v_order.merchant_id,p_user_id,v_grant.wallet_entry_id,
   v_part.version,1,100,v_order.gross_total_cents,
   v_order.gross_total_cents-100,
   case when v_order.billing_plan_key_snapshot='flex_daily'
      and v_order.platform_fee_bps_snapshot=900 then 800
      else v_order.platform_fee_bps_snapshot end,
   v_trace);

 update public.orders
 set cashback_reserved_cents=100,
     total_cents=gross_total_cents-100,
     cash_tender_cents=p_cash_tender_cents
 where id=v_order_id and customer_id=p_user_id
   and status='OFFERED_TO_MERCHANT' and cashback_reserved_cents=0
 returning * into v_order;
 if not found or v_order.total_cents<>v_quote.gross_total_cents-100
    or v_order.platform_fee_bps_snapshot is distinct from
      (select fee_bps_snapshot from public.merchant_welcome_order_uses_v1_843
       where order_id=v_order_id)
 then raise exception 'PARTNER_WELCOME_ORDER_APPLY_FAILED'
   using errcode='40001';end if;
 v_result:=v_result||jsonb_build_object(
   'cashbackReservedCents',100,'totalCents',v_order.total_cents,
   'cashTenderCents',v_order.cash_tender_cents,
   'welcomeApplied',true,'partnerFundedDiscountCents',100,
   'partnerFeeBpsSnapshot',v_order.platform_fee_bps_snapshot,
   'welcomeTermsVersion',1,'welcomeReplayed',false);
 update public.action_requests set result_json=v_result
 where idempotency_key=p_idempotency_key and user_id=p_user_id;
 return v_result;
end;$fn$;
revoke all on function public.create_product_welcome_order_v1_843(
 uuid,uuid,text,text,text,text,integer,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.create_product_welcome_order_v1_843(
 uuid,uuid,text,text,text,text,integer,text,text,text,text)
 to service_role;

-- Preview privada: prova de elegibilidade sem reserva financeira nem identidade
-- de revenda no payload publico. A reserva atomica sera reavaliada no checkout.
create function public.product_welcome_quote_preview_v1_843(
 p_user_id uuid,p_quote_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog
as $fn$
declare
 v_quote public.quotes%rowtype;
 v_grant public.platform_welcome_grants_v1_815%rowtype;
 v_member public.merchant_benefit_participations_v1_842%rowtype;
 v_regular bigint:=0;
 v_available bigint:=0;
 v_lot_remaining bigint:=0;
 v_global bigint:=0;
 v_contract_eligible boolean:=false;
 v_enabled boolean:=false;
begin
 if p_user_id is null or p_quote_id is null
 then raise exception 'WELCOME_PREVIEW_INVALID' using errcode='22023';end if;
 select * into v_quote from public.quotes
 where id=p_quote_id and customer_id=p_user_id;
 if not found then raise exception 'WELCOME_PREVIEW_QUOTE_FORBIDDEN'
   using errcode='42501';end if;
 select * into v_grant from public.platform_welcome_grants_v1_815
 where user_id=p_user_id;
 v_global:=coalesce((public.cashback_position(p_user_id)->>'spendableCents')::bigint,0);
 if v_grant.user_id is not null then
   select coalesce(sum(l.remaining_cents),0)::bigint into v_regular
   from public.platform_cashback_source_lots_v1_261 l
   where l.user_id=p_user_id and l.lot_id<>v_grant.wallet_entry_id;
   select coalesce(l.remaining_cents,0)::bigint into v_lot_remaining
   from public.platform_cashback_source_lots_v1_261 l
   where l.user_id=p_user_id and l.lot_id=v_grant.wallet_entry_id;
 else
   v_regular:=v_global;
 end if;
 v_available:=greatest(0,least(v_global,v_regular));
 select * into v_member from public.merchant_benefit_participations_v1_842
 where merchant_id=v_quote.merchant_id and opted_in and terms_version=1;
 select commerce_enabled into v_enabled
 from public.platform_launch_control where singleton=true;
 v_contract_eligible:=coalesce(v_enabled,false)
   and v_member.merchant_id is not null
   and v_grant.user_id is not null
   and v_grant.amount_cents=100
   and v_lot_remaining>=100 and v_global>=100
   and v_quote.consumed_at is null and v_quote.expires_at>clock_timestamp()
   and v_quote.gross_total_cents>=100
   and not exists(select 1 from public.mobility_welcome_uses_v1_833 m
     where m.rider_id=p_user_id and m.status in ('reserved','spent'));
 return jsonb_build_object(
   'source','product_welcome_quote_preview_v1_843',
   'readOnly',true,'quoteId',v_quote.id,'merchantId',v_quote.merchant_id,
   'eligible',v_contract_eligible,
   'discountCents',case when v_contract_eligible then 100 else 0 end,
   'normalCashbackAvailableCents',v_available,
   'partnerFunded',v_contract_eligible,
   'buyerPaysMerchantDirectly',true,
   'canCombineWithPaidCoupon',false,
   'termsVersion',case when v_contract_eligible then 1 else null end);
end;$fn$;
revoke all on function public.product_welcome_quote_preview_v1_843(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.product_welcome_quote_preview_v1_843(uuid,uuid)
 to service_role;
