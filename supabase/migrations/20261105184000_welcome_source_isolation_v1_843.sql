-- TAMÃO #843 — isolar o credito de boas-vindas das reservas genericas
-- Mantem todos os direitos e ressarcimentos legados. Nao cria compra,
-- cashback, comissao, voucher ou contrato automaticamente.
-- O cliente que marcou cashback continua podendo gastar cashback regular,
-- mas a campanha universal somente pode ser consumida no fluxo especial.

CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_payment_method text, p_use_cashback boolean, p_idempotency_key text, p_request_hash text, p_referral_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_action public.action_requests%rowtype;
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_order_id uuid;
  v_public_code text;
  v_cashback_balance bigint := 0;
  v_reserved integer := 0;
  v_total integer := 0;
  v_offer_expires_at timestamptz;
  v_result jsonb;
  v_referrer uuid;
  v_prior_order_count integer:=0;
  v_product_codes text[];
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_payment_method not in ('pix','card','cash') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'create-order',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_user_id or v_action.action_name<>'create-order' or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    if v_action.result_json is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return v_action.result_json;
  end if;

  select * into v_quote
  from public.quotes
  where id=p_quote_id and customer_id=p_user_id
  for update;

  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if v_quote.consumed_at is not null then raise exception 'QUOTE_ALREADY_USED' using errcode='23505'; end if;
  if v_quote.expires_at<=clock_timestamp() then raise exception 'QUOTE_EXPIRED' using errcode='22023'; end if;

  select * into v_merchant
  from public.merchants
  where id=v_quote.merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if not public.merchant_cnpj_compliance_current(v_quote.merchant_id) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  select array_agg(qi.product_code order by qi.product_code)
  into v_product_codes
  from public.quote_items qi
  where qi.quote_id=v_quote.id;

  if coalesce(cardinality(v_product_codes),0)<1
     or not public.merchant_basket_compliance_current(
       v_quote.merchant_id,v_product_codes
     )
     or not public.merchant_cart_delivery_compatible(
       v_quote.merchant_id,
       v_product_codes
     ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1
    from public.quote_items qi
    left join public.catalog_items ci
      on ci.merchant_id=v_quote.merchant_id and ci.product_code=qi.product_code
    where qi.quote_id=v_quote.id
      and (ci.merchant_id is null or not ci.active or ci.available_stock<qi.quantity)
  ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1 from public.orders
    where customer_id=p_user_id and status not in ('SETTLED','CANCELLED')
  ) then
    raise exception 'ACTIVE_ORDER_EXISTS' using errcode='23505';
  end if;

  select count(*)
  into v_prior_order_count
  from public.orders
  where customer_id=p_user_id;

  if p_referral_code is not null
     and char_length(trim(p_referral_code)) between 6 and 20
     and v_prior_order_count=0 then
    select user_id into v_referrer
    from public.profiles
    where referral_code=upper(trim(p_referral_code))
    limit 1;

    if v_referrer is not null and v_referrer<>p_user_id then
      insert into public.referrals(referred_user_id,referrer_user_id,referral_code)
      values(p_user_id,v_referrer,upper(trim(p_referral_code)))
      on conflict(referred_user_id) do nothing;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||p_user_id::text,0)
  );

  select (public.cashback_position(p_user_id)->>'spendableCents')::bigint
  into v_cashback_balance;

  -- #843: a concessao universal de R$ 1 pertence a um lote exclusivo.
  -- O checkout legado continua consumindo cashback regular, mas nunca usa
  -- silenciosamente o premio de boas-vindas como credito reembolsavel.
  -- A liberacao do premio em produtos exigira contrato e trilha separada.
  if p_use_cashback and exists(
       select 1 from public.platform_welcome_grants_v1_815 g
       where g.user_id=p_user_id) then
    select least(v_cashback_balance,coalesce(sum(l.remaining_cents),0))
    into v_cashback_balance
    from public.platform_cashback_source_lots_v1_261 l
    where l.user_id=p_user_id
      and not exists(select 1 from public.platform_welcome_grants_v1_815 g
         where g.wallet_entry_id=l.lot_id and g.user_id=p_user_id);
  end if;
  if p_use_cashback then
    v_reserved:=least(v_quote.gross_total_cents,v_cashback_balance)::integer;
  end if;

  v_total:=v_quote.gross_total_cents-v_reserved;
  v_order_id:=gen_random_uuid();
  v_public_code:='SG-'||upper(substr(replace(v_order_id::text,'-',''),1,12));
  v_offer_expires_at:=clock_timestamp()+interval '3 minutes';

  insert into public.orders(
    id,public_code,customer_id,merchant_id,status,address_text,payment_method,
    gross_total_cents,delivery_fee_cents_snapshot,cashback_reserved_cents,total_cents,pin_hash,
    attempted_merchant_ids,offer_expires_at
  ) values(
    v_order_id,v_public_code,p_user_id,v_quote.merchant_id,'OFFERED_TO_MERCHANT',
    v_quote.address_text,p_payment_method,v_quote.gross_total_cents,v_quote.delivery_fee_cents,v_reserved,v_total,
    null,array[v_quote.merchant_id],v_offer_expires_at
  );

  insert into public.order_items(
    order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select v_order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  from public.quote_items where quote_id=v_quote.id;

  if v_reserved>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    ) values(
      p_user_id,v_order_id,'cashback','cashback_reserve',-v_reserved,
      p_idempotency_key||':cashback-reserve',
      jsonb_build_object('quoteId',v_quote.id)
    );
  end if;

  insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
  values
    (v_order_id,p_user_id,'customer','CREATED','Pedido recebido','Pedido criado a partir de uma cotação válida.'),
    (v_order_id,p_user_id,'system','QUOTE_LOCKED','Preço protegido','Preço, itens e endereço foram congelados para este pedido.'),
    (v_order_id,p_user_id,'system','OFFERED_TO_MERCHANT','Aguardando confirmação da revenda','A revenda precisa aceitar antes de o pedido ser considerado confirmado.');

  update public.quotes set consumed_at=clock_timestamp() where id=v_quote.id;

  v_result:=jsonb_build_object(
    'orderId',v_order_id,'publicCode',v_public_code,'status','OFFERED_TO_MERCHANT',
    'grossTotalCents',v_quote.gross_total_cents,'cashbackReservedCents',v_reserved,
    'totalCents',v_total,'offerExpiresAt',v_offer_expires_at
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$


CREATE OR REPLACE FUNCTION platform_cashback_trace_private_v1_261.capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_need bigint;
 v_matched bigint:=0;
 v_take bigint;
 v_lot record;
begin
 if new.bucket<>'cashback' or new.entry_type not in (
  'cashback_seed','cashback_earn','cashback_reserve','cashback_release','cashback_reversal'
 ) then return new;end if;

 -- The native wallet remains authoritative. Capture is best-effort and MUST
 -- NEVER cause an existing order or reward to fail on tracing discrepancies.
 -- A missing trace event is surfaced separately in the read-only Admin report.
 begin
  perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('cashback-source-trace-v1_261:'||new.user_id::text,0));
  if exists(select 1 from public.platform_cashback_trace_events_v1_261 t
   where t.wallet_entry_id=new.id) then return new;end if;

  v_need:=abs(new.amount_cents)::bigint;
  insert into public.platform_cashback_trace_events_v1_261(
    wallet_entry_id,user_id,entry_type,amount_cents,matched_cents,created_at)
  values(new.id,new.user_id,new.entry_type,v_need,0,new.created_at);

  if new.entry_type in ('cashback_seed','cashback_earn') then
    insert into public.platform_cashback_source_lots_v1_261(
     lot_id,user_id,source_type,issued_cents,remaining_cents,issued_at)
    values(new.id,new.user_id,new.entry_type,v_need,v_need,new.created_at);
    v_matched:=v_need;
  elsif new.entry_type='cashback_reserve' then
    for v_lot in
      select lot_id,remaining_cents
      from public.platform_cashback_source_lots_v1_261 l
      where l.user_id=new.user_id and l.remaining_cents>0
        -- Reserva identificada de produtos/corridas precisa usar o lote exato.
        -- Reserva comum de compras jamais pode capturar o credito exclusivo
        -- da campanha de boas-vindas: ele nao e cashback reembolsavel.
        and (
          (new.metadata ? 'welcomeLotId' and
            l.lot_id=(new.metadata->>'welcomeLotId')::uuid)
          or (not (new.metadata ? 'welcomeLotId') and
             (new.order_id is null or not exists(
                select 1 from public.platform_welcome_grants_v1_815 wg
                where wg.wallet_entry_id=l.lot_id and wg.user_id=new.user_id)))
        )
      order by l.issued_at,l.lot_id for update of l
    loop
      exit when v_matched>=v_need;
      v_take:=least(v_need-v_matched,v_lot.remaining_cents);
      update public.platform_cashback_source_lots_v1_261
       set remaining_cents=remaining_cents-v_take where lot_id=v_lot.lot_id;
      insert into public.platform_cashback_trace_flows_v1_261(
        wallet_entry_id,lot_id,direction,amount_cents)
       values(new.id,v_lot.lot_id,'reserve',v_take);
      v_matched:=v_matched+v_take;
    end loop;
  elsif new.entry_type='cashback_release' then
    -- Return each lot associated with THIS order's earlier reservations.
    -- Partial re-releases never restore more than was reserved.
    for v_lot in
      select f.lot_id,
       sum(f.amount_cents)::bigint-
       coalesce((
         select sum(rr.amount_cents)::bigint
         from public.platform_cashback_trace_flows_v1_261 rr
         join public.wallet_entries er on er.id=rr.wallet_entry_id
         where rr.lot_id=f.lot_id and rr.direction='release'
          and ((new.mobility_request_id is not null and
               er.mobility_request_id=new.mobility_request_id)
            or (new.mobility_request_id is null and
               er.order_id=new.order_id))
       ),0)::bigint as refundable
      from public.platform_cashback_trace_flows_v1_261 f
      join public.wallet_entries e on e.id=f.wallet_entry_id
      where e.user_id=new.user_id
        and ((new.mobility_request_id is not null and
              e.mobility_request_id=new.mobility_request_id)
          or (new.mobility_request_id is null and
              e.order_id=new.order_id))
       and f.direction='reserve'
      group by f.lot_id
      order by f.lot_id
    loop
      exit when v_matched>=v_need;
      v_take:=least(v_need-v_matched,greatest(v_lot.refundable,0));
      if v_take>0 then
        update public.platform_cashback_source_lots_v1_261
         set remaining_cents=remaining_cents+v_take where lot_id=v_lot.lot_id;
        insert into public.platform_cashback_trace_flows_v1_261(
         wallet_entry_id,lot_id,direction,amount_cents)
        values(new.id,v_lot.lot_id,'release',v_take);
        v_matched:=v_matched+v_take;
      end if;
    end loop;
  elsif new.entry_type='cashback_reversal' then
    -- Claw back only the remaining issued lot(s) from the original order.
    -- Already-used funds cannot be "unspent" by inventing a negative lot.
    for v_lot in
      select l.lot_id,l.remaining_cents
      from public.platform_cashback_source_lots_v1_261 l
      join public.wallet_entries e on e.id=l.lot_id
      where l.user_id=new.user_id and e.order_id=new.order_id
       and l.source_type='cashback_earn' and l.remaining_cents>0
      order by l.issued_at,l.lot_id for update of l
    loop
      exit when v_matched>=v_need;
      v_take:=least(v_need-v_matched,v_lot.remaining_cents);
      update public.platform_cashback_source_lots_v1_261
        set remaining_cents=remaining_cents-v_take where lot_id=v_lot.lot_id;
      insert into public.platform_cashback_trace_flows_v1_261(
       wallet_entry_id,lot_id,direction,amount_cents)
       values(new.id,v_lot.lot_id,'reverse',v_take);
      v_matched:=v_matched+v_take;
    end loop;
  end if;
  update public.platform_cashback_trace_events_v1_261
   set matched_cents=v_matched where wallet_entry_id=new.id;
 exception when others then
   -- Roll back the auxiliary trace subtransaction. Native INSERT still commits;
   -- no false "matched" record is retained. Admin detects absent trace entries.
   return new;
 end;
 return new;
end;$function$;
