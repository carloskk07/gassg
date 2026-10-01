-- Server-side watchdog: works even when no browser is open.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.system_reassign_expired_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_candidate_id uuid;
  v_candidate_gross integer;
  v_new_reserved integer;
  v_release_diff integer;
  v_key text;
  v_result jsonb;
begin
  select * into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason','ORDER_NOT_FOUND'); end if;

  if v_order.status<>'OFFERED_TO_MERCHANT'
     or v_order.offer_expires_at is null
     or v_order.offer_expires_at>clock_timestamp() then
    return jsonb_build_object('ok',false,'reason','NOT_EXPIRED');
  end if;

  v_key:='system-timeout:'||replace(v_order.id::text,'-','')||':'||v_order.version::text;

  insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
  values(
    v_order.id,null,'system','OFFER_TIMEOUT','Revenda não respondeu',
    'O prazo de confirmação expirou e o sistema iniciou resgate automático.'
  );

  select m.id,(sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents)::integer
  into v_candidate_id,v_candidate_gross
  from public.merchants m
  join public.order_items oi on oi.order_id=v_order.id
  join public.catalog_items ci
    on ci.merchant_id=m.id and ci.product_code=oi.product_code
   and ci.active and ci.available_stock>=oi.quantity
  where m.status='active' and m.online and m.accepts_citywide
    and m.last_seen_at>=clock_timestamp()-interval '10 minutes'
    and m.price_confirmed_at>=clock_timestamp()-interval '24 hours'
    and not (m.id=any(v_order.attempted_merchant_ids))
  group by m.id,m.delivery_fee_cents,m.base_eta_minutes,m.trust_score
  having count(*)=(select count(*) from public.order_items where order_id=v_order.id)
  order by
    (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents) asc,
    m.base_eta_minutes asc,m.trust_score desc
  limit 1;

  if v_candidate_id is null then
    update public.orders
    set status='CANCELLED',version=version+1,updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      ) values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,v_key||':cashback-release',
        jsonb_build_object('reason','offer_timeout_no_alternative')
      )
      on conflict(idempotency_key) do nothing;
    end if;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(
      v_order.id,null,'system','CANCELLED','Pedido cancelado',
      'Nenhuma outra revenda elegível conseguiu atender a cesta após o timeout.'
    );

    return jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status','CANCELLED','version',v_order.version
    );
  end if;

  v_new_reserved:=least(v_order.cashback_reserved_cents,v_candidate_gross);
  v_release_diff:=v_order.cashback_reserved_cents-v_new_reserved;

  if v_release_diff>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    ) values(
      v_order.customer_id,v_order.id,'cashback','cashback_release',
      v_release_diff,v_key||':cashback-rebalance',
      jsonb_build_object('reason','offer_timeout_cheaper_reassignment')
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if v_candidate_gross<=v_order.gross_total_cents then
    update public.orders
    set merchant_id=v_candidate_id,
        supplier_name_snapshot=null,
        gross_total_cents=v_candidate_gross,
        cashback_reserved_cents=v_new_reserved,
        total_cents=v_candidate_gross-v_new_reserved,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        status='OFFERED_TO_MERCHANT',
        attempted_merchant_ids=array_append(attempted_merchant_ids,v_candidate_id),
        offer_expires_at=clock_timestamp()+interval '3 minutes',
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(
      v_order.id,null,'system','OFFERED_TO_MERCHANT','Nova revenda acionada',
      'Outra revenda recebeu o pedido automaticamente sem aumento de preço.'
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'totalCents',v_order.total_cents,'offerExpiresAt',v_order.offer_expires_at
    );
  else
    update public.orders
    set status='REQUOTE_REQUIRED',
        proposed_merchant_id=v_candidate_id,
        proposed_gross_total_cents=v_candidate_gross,
        proposed_total_cents=v_candidate_gross-v_new_reserved,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(
      v_order.id,null,'system','REQUOTE_REQUIRED','Nova confirmação necessária',
      'A alternativa automática possui preço diferente e precisa de aceite do cliente.'
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'proposedTotalCents',v_order.proposed_total_cents
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.system_reassign_expired_order(uuid)
from public, anon, authenticated;
grant execute on function public.system_reassign_expired_order(uuid)
to postgres, service_role;

create or replace function public.process_order_timeouts()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row record;
  v_offer_count integer:=0;
  v_risk_count integer:=0;
  v_eta_count integer:=0;
begin
  for v_row in
    select id from public.orders
    where status='OFFERED_TO_MERCHANT'
      and offer_expires_at is not null
      and offer_expires_at<=clock_timestamp()
    order by offer_expires_at
    limit 100
  loop
    perform public.system_reassign_expired_order(v_row.id);
    v_offer_count:=v_offer_count+1;
  end loop;

  for v_row in
    update public.orders
    set status='AT_RISK',risk_reason='Saída ainda não confirmada',
        version=version+1,updated_at=clock_timestamp()
    where status='PREPARING'
      and dispatch_due_at is not null
      and dispatch_due_at<=clock_timestamp()
    returning id
  loop
    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(
      v_row.id,null,'system','AT_RISK','Saída ainda não confirmada',
      'A janela de preparação terminou sem confirmação real de saída.'
    );
    v_risk_count:=v_risk_count+1;
  end loop;

  for v_row in
    update public.orders
    set risk_reason='Entrega fora da janela prevista',
        version=version+1,updated_at=clock_timestamp()
    where status in ('OUT_FOR_DELIVERY','ARRIVING')
      and promised_by is not null
      and promised_by<=clock_timestamp()
      and risk_reason is distinct from 'Entrega fora da janela prevista'
    returning id
  loop
    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(
      v_row.id,null,'system','ETA_RISK','Entrega fora da janela prevista',
      'O prazo máximo estimado foi ultrapassado; o pedido continua ativo e monitorado.'
    );
    v_eta_count:=v_eta_count+1;
  end loop;

  return jsonb_build_object(
    'expiredOffersProcessed',v_offer_count,
    'preparingRisked',v_risk_count,
    'etaRisked',v_eta_count
  );
end;
$$;

revoke all on function public.process_order_timeouts()
from public, anon, authenticated;
grant execute on function public.process_order_timeouts()
to postgres, service_role;

select cron.schedule(
  'chama-order-watchdog',
  '* * * * *',
  $$select public.process_order_timeouts();$$
);
