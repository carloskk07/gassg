-- V1.286 follow-on: queue only to identities with explicit active push consent.
-- This prevents unbounded pending intents before the sender is configured.
create or replace function public.merchant_push_queue_order_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $body$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.status = 'OFFERED_TO_MERCHANT'
     and new.proposed_merchant_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status
       or old.proposed_merchant_id is distinct from new.proposed_merchant_id)
     and (new.offer_expires_at is null or new.offer_expires_at > v_now) then
    insert into public.merchant_push_outbox(
      event_key,order_id,merchant_id,user_id,event_kind,expires_at)
    select new.id::text||':offer:'||new.version::text||':'||mm.user_id::text,
      new.id, new.proposed_merchant_id, mm.user_id,'new_offer',
      least(coalesce(new.offer_expires_at,v_now+interval '5 minutes'),v_now+interval '5 minutes')
    from public.merchant_members mm
    where mm.merchant_id=new.proposed_merchant_id and mm.active
      and mm.member_role in ('owner','manager','operator')
      and exists (
        select 1 from public.merchant_push_subscriptions sub
        where sub.merchant_id=mm.merchant_id and sub.user_id=mm.user_id
          and sub.active and sub.revoked_at is null
      )
    on conflict (event_key) do nothing;
  end if;
  if new.assigned_delivery_user_id is not null
     and new.merchant_id is not null
     and new.status in ('PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING')
     and (tg_op = 'INSERT' or old.assigned_delivery_user_id is distinct from new.assigned_delivery_user_id) then
    insert into public.merchant_push_outbox(
      event_key,order_id,merchant_id,user_id,event_kind,expires_at)
    select new.id::text||':delivery:'||new.version::text||':'||mm.user_id::text,
      new.id,new.merchant_id,mm.user_id,'assigned_delivery',v_now+interval '30 minutes'
    from public.merchant_members mm
    where mm.merchant_id=new.merchant_id and mm.user_id=new.assigned_delivery_user_id
      and mm.active and mm.member_role='driver'
      and exists (
        select 1 from public.merchant_push_subscriptions sub
        where sub.merchant_id=mm.merchant_id and sub.user_id=mm.user_id
          and sub.active and sub.revoked_at is null
      )
    on conflict (event_key) do nothing;
  end if;
  return new;
end
$body$;

revoke all on function public.merchant_push_queue_order_change() from public,anon,authenticated;
