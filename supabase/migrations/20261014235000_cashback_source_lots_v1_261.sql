-- TAMÃO V1.261 — forward-only, auxiliary FIFO accounting for NEW cashback entries.
-- Neither updates native wallet_entries nor changes spending or settlement rules.
-- Allocation is a declared FIFO bookkeeping convention, not proof of funding bank transfer.
create schema if not exists platform_cashback_trace_private_v1_261;
revoke all on schema platform_cashback_trace_private_v1_261 from public,anon,authenticated;
grant usage on schema platform_cashback_trace_private_v1_261 to service_role;

create table public.platform_cashback_source_lots_v1_261(
 lot_id uuid primary key references public.wallet_entries(id) on delete cascade,
 user_id uuid not null,
 source_type text not null check(source_type in ('cashback_seed','cashback_earn')),
 issued_cents bigint not null check(issued_cents>0),
 remaining_cents bigint not null check(remaining_cents between 0 and issued_cents),
 issued_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create index cashback_source_lots_fifo_v1_261
 on public.platform_cashback_source_lots_v1_261(user_id,issued_at,lot_id)
 where remaining_cents>0;

create table public.platform_cashback_trace_events_v1_261(
 wallet_entry_id uuid primary key references public.wallet_entries(id) on delete cascade,
 user_id uuid not null,
 entry_type text not null check(entry_type in (
  'cashback_seed','cashback_earn','cashback_reserve','cashback_release','cashback_reversal')),
 amount_cents bigint not null check(amount_cents>0),
 matched_cents bigint not null check(matched_cents>=0 and matched_cents<=amount_cents),
 unmatched_cents bigint generated always as (amount_cents-matched_cents) stored,
 created_at timestamptz not null
);
create index cashback_trace_event_user_month_v1_261
 on public.platform_cashback_trace_events_v1_261(user_id,created_at);

create table public.platform_cashback_trace_flows_v1_261(
 wallet_entry_id uuid not null references public.platform_cashback_trace_events_v1_261(wallet_entry_id) on delete cascade,
 lot_id uuid not null references public.platform_cashback_source_lots_v1_261(lot_id) on delete cascade,
 direction text not null check(direction in ('reserve','release','reverse')),
 amount_cents bigint not null check(amount_cents>0),
 primary key(wallet_entry_id,lot_id,direction)
);
create index cashback_trace_flows_lot_v1_261
 on public.platform_cashback_trace_flows_v1_261(lot_id,direction);
alter table public.platform_cashback_source_lots_v1_261 enable row level security;
alter table public.platform_cashback_trace_events_v1_261 enable row level security;
alter table public.platform_cashback_trace_flows_v1_261 enable row level security;
revoke all on public.platform_cashback_source_lots_v1_261 from public,anon,authenticated,service_role;
revoke all on public.platform_cashback_trace_events_v1_261 from public,anon,authenticated,service_role;
revoke all on public.platform_cashback_trace_flows_v1_261 from public,anon,authenticated,service_role;

-- Append-only trace events and allocation links. The lot's remaining balance
-- is a derived accounting cursor and is updated only by the trigger function.
create or replace function platform_cashback_trace_private_v1_261.immutable()
returns trigger language plpgsql security definer
set search_path=pg_catalog as $guard$
begin
 raise exception 'CASHBACK_TRACE_IMMUTABLE' using errcode='42501';
end;$guard$;
create trigger cashback_trace_events_immutable_v1_261
 before update or delete on public.platform_cashback_trace_events_v1_261
 for each row execute function platform_cashback_trace_private_v1_261.immutable();
create trigger cashback_trace_flows_immutable_v1_261
 before update or delete on public.platform_cashback_trace_flows_v1_261
 for each row execute function platform_cashback_trace_private_v1_261.immutable();

create or replace function platform_cashback_trace_private_v1_261.capture()
returns trigger language plpgsql security definer set search_path=pg_catalog as $body$
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
          and er.order_id=new.order_id
       ),0)::bigint as refundable
      from public.platform_cashback_trace_flows_v1_261 f
      join public.wallet_entries e on e.id=f.wallet_entry_id
      where e.user_id=new.user_id and e.order_id=new.order_id
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
end;$body$;

-- Only the capture routine may finalize a trace event exactly once.
-- The immutable trigger above must allow the initial matched_cents transition.
create or replace function platform_cashback_trace_private_v1_261.immutable()
returns trigger language plpgsql security definer
set search_path=pg_catalog as $guard$
begin
 if tg_table_name='platform_cashback_trace_events_v1_261'
  and tg_op='UPDATE'
  and old.matched_cents=0 and new.matched_cents>=0
  and new.wallet_entry_id=old.wallet_entry_id
  and new.user_id=old.user_id and new.entry_type=old.entry_type
  and new.amount_cents=old.amount_cents and new.created_at=old.created_at
 then return new;end if;
 raise exception 'CASHBACK_TRACE_IMMUTABLE' using errcode='42501';
end;$guard$;

revoke all on function platform_cashback_trace_private_v1_261.capture()
 from public,anon,authenticated,service_role;
revoke all on function platform_cashback_trace_private_v1_261.immutable()
 from public,anon,authenticated,service_role;
create trigger cashback_trace_capture_v1_261
 after insert on public.wallet_entries for each row
 when (new.bucket='cashback')
 execute function platform_cashback_trace_private_v1_261.capture();

-- Read-only status. Untracked is NOT zero: absent/mismatched evidence is visible.
create or replace function platform_cashback_trace_private_v1_261.summary(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,date_trunc('month',
   clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_start timestamptz;v_end timestamptz;
 v_events jsonb;v_issued jsonb;v_settled jsonb;v_campaigns jsonb;v_campaign_count bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'OWNER_SOURCE_LOTS_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
       +interval '2 months')::date
 then raise exception 'OWNER_SOURCE_LOTS_MONTH_INVALID' using errcode='22023';end if;
 v_start:=v_month::timestamp at time zone 'America/Sao_Paulo';
 v_end:=(v_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

 select jsonb_build_object(
   'walletEntries',count(*)::bigint,
   'capturedEntries',count(t.wallet_entry_id)::bigint,
   'untrackedEntries',(count(*)-count(t.wallet_entry_id))::bigint,
   'partialEntries',count(*) filter(where t.matched_cents<t.amount_cents)::bigint,
   'matchedCents',coalesce(sum(t.matched_cents),0)::bigint,
   'unmatchedCents',coalesce(sum(t.unmatched_cents),0)::bigint
 ) into v_events
 from public.wallet_entries w
 left join public.platform_cashback_trace_events_v1_261 t on t.wallet_entry_id=w.id
 where w.bucket='cashback' and w.created_at>=v_start and w.created_at<v_end;

 select jsonb_build_object(
  'newLots',count(*)::bigint,
  'issuedCents',coalesce(sum(l.issued_cents),0)::bigint,
  'remainingCents',coalesce(sum(l.remaining_cents),0)::bigint,
  'seedIssuedCents',coalesce(sum(l.issued_cents) filter(
      where l.source_type='cashback_seed'),0)::bigint,
  'earnedIssuedCents',coalesce(sum(l.issued_cents) filter(
      where l.source_type='cashback_earn'),0)::bigint
 ) into v_issued
 from public.platform_cashback_source_lots_v1_261 l
 where l.issued_at>=v_start and l.issued_at<v_end;

 -- Count only exact reservation assignments for currently settled orders,
 -- never pending, cancelled, released or financially reversed purchases.
 with consumed as (
  select e.order_id,t.wallet_entry_id,t.amount_cents,t.matched_cents,
   o.settled_at
  from public.platform_cashback_trace_events_v1_261 t
  join public.wallet_entries e on e.id=t.wallet_entry_id
  join public.orders o on o.id=e.order_id
  where t.entry_type='cashback_reserve'
   and o.status='SETTLED' and o.financial_state='settled'
   and o.financial_reversed_at is null and o.payment_confirmed_at is not null
   and o.settled_at>=v_start and o.settled_at<v_end
   and not exists(select 1 from public.wallet_entries r
     where r.order_id=o.id and r.entry_type='cashback_release')
 )
 select jsonb_build_object(
  'settledAssignedCents',coalesce(sum(c.amount_cents) filter(
     where c.matched_cents=c.amount_cents),0)::bigint,
  'settledPartiallyAssignedCents',coalesce(sum(c.matched_cents) filter(
     where c.matched_cents<c.amount_cents),0)::bigint,
  'settledUnassignedCents',coalesce(sum(c.amount_cents-c.matched_cents) filter(
     where c.matched_cents<c.amount_cents),0)::bigint,
  'fullyAssignedOrders',count(*) filter(
     where c.matched_cents=c.amount_cents)::bigint,
  'partiallyAssignedOrders',count(*) filter(
     where c.matched_cents<c.amount_cents)::bigint
 ) into v_settled from consumed c;

 select count(*)::bigint into v_campaign_count from public.platform_owner_budget_allocations_v1_247
  where month_key=v_month;
 with selected as(
  select a.allocation_id,a.benefit_key,a.month_key,a.campaign_label,a.campaign_reference,a.created_at
  from public.platform_owner_budget_allocations_v1_247 a where a.month_key=v_month
  order by a.created_at desc,a.allocation_id limit 50
 ), issues as(
  select s.allocation_id,
    coalesce(sum(l.issued_cents),0)::bigint earned_issued,
    coalesce(sum(l.remaining_cents),0)::bigint earned_remaining
  from selected s
  left join public.platform_owner_campaign_order_attributions_v1_252 a on a.allocation_id=s.allocation_id
  left join public.platform_cashback_source_lots_v1_261 l on l.lot_id in (
    select w.id from public.wallet_entries w
    where w.order_id=a.order_id and w.entry_type='cashback_earn'
  )
  group by s.allocation_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'allocationId',s.allocation_id,
  'campaignTag','tam-'||s.benefit_key||'-'||to_char(s.month_key,'YYYYMM')||'-'||s.campaign_reference,
  'campaignLabel',s.campaign_label,
  'earnedIssuedCents',i.earned_issued,
  'earnedRemainingCents',i.earned_remaining
 )order by s.created_at desc,s.allocation_id),'[]'::jsonb) into v_campaigns
 from selected s join issues i on i.allocation_id=s.allocation_id;

 return jsonb_build_object(
 'source','admin_owner_cashback_source_lots_v1_261',
 'month',v_month,'timezone','America/Sao_Paulo',
 'captureMode','forward_only_after_wallet_insert',
 'lotAllocationMethod','fifo_bookkeeping_convention',
 'walletIsAuthoritative',true,'legacyBackfillPerformed',false,
 'events',v_events,'issuance',v_issued,'settledUse',v_settled,
 'totalCampaigns',v_campaign_count,'limit',50,'truncated',v_campaign_count>50,'rows',v_campaigns,
 'externalPayoutMeasured',false,'externalPaidBenefitsCents',null,
 'bankSettlementVerified',false,'profitMeasured',false,'roiMeasured',false,
 'noTransfers',true,'newBenefitsEnabled',false,'readOnly',true
 );
end;$fn$;
revoke all on function platform_cashback_trace_private_v1_261.summary(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_cashback_trace_private_v1_261.summary(uuid,date) to service_role;
create or replace function public.admin_owner_cashback_source_lots_v1_261(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_cashback_trace_private_v1_261.summary($1,$2)
$wrap$;
revoke all on function public.admin_owner_cashback_source_lots_v1_261(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_cashback_source_lots_v1_261(uuid,date) to service_role;
do $acl$begin
 if has_function_privilege('anon','public.admin_owner_cashback_source_lots_v1_261(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_cashback_source_lots_v1_261(uuid,date)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_owner_cashback_source_lots_v1_261(uuid,date)','EXECUTE')
 then raise exception 'OWNER_SOURCE_LOTS_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
