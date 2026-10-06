-- TAMÃO V1.70.20 — atomic optimistic concurrency for merchant payment methods.
-- A stale owner/manager tab must not silently re-enable a payment method disabled elsewhere.
-- Replays after a lost ACK are accepted only when the committed state already equals the request.

create or replace function public.merchant_update_payment_methods_cas(
  p_merchant_id uuid,
  p_expected_updated_at timestamptz,
  p_pix boolean,
  p_card boolean,
  p_cash boolean,
  p_confirmed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_current_updated_at timestamptz;
  v_pix boolean:=false;
  v_card boolean:=false;
  v_cash boolean:=false;
  v_now timestamptz:=coalesce(p_confirmed_at,clock_timestamp());
begin
  if p_merchant_id is null then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;
  if not (coalesce(p_pix,false) or coalesce(p_card,false) or coalesce(p_cash,false)) then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode='22023';
  end if;

  perform 1
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  perform 1
  from public.merchant_payment_methods
  where merchant_id=p_merchant_id
  for update;

  select
    max(updated_at),
    coalesce(bool_or(active) filter(where payment_method='pix'),false),
    coalesce(bool_or(active) filter(where payment_method='card'),false),
    coalesce(bool_or(active) filter(where payment_method='cash'),false)
  into v_current_updated_at,v_pix,v_card,v_cash
  from public.merchant_payment_methods
  where merchant_id=p_merchant_id;

  if v_current_updated_at is distinct from p_expected_updated_at then
    if v_pix=coalesce(p_pix,false)
       and v_card=coalesce(p_card,false)
       and v_cash=coalesce(p_cash,false) then
      return jsonb_build_object(
        'ok',true,
        'alreadyApplied',true,
        'updatedAt',v_current_updated_at,
        'pix',v_pix,
        'card',v_card,
        'cash',v_cash
      );
    end if;
    raise exception 'PAYMENT_METHODS_VERSION_CONFLICT' using errcode='40001';
  end if;

  insert into public.merchant_payment_methods(
    merchant_id,payment_method,active,confirmed_at,updated_at
  )
  values
    (p_merchant_id,'pix',coalesce(p_pix,false),v_now,v_now),
    (p_merchant_id,'card',coalesce(p_card,false),v_now,v_now),
    (p_merchant_id,'cash',coalesce(p_cash,false),v_now,v_now)
  on conflict(merchant_id,payment_method)
  do update set
    active=excluded.active,
    confirmed_at=excluded.confirmed_at,
    updated_at=excluded.updated_at;

  update public.merchants
  set last_seen_at=v_now
  where id=p_merchant_id;

  return jsonb_build_object(
    'ok',true,
    'alreadyApplied',false,
    'updatedAt',v_now,
    'pix',coalesce(p_pix,false),
    'card',coalesce(p_card,false),
    'cash',coalesce(p_cash,false)
  );
end;
$$;

revoke all on function public.merchant_update_payment_methods_cas(
  uuid,timestamptz,boolean,boolean,boolean,timestamptz
) from public, anon, authenticated;

grant execute on function public.merchant_update_payment_methods_cas(
  uuid,timestamptz,boolean,boolean,boolean,timestamptz
) to service_role;
