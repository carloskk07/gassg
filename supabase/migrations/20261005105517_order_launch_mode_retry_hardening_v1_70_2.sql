-- TAMÃO V1.70.6 — harden launch-mode checkout boundary.
-- New orders serialize against launch-mode changes and PILOT quotes must still
-- belong to a converted pilot merchant at checkout time.

create or replace function public.create_order_from_quote_v8(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null,
  p_cash_tender_cents integer default null,
  p_customer_phone text default null,
  p_address_complement text default null,
  p_delivery_reference text default null,
  p_delivery_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_enabled boolean:=false;
  v_mode text:='PRELAUNCH';
  v_action public.action_requests%rowtype;
  v_merchant_id uuid;
begin
  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key;

  if found and v_action.completed_at is not null then
    if v_action.user_id<>p_user_id
       or v_action.action_name<>'create-order'
       or v_action.request_hash<>p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;

    return public.create_order_from_quote_v7(
      p_user_id,p_quote_id,p_payment_method,p_use_cashback,
      p_idempotency_key,p_request_hash,p_referral_code,p_cash_tender_cents,
      p_customer_phone,p_address_complement,p_delivery_reference,p_delivery_notes
    );
  end if;

  select commerce_enabled,operation_mode
  into v_enabled,v_mode
  from public.platform_launch_control
  where singleton=true
  for share;

  if not coalesce(v_enabled,false) then
    raise exception 'COMMERCE_NOT_ENABLED' using errcode='55000';
  end if;

  if upper(coalesce(v_mode,'PRELAUNCH'))='PILOT' then
    select q.merchant_id
    into v_merchant_id
    from public.quotes q
    where q.id=p_quote_id
      and q.customer_id=p_user_id;

    if not found or not exists(
      select 1
      from public.pilot_partner_drafts d
      where d.merchant_id=v_merchant_id
        and d.onboarding_status='converted'
    ) then
      raise exception 'PILOT_MERCHANT_NOT_ALLOWED' using errcode='40001';
    end if;
  end if;

  return public.create_order_from_quote_v7(
    p_user_id,p_quote_id,p_payment_method,p_use_cashback,
    p_idempotency_key,p_request_hash,p_referral_code,p_cash_tender_cents,
    p_customer_phone,p_address_complement,p_delivery_reference,p_delivery_notes
  );
end;
$$;

revoke all on function public.create_order_from_quote_v8(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) from public,anon,authenticated;

grant execute on function public.create_order_from_quote_v8(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) to service_role;
