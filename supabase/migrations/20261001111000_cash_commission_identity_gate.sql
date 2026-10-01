-- Chama São Gabriel — cash commission identity gate v1.6.2
-- Pending referral commission may be attributed to an anonymous user,
-- but it only becomes withdrawable after that same user_id is converted
-- to a permanent Supabase identity.

create or replace function public.process_reward_maturation()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.order_reward_grants%rowtype;
  v_count integer:=0;
  v_key text;
begin
  for v_row in
    select g.*
    from public.order_reward_grants g
    join public.orders o on o.id=g.order_id
    join auth.users u on u.id=g.referrer_user_id
    where g.referral_pending_cents>0
      and u.is_anonymous is false
      and g.matured_at is null
      and g.commission_available_at<=clock_timestamp()
      and o.status='SETTLED'
    order by g.commission_available_at
    for update of g skip locked
    limit 100
  loop
    v_key:='reward:'||replace(v_row.order_id::text,'-','');

    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values
      (
        v_row.referrer_user_id,v_row.order_id,'commission_pending',
        'referral_pending_release',-v_row.referral_pending_cents,
        v_key||':referral-pending-release',
        jsonb_build_object('maturedAt',clock_timestamp())
      ),
      (
        v_row.referrer_user_id,v_row.order_id,'commission_available',
        'referral_available',v_row.referral_pending_cents,
        v_key||':referral-available',
        jsonb_build_object('maturedAt',clock_timestamp())
      )
    on conflict(idempotency_key) do nothing;

    update public.order_reward_grants
    set matured_at=clock_timestamp()
    where order_id=v_row.order_id
      and matured_at is null;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_row.order_id,null,'system','COMMISSION_AVAILABLE',
      'Comissão liberada',
      'A janela de validação terminou e a comissão elegível ficou disponível.',
      jsonb_build_object('amountCents',v_row.referral_pending_cents)
    );

    v_count:=v_count+1;
  end loop;

  return jsonb_build_object('maturedCommissions',v_count);
end;
$$;

revoke all on function public.process_reward_maturation()
from public, anon, authenticated;
grant execute on function public.process_reward_maturation()
to postgres, service_role;
