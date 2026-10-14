-- TAMÃO V1.250 — consulta histórica de decisões financeiras, exclusivamente leitura.
-- Eventos preexistentes V1.246/V1.247: nenhum depósito, pagamento ou incentivo novo.
create schema if not exists platform_funding_private_v1_250;
revoke all on schema platform_funding_private_v1_250 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_250 to service_role;

create or replace function platform_funding_private_v1_250.history(
 p_actor uuid, p_month date default null, p_benefit text default null,
 p_kind text default 'all', p_event text default 'all', p_offset integer default 0
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_total bigint;
 v_rows jsonb;
 v_size integer:=20;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then
  raise exception 'OWNER_HISTORY_ACCESS_DENIED' using errcode='42501';
 end if;
 if (p_month is not null and (extract(day from p_month)<>1
      or p_month<date '2026-01-01'
      or p_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')+interval '2 months')::date))
    or (p_benefit is not null and p_benefit not in
      ('customer_cashback','customer_referral','merchant_referral','clube_coupons'))
    or p_kind not in ('all','contribution','campaign')
    or p_event not in ('all','contribution_submitted','contribution_manual_reconciled',
       'contribution_rejected','contribution_disputed','campaign_allocated','campaign_released')
    or p_offset is null or p_offset<0 or p_offset>10000 or p_offset%20<>0
 then
   raise exception 'OWNER_HISTORY_FILTER_INVALID' using errcode='22023';
 end if;
 with events as (
  select ev.request_id event_id, ev.created_at, ev.actor_id,
   c.benefit_key, 'contribution'::text kind,
   case when ev.action='submit' then 'contribution_submitted'::text
        else 'contribution_'||coalesce(ev.request_signature->>'action','unknown') end event_type,
   c.amount_cents, null::date campaign_month, null::text campaign_label,
   c.transfer_date, coalesce(ev.request_signature->>'note','')::text event_note,
   ev.from_version, ev.to_version
  from public.platform_owner_contribution_events_v1_246 ev
  join public.platform_owner_contributions_v1_246 c on c.contribution_id=ev.contribution_id
  union all
  select ev.request_id,ev.created_at,ev.actor_id,
   a.benefit_key,'campaign'::text,
   case when ev.event_type='allocate' then 'campaign_allocated' else 'campaign_released' end,
   a.amount_cents,a.month_key,a.campaign_label,
   null::date,coalesce(ev.request_signature->>'reason','')::text,
   ev.from_version,ev.to_version
  from public.platform_owner_budget_allocation_events_v1_247 ev
  join public.platform_owner_budget_allocations_v1_247 a on a.allocation_id=ev.allocation_id
 ), filtered as (
  select * from events
  where (p_month is null or (created_at >= p_month::timestamp at time zone 'America/Sao_Paulo'
     and created_at < (p_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo'))
    and (p_benefit is null or benefit_key=p_benefit)
    and (p_kind='all' or kind=p_kind)
    and (p_event='all' or event_type=p_event)
 )
 select count(*) into v_total from filtered;
 with events as (
  select ev.request_id event_id,ev.created_at,ev.actor_id,c.benefit_key,
   'contribution'::text kind,
   case when ev.action='submit' then 'contribution_submitted'::text
      else 'contribution_'||coalesce(ev.request_signature->>'action','unknown') end event_type,
   c.amount_cents,null::date campaign_month,null::text campaign_label,
   c.transfer_date,coalesce(ev.request_signature->>'note','')::text event_note,
   ev.from_version,ev.to_version
  from public.platform_owner_contribution_events_v1_246 ev
  join public.platform_owner_contributions_v1_246 c on c.contribution_id=ev.contribution_id
  union all
  select ev.request_id,ev.created_at,ev.actor_id,a.benefit_key,
   'campaign'::text,
   case when ev.event_type='allocate' then 'campaign_allocated' else 'campaign_released' end,
   a.amount_cents,a.month_key,a.campaign_label,
   null::date,coalesce(ev.request_signature->>'reason','')::text,
   ev.from_version,ev.to_version
  from public.platform_owner_budget_allocation_events_v1_247 ev
  join public.platform_owner_budget_allocations_v1_247 a on a.allocation_id=ev.allocation_id
 ), selected as (
  select * from events
   where (p_month is null or (created_at >= p_month::timestamp at time zone 'America/Sao_Paulo'
      and created_at < (p_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo'))
     and (p_benefit is null or benefit_key=p_benefit)
     and (p_kind='all' or kind=p_kind)
     and (p_event='all' or event_type=p_event)
   order by created_at desc,event_id desc,kind
   limit v_size offset p_offset
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'eventId',event_id,'createdAt',created_at,'actorId',actor_id,
  'benefitKey',benefit_key,'kind',kind,'eventType',event_type,
  'amountCents',amount_cents,'campaignMonth',campaign_month,
  'campaignLabel',campaign_label,'transferDate',transfer_date,
  'note',event_note,'fromVersion',from_version,'toVersion',to_version
 ) order by created_at desc,event_id desc,kind),'[]'::jsonb)
 into v_rows from selected;
 return jsonb_build_object(
  'source','admin_owner_finance_history_v1_250',
  'rows',v_rows,'total',v_total,'offset',p_offset,'pageSize',v_size,
  'month',p_month,'benefitKey',p_benefit,'kind',p_kind,'eventType',p_event,
  'readOnly',true,'bankApiConfirmed',false,'fundsSpendable',false,
  'spendableCents',0,'newBenefitsEnabled',false,'cashMoved',false);
end;$fn$;
revoke all on function platform_funding_private_v1_250.history(uuid,date,text,text,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_250.history(uuid,date,text,text,text,integer)
 to service_role;

create or replace function public.admin_owner_finance_history_v1_250(
 p_actor uuid, p_month date default null, p_benefit text default null,
 p_kind text default 'all', p_event text default 'all', p_offset integer default 0
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_250.history($1,$2,$3,$4,$5,$6)
$wrap$;
revoke all on function public.admin_owner_finance_history_v1_250(uuid,date,text,text,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_finance_history_v1_250(uuid,date,text,text,text,integer)
 to service_role;

-- Pagination by server event timestamp; no customer table access or financial writes.
create index if not exists owner_contribution_event_date_v1_250
 on public.platform_owner_contribution_events_v1_246(created_at desc,request_id desc);
create index if not exists owner_budget_event_date_v1_250
 on public.platform_owner_budget_allocation_events_v1_247(created_at desc,request_id desc);
do $audit$
begin
 if has_function_privilege('anon','public.admin_owner_finance_history_v1_250(uuid,date,text,text,text,integer)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_finance_history_v1_250(uuid,date,text,text,text,integer)','EXECUTE')
 or has_table_privilege('authenticated','public.platform_owner_contribution_events_v1_246','SELECT')
 or has_table_privilege('authenticated','public.platform_owner_budget_allocation_events_v1_247','SELECT')
 then raise exception 'OWNER_HISTORY_ACL_DRIFT' using errcode='42501';end if;
end $audit$;
