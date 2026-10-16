-- TAMÃO V1.333 — eligible-only referral commission maturation queue.
-- Avoid starvation when >100 older grants are blocked by risk review,
-- missing permanent identity or an ineligible financial state.
-- Row/advisory locks and inside-loop checks remain unchanged as a second gate.
CREATE OR REPLACE FUNCTION public.process_reward_maturation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_review public.referral_reward_reviews%rowtype;
  v_referrer_is_anonymous boolean;
  v_referred_is_anonymous boolean;
  v_count integer:=0;
  v_key text;
begin
  for v_order_id in
    select g.order_id
    from public.order_reward_grants g
    join public.orders o on o.id=g.order_id
    join public.referral_reward_reviews r on r.order_id=g.order_id
    join auth.users referrer on referrer.id=g.referrer_user_id
    join auth.users referred on referred.id=g.customer_id
    where g.referral_pending_cents>0
      and g.matured_at is null
      and g.reversed_at is null
      and g.commission_available_at<=clock_timestamp()
      and o.status='SETTLED'
      and o.financial_state='settled'
      and o.financial_reversed_at is null
      and r.risk_status in ('clear','approved')
      and referrer.is_anonymous is not true
      and referred.is_anonymous is not true
    order by g.commission_available_at,g.order_id
    limit 100
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('reward:'||v_order_id::text,0)
    );

    select *
    into v_order
    from public.orders
    where id=v_order_id
    for update;

    if not found
       or v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled' then
      continue;
    end if;

    select *
    into v_grant
    from public.order_reward_grants
    where order_id=v_order_id
    for update;

    if not found
       or v_grant.referral_pending_cents<=0
       or v_grant.matured_at is not null
       or v_grant.reversed_at is not null
       or v_grant.commission_available_at>clock_timestamp()
       or v_grant.referrer_user_id is null then
      continue;
    end if;

    select *
    into v_review
    from public.referral_reward_reviews
    where order_id=v_grant.order_id
    for update;

    if not found
       or v_review.risk_status not in ('clear','approved') then
      continue;
    end if;

    select u.is_anonymous
    into v_referrer_is_anonymous
    from auth.users u
    where u.id=v_grant.referrer_user_id;

    if not found or v_referrer_is_anonymous is true then
      continue;
    end if;

    select u.is_anonymous
    into v_referred_is_anonymous
    from auth.users u
    where u.id=v_grant.customer_id;

    if not found or v_referred_is_anonymous is true then
      continue;
    end if;

    v_key:='reward:'||replace(v_grant.order_id::text,'-','');

    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values
      (
        v_grant.referrer_user_id,v_grant.order_id,'commission_pending',
        'referral_pending_release',-v_grant.referral_pending_cents,
        v_key||':referral-pending-release',
        jsonb_build_object('maturedAt',clock_timestamp())
      ),
      (
        v_grant.referrer_user_id,v_grant.order_id,'commission_available',
        'referral_available',v_grant.referral_pending_cents,
        v_key||':referral-available',
        jsonb_build_object('maturedAt',clock_timestamp())
      )
    on conflict(idempotency_key) do nothing;

    update public.order_reward_grants
    set matured_at=clock_timestamp()
    where order_id=v_grant.order_id
      and matured_at is null
      and reversed_at is null;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_grant.order_id,null,'system','COMMISSION_AVAILABLE',
      'Comissão liberada',
      'A janela de validação terminou, as identidades foram verificadas e a comissão ficou disponível.',
      jsonb_build_object('amountCents',v_grant.referral_pending_cents)
    );

    v_count:=v_count+1;
  end loop;

  return jsonb_build_object('maturedCommissions',v_count);
end;
$function$

