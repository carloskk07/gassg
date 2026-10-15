-- V1.287 corrective migration: SQL output parameter subscription_id must not
-- shadow the INSERT/ON CONFLICT column in merchant_push_claim_due.
create or replace function public.merchant_push_claim_due(p_limit integer default 8)
returns table(
  delivery_id bigint, lease_token uuid, subscription_id bigint,
  event_kind text, endpoint_url text, p256dh text, auth_secret text,
  expires_at timestamptz, order_id uuid
)
language plpgsql security definer set search_path='pg_catalog' as $fn$
#variable_conflict use_column
declare
  v_now timestamptz:=clock_timestamp();
  v_limit integer:=least(greatest(coalesce(p_limit,8),1),8);
begin
  -- Purely administrative expiry. No user-supplied order mutation.
  update public.merchant_push_outbox ob set provider_status='expired'
  where ob.provider_status in ('pending','retry') and ob.expires_at<=v_now;

  insert into public.merchant_push_deliveries(outbox_id,subscription_id)
  select ob.id,sub.id
  from public.merchant_push_outbox ob
  join public.merchant_push_subscriptions sub
    on sub.merchant_id=ob.merchant_id and sub.user_id=ob.user_id
    and sub.active and sub.revoked_at is null and sub.registered_at<=ob.created_at
  join public.merchant_members mm
    on mm.merchant_id=ob.merchant_id and mm.user_id=ob.user_id and mm.active
  join public.orders o on o.id=ob.order_id
  where ob.provider_status in ('pending','retry') and ob.expires_at>v_now
    and (
      (ob.event_kind='new_offer' and mm.member_role in ('owner','manager','operator')
       and o.status='OFFERED_TO_MERCHANT'
       and o.proposed_merchant_id=ob.merchant_id
       and o.offer_expires_at>v_now)
      or
      (ob.event_kind='assigned_delivery' and mm.member_role='driver'
       and o.merchant_id=ob.merchant_id
       and o.assigned_delivery_user_id=ob.user_id
       and o.status in ('PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'))
    )
  on conflict(outbox_id,subscription_id) do nothing;

  update public.merchant_push_deliveries d set status='expired',
    leased_until=null,lease_token=null
  from public.merchant_push_outbox ob
  where d.outbox_id=ob.id and d.status in ('pending','retry','leased')
    and ob.expires_at<=v_now;

  -- Claim only rows that are still authorized NOW. A revoked subscription,
  -- role change or order transition prevents all subsequent attempts.
  return query
  with due as (
    select d.id
    from public.merchant_push_deliveries d
    join public.merchant_push_outbox ob on ob.id=d.outbox_id
    join public.merchant_push_subscriptions sub on sub.id=d.subscription_id
      and sub.merchant_id=ob.merchant_id and sub.user_id=ob.user_id
      and sub.active and sub.revoked_at is null
    join public.merchant_members mm on mm.merchant_id=ob.merchant_id
      and mm.user_id=ob.user_id and mm.active
    join public.orders o on o.id=ob.order_id
    where ((d.status in ('pending','retry') and d.next_attempt_at<=v_now)
      or(d.status='leased' and d.leased_until<=v_now))
      and d.attempts<8 and ob.expires_at>v_now
      and ob.provider_status in ('pending','retry')
      and (
        (ob.event_kind='new_offer' and mm.member_role in ('owner','manager','operator')
          and o.status='OFFERED_TO_MERCHANT' and o.proposed_merchant_id=ob.merchant_id
          and o.offer_expires_at>v_now)
        or (ob.event_kind='assigned_delivery' and mm.member_role='driver'
          and o.merchant_id=ob.merchant_id and o.assigned_delivery_user_id=ob.user_id
          and o.status in ('PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'))
      )
    order by d.next_attempt_at,d.id
    for update of d skip locked limit v_limit
  ), claimed as (
    update public.merchant_push_deliveries d
    set status='leased',attempts=d.attempts+1,
      last_attempt_at=v_now,
      leased_until=v_now+interval '45 seconds',
      lease_token=gen_random_uuid()
    from due where d.id=due.id
    returning d.id,d.outbox_id,d.subscription_id,d.lease_token
  )
  select c.id,c.lease_token,c.subscription_id,ob.event_kind,
     sub.endpoint_url,sub.p256dh,sub.auth_secret,ob.expires_at,ob.order_id
  from claimed c
  join public.merchant_push_outbox ob on ob.id=c.outbox_id
  join public.merchant_push_subscriptions sub on sub.id=c.subscription_id;
end $fn$;


revoke all on function public.merchant_push_claim_due(integer) from public,anon,authenticated;
grant execute on function public.merchant_push_claim_due(integer) to service_role;
