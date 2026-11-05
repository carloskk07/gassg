-- #823/#833 — R$1 universal, resgatado UMA vez na corrida, financiado pelo motorista.
-- Reusa wallet_entries e o rastreamento por origem, NAO cria outra carteira.
-- O desconto somente ocorre quando motorista aceitou termos v2 e o
-- passageiro tem saldo de premio rastreavel e livre de outras reservas.

alter table public.wallet_entries
 add column mobility_request_id uuid
 references public.mobility_requests(id) on delete restrict;
create index wallet_entries_mobility_v1_833_idx
 on public.wallet_entries(mobility_request_id)
 where mobility_request_id is not null;

alter table public.wallet_entries
 drop constraint wallet_entries_order_provenance_check;
alter table public.wallet_entries
 add constraint wallet_entries_order_provenance_check
 check (
   (entry_type='cashback_seed' and mobility_request_id is null)
   or (order_id is not null and mobility_request_id is null)
   or (order_id is null and mobility_request_id is not null
       and entry_type in ('cashback_reserve','cashback_release'))
 );

create table public.mobility_welcome_uses_v1_833(
 request_id uuid primary key references public.mobility_requests(id) on delete restrict,
 rider_id uuid not null references auth.users(id) on delete restrict,
 driver_id uuid not null references auth.users(id) on delete restrict,
 grant_lot_id uuid not null references public.wallet_entries(id) on delete restrict,
 amount_cents integer not null default 100 check(amount_cents=100),
 status text not null default 'reserved' check(status in ('reserved','spent','released')),
 reserved_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 released_at timestamptz,
 check ((status='reserved' and completed_at is null and released_at is null)
  or (status='spent' and completed_at is not null and released_at is null)
  or (status='released' and released_at is not null and completed_at is null))
);
create unique index mobility_welcome_one_spend_v1_833_idx
 on public.mobility_welcome_uses_v1_833(rider_id)
 where status in ('reserved','spent');
create index mobility_welcome_driver_v1_833_idx
 on public.mobility_welcome_uses_v1_833(driver_id);
alter table public.mobility_welcome_uses_v1_833 enable row level security;
revoke all on public.mobility_welcome_uses_v1_833 from public,anon,authenticated;

-- Modulo interno: nao disponivel ao browser. Usa o mesmo saldo canônico
-- e o lote individual exato emitido no inicio da campanha.
create or replace function public.mobility_welcome_eligible_v1_833(
 p_rider uuid,p_driver uuid,p_fare_cents integer
) returns boolean language sql stable security definer
set search_path=pg_catalog
as $$
 select p_rider=(select auth.uid())
  and p_fare_cents between 100 and 10000000
  and exists(
   select 1 from public.mobility_benefits_participation_v1_826 b
   where b.driver_id=p_driver and b.opted_in and b.terms_version=2
  )
  and exists(
   select 1 from public.platform_welcome_grants_v1_815 g
   join public.platform_cashback_source_lots_v1_261 s
    on s.lot_id=g.wallet_entry_id and s.user_id=g.user_id
   where g.user_id=p_rider and g.amount_cents>=100
    and s.remaining_cents>=100
  )
  and not exists(
    select 1 from public.mobility_welcome_uses_v1_833 u
    where u.rider_id=p_rider and u.status in ('reserved','spent')
  )
  and (public.cashback_position(p_rider)->>'spendableCents')::bigint>=100;
$$;
revoke all on function public.mobility_welcome_eligible_v1_833(uuid,uuid,integer)
 from public,anon,authenticated;

-- Atualiza captura FIFO mantendo contratos antigos de compras.
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
      from public.platform_cashback_source_lots_v1_261
      where user_id=new.user_id and remaining_cents>0
        -- Quando a origem e uma corrida com cupom de boas-vindas, consumir
        -- EXATAMENTE o lote daquele premio, nunca outro cashback.
        and (new.mobility_request_id is null
          or lot_id=(new.metadata->>'welcomeLotId')::uuid)
      order by issued_at,lot_id for update
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

-- Aceite do valor efetua a reserva atomica do premio, se elegivel.
CREATE OR REPLACE FUNCTION public.mobility_fare_accept_v1_826(p_request_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_user uuid:=(select auth.uid());
 v_request public.mobility_requests%rowtype;
 v_quote public.mobility_fare_quotes_v1_826%rowtype;
 v_grant uuid;
 v_wallet uuid;
begin
 if v_user is null or not public.discovery_verified_account() then
  raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';
 end if;
 select * into v_request from public.mobility_requests
 where id=p_request_id for update;
 if not found or v_request.rider_id<>v_user then
  raise exception 'MOBILITY_FARE_FORBIDDEN' using errcode='42501';
 end if;
 if v_request.status<>'accepted' or v_request.expires_at<=clock_timestamp() then
  raise exception 'MOBILITY_FARE_STATUS_INVALID' using errcode='40001';
 end if;
 select * into v_quote from public.mobility_fare_quotes_v1_826
 where request_id=p_request_id for update;
 if not found or v_quote.driver_id<>v_request.driver_id
  or v_quote.rider_id<>v_user then
  raise exception 'MOBILITY_FARE_NOT_PROPOSED' using errcode='P0002';
 end if;
 if p_version is distinct from v_quote.quote_version then
  raise exception 'MOBILITY_FARE_CHANGED_REVIEW_REQUIRED' using errcode='40001';
 end if;
 if v_quote.rider_accepted_at is null then
  -- Mesma serializacao usada pelo checkout de produtos.
  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||v_user::text,0));
  if public.mobility_welcome_eligible_v1_833(
       v_user,v_request.driver_id,v_quote.fare_cents) then
    select g.wallet_entry_id into v_grant
    from public.platform_welcome_grants_v1_815 g
    where g.user_id=v_user;
    insert into public.mobility_welcome_uses_v1_833(
      request_id,rider_id,driver_id,grant_lot_id,amount_cents,status)
    values (p_request_id,v_user,v_request.driver_id,v_grant,100,'reserved');
    insert into public.wallet_entries(
      user_id,order_id,mobility_request_id,bucket,entry_type,
      amount_cents,idempotency_key,metadata)
    values(v_user,null,p_request_id,'cashback','cashback_reserve',
      -100,'mobility:welcome:reserve:'||p_request_id::text,
      jsonb_build_object('source','welcome_partner_funded',
        'welcomeLotId',v_grant::text,'termsVersion',2))
    returning id into v_wallet;
    -- O extrato e reconciliacao exigem PROVA de que o lote correto
    -- perdeu R$1. Se o rastreamento falhar, rollback completo.
    if not exists(
      select 1
      from public.platform_cashback_trace_events_v1_261 e
      join public.platform_cashback_trace_flows_v1_261 f
        on f.wallet_entry_id=e.wallet_entry_id
      where e.wallet_entry_id=v_wallet and e.matched_cents=100
        and f.lot_id=v_grant and f.direction='reserve'
        and f.amount_cents=100
    ) then
      raise exception 'MOBILITY_WELCOME_RESERVE_UNRECONCILED'
        using errcode='40001';
    end if;
  end if;
  update public.mobility_fare_quotes_v1_826
  set rider_accepted_at=clock_timestamp()
  where request_id=p_request_id returning * into v_quote;
 end if;
 return jsonb_build_object('requestId',v_quote.request_id,
  'fareCents',v_quote.fare_cents,'version',v_quote.quote_version,
  'accepted',true);
end;
$function$;

-- Conclusao consome a reserva, cancelamento/expiracao devolve o MESMO lote.
-- Falhas na prova de rastreabilidade abortam toda a alteracao de estado.
create or replace function public.mobility_welcome_settle_v1_833()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_use public.mobility_welcome_uses_v1_833%rowtype;
 v_wallet uuid;
begin
 if new.status is not distinct from old.status
    or new.status not in ('completed','cancelled','expired','rejected')
 then return new;end if;
 select * into v_use from public.mobility_welcome_uses_v1_833
 where request_id=new.id for update;
 if not found or v_use.status<>'reserved' then return new;end if;
 if v_use.rider_id<>new.rider_id or v_use.driver_id<>new.driver_id then
  raise exception 'MOBILITY_WELCOME_PARTICIPANT_CHANGED' using errcode='42501';
 end if;
 if new.status='completed' then
  update public.mobility_welcome_uses_v1_833
  set status='spent',completed_at=clock_timestamp()
  where request_id=new.id and status='reserved';
 else
  perform pg_advisory_xact_lock(
   hashtextextended('cashback-user:'||v_use.rider_id::text,0));
  insert into public.wallet_entries(
    user_id,order_id,mobility_request_id,bucket,entry_type,
    amount_cents,idempotency_key,metadata)
  values(v_use.rider_id,null,new.id,'cashback','cashback_release',
    v_use.amount_cents,'mobility:welcome:release:'||new.id::text,
    jsonb_build_object('source','welcome_partner_funded_cancelled',
      'welcomeLotId',v_use.grant_lot_id::text,
      'termsVersion',2))
  returning id into v_wallet;
  if not exists(
   select 1 from public.platform_cashback_trace_events_v1_261 e
   join public.platform_cashback_trace_flows_v1_261 f
     on f.wallet_entry_id=e.wallet_entry_id
   where e.wallet_entry_id=v_wallet
    and e.matched_cents=v_use.amount_cents
    and f.lot_id=v_use.grant_lot_id and f.direction='release'
    and f.amount_cents=v_use.amount_cents
  ) then
   raise exception 'MOBILITY_WELCOME_RELEASE_UNRECONCILED'
     using errcode='40001';
  end if;
  update public.mobility_welcome_uses_v1_833
  set status='released',released_at=clock_timestamp()
  where request_id=new.id and status='reserved';
 end if;
 return new;
end;
$$;
revoke all on function public.mobility_welcome_settle_v1_833() from public,anon,authenticated;
create trigger mobility_welcome_settle_v1_833_trg
after update of status on public.mobility_requests
for each row execute function public.mobility_welcome_settle_v1_833();
