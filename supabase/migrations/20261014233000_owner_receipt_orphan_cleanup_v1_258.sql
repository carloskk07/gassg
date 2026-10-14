-- TAMÃO V1.258 — human-approved, single-object orphan cleanup with append-only audit.
-- Storage API performs the actual delete. SQL only authorizes and proves absence.
-- No cron, no bulk delete, no public object paths and no deletion of linked evidence.
create table public.platform_campaign_receipt_cleanup_requests_v1_258 (
 request_id uuid primary key,
 object_id uuid not null,
 object_path text not null,
 expense_id uuid not null,
 requested_by uuid not null references auth.users(id),
 requested_at timestamptz not null default clock_timestamp()
);
create index owner_cleanup_object_v1_258
 on public.platform_campaign_receipt_cleanup_requests_v1_258(object_id,requested_at desc);
create table public.platform_campaign_receipt_cleanup_results_v1_258 (
 request_id uuid primary key references public.platform_campaign_receipt_cleanup_requests_v1_258(request_id) on delete restrict,
 outcome text not null check (outcome in ('absent_confirmed','failed')),
 finished_at timestamptz not null default clock_timestamp(),
 finished_by uuid not null references auth.users(id)
);
alter table public.platform_campaign_receipt_cleanup_requests_v1_258 enable row level security;
alter table public.platform_campaign_receipt_cleanup_results_v1_258 enable row level security;
revoke all on public.platform_campaign_receipt_cleanup_requests_v1_258 from public,anon,authenticated,service_role;
revoke all on public.platform_campaign_receipt_cleanup_results_v1_258 from public,anon,authenticated,service_role;
create schema if not exists platform_funding_private_v1_258;
revoke all on schema platform_funding_private_v1_258 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_258 to service_role;

create or replace function platform_funding_private_v1_258.candidates(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_rows jsonb;v_count bigint;
begin
 if p_actor is null or not exists (
  select 1 from public.platform_admins a where a.user_id=p_actor and a.active
  and a.admin_role in ('superadmin','finance')
 ) then raise exception 'ORPHAN_CLEANUP_READ_DENIED' using errcode='42501';end if;
 if not exists (
  select 1 from storage.buckets b
  where b.id='tamao-owner-campaign-receipts-v1-256' and b.public=false
    and b.file_size_limit=3145728
 ) then raise exception 'ORPHAN_BUCKET_UNSAFE' using errcode='42501';end if;
 with orphan as (
  select o.id,o.name,o.created_at from storage.objects o
  where o.bucket_id='tamao-owner-campaign-receipts-v1-256'
    and coalesce(o.is_delete_marker,false)=false
    and o.created_at<=clock_timestamp()-interval '24 hours'
    and o.name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$'
    and exists(select 1 from public.platform_campaign_marketing_costs_v1_255 c
      where c.expense_id=split_part(o.name,'/',1)::uuid)
    and not exists(select 1 from public.platform_campaign_marketing_receipts_v1_256 r
      where r.object_path=o.name)
    and not exists (
      select 1 from public.platform_campaign_receipt_cleanup_requests_v1_258 req
      left join public.platform_campaign_receipt_cleanup_results_v1_258 result
        on result.request_id=req.request_id
      where req.object_id=o.id and (
        result.outcome='absent_confirmed'
        or (result.request_id is null and req.requested_at>
          clock_timestamp()-interval '15 minutes')
      )
    )
 )
 select count(*) into v_count from orphan;
 with orphan as (
  select o.id,o.created_at
  from storage.objects o
  where o.bucket_id='tamao-owner-campaign-receipts-v1-256'
    and coalesce(o.is_delete_marker,false)=false
    and o.created_at<=clock_timestamp()-interval '24 hours'
    and o.name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$'
    and exists(select 1 from public.platform_campaign_marketing_costs_v1_255 c
      where c.expense_id=split_part(o.name,'/',1)::uuid)
    and not exists(select 1 from public.platform_campaign_marketing_receipts_v1_256 r
      where r.object_path=o.name)
    and not exists (
      select 1 from public.platform_campaign_receipt_cleanup_requests_v1_258 req
      left join public.platform_campaign_receipt_cleanup_results_v1_258 result
        on result.request_id=req.request_id
      where req.object_id=o.id and (
        result.outcome='absent_confirmed'
        or (result.request_id is null and req.requested_at>
          clock_timestamp()-interval '15 minutes')
      )
    )
  order by o.created_at asc,o.id limit 20
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'objectId',o.id,'createdAt',o.created_at
 )order by o.created_at asc,o.id),'[]'::jsonb) into v_rows from orphan o;
 return jsonb_build_object(
  'source','admin_owner_cleanup_candidates_v1_258',
  'rows',v_rows,'totalCandidates',v_count,'limit',20,'truncated',v_count>20,
  'minAgeHours',24,'readOnly',true,'privateBucket',true,'noObjectPaths',true,
  'automaticDeletionEnabled',false,'deletionPerformed',false
 );
end;$fn$;

create or replace function platform_funding_private_v1_258.reserve(
 p_actor uuid,p_object uuid,p_request uuid
)returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare v_o storage.objects%rowtype;v_old public.platform_campaign_receipt_cleanup_requests_v1_258%rowtype;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin'
 )then raise exception 'ORPHAN_CLEANUP_WRITE_DENIED' using errcode='42501';end if;
 if p_object is null or p_request is null then
   raise exception 'ORPHAN_CLEANUP_BAD_ID' using errcode='22023';end if;
 select * into v_old from public.platform_campaign_receipt_cleanup_requests_v1_258
 where request_id=p_request;
 if found then
  if v_old.requested_by<>p_actor or v_old.object_id<>p_object then
   raise exception 'ORPHAN_CLEANUP_REPLAY_CONFLICT' using errcode='23505';end if;
  if exists(select 1 from public.platform_campaign_receipt_cleanup_results_v1_258 r
   where r.request_id=p_request) then
    raise exception 'ORPHAN_CLEANUP_ALREADY_FINALIZED' using errcode='23505';end if;
  return jsonb_build_object('source','admin_owner_cleanup_reserved_v1_258',
   'requestId',p_request,'objectPath',v_old.object_path,'reserved',true,'replayed',true);
 end if;
 select * into v_o from storage.objects o where o.id=p_object
   and o.bucket_id='tamao-owner-campaign-receipts-v1-256'
   and coalesce(o.is_delete_marker,false)=false;
 if not found then raise exception 'ORPHAN_CLEANUP_NOT_FOUND' using errcode='22023';end if;
 if v_o.name !~
   '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$'
 then raise exception 'ORPHAN_CLEANUP_PATH_UNSAFE' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'campaign-receipt-v1-256:'||split_part(v_o.name,'/',1),0));
 if v_o.created_at>clock_timestamp()-interval '24 hours'
 or not exists(select 1 from public.platform_campaign_marketing_costs_v1_255 c
   where c.expense_id=split_part(v_o.name,'/',1)::uuid)
 or exists(select 1 from public.platform_campaign_marketing_receipts_v1_256 r
   where r.object_path=v_o.name)
 or exists(
   select 1 from public.platform_campaign_receipt_cleanup_requests_v1_258 req
   left join public.platform_campaign_receipt_cleanup_results_v1_258 res
   on res.request_id=req.request_id
   where req.object_id=p_object and (
     res.outcome='absent_confirmed' or
     (res.request_id is null and req.requested_at>clock_timestamp()-interval '15 minutes')
   )
 )
 then raise exception 'ORPHAN_CLEANUP_NOT_ELIGIBLE' using errcode='42501';end if;
 insert into public.platform_campaign_receipt_cleanup_requests_v1_258(
   request_id,object_id,object_path,expense_id,requested_by)
 values(p_request,p_object,v_o.name,split_part(v_o.name,'/',1)::uuid,p_actor);
 return jsonb_build_object('source','admin_owner_cleanup_reserved_v1_258',
   'requestId',p_request,'objectPath',v_o.name,'reserved',true,'replayed',false);
end;$fn$;

create or replace function platform_funding_private_v1_258.finish(
 p_actor uuid,p_request uuid,p_outcome text
)returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare v_request public.platform_campaign_receipt_cleanup_requests_v1_258%rowtype;
 v_result public.platform_campaign_receipt_cleanup_results_v1_258%rowtype;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
 where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ORPHAN_CLEANUP_FINISH_DENIED' using errcode='42501';end if;
 if p_request is null or p_outcome not in('absent_confirmed','failed')
 then raise exception 'ORPHAN_CLEANUP_FINISH_INVALID' using errcode='22023';end if;
 select * into v_request from public.platform_campaign_receipt_cleanup_requests_v1_258
 where request_id=p_request and requested_by=p_actor;
 if not found then raise exception 'ORPHAN_CLEANUP_REQUEST_NOT_FOUND' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'campaign-receipt-v1-256:'||v_request.expense_id::text,0));
 select * into v_result from public.platform_campaign_receipt_cleanup_results_v1_258
 where request_id=p_request;
 if found then
  if v_result.outcome<>p_outcome then
   raise exception 'ORPHAN_CLEANUP_OUTCOME_CONFLICT' using errcode='23505';end if;
  return jsonb_build_object('source','admin_owner_cleanup_finished_v1_258',
   'outcome',v_result.outcome,'replayed',true,'recorded',true);
 end if;
 if p_outcome='absent_confirmed' and (
   exists(select 1 from storage.objects o where o.id=v_request.object_id
     and o.bucket_id='tamao-owner-campaign-receipts-v1-256'
     and coalesce(o.is_delete_marker,false)=false)
   or exists(select 1 from public.platform_campaign_marketing_receipts_v1_256 r
     where r.object_path=v_request.object_path)
 ) then raise exception 'ORPHAN_CLEANUP_OBJECT_STILL_PRESENT' using errcode='42501';end if;
 insert into public.platform_campaign_receipt_cleanup_results_v1_258(
   request_id,outcome,finished_by) values(p_request,p_outcome,p_actor);
 return jsonb_build_object('source','admin_owner_cleanup_finished_v1_258',
    'outcome',p_outcome,'replayed',false,'recorded',true);
end;$fn$;

create or replace function public.admin_owner_cleanup_candidates_v1_258(p_actor uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_258.candidates($1)
$wrap$;
create or replace function public.admin_owner_cleanup_reserve_v1_258(
 p_actor uuid,p_object uuid,p_request uuid)
returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_258.reserve($1,$2,$3)
$wrap$;
create or replace function public.admin_owner_cleanup_finish_v1_258(
 p_actor uuid,p_request uuid,p_outcome text)
returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_258.finish($1,$2,$3)
$wrap$;

revoke all on function platform_funding_private_v1_258.candidates(uuid) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_258.reserve(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_258.finish(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_cleanup_candidates_v1_258(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_cleanup_reserve_v1_258(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_cleanup_finish_v1_258(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_258.candidates(uuid) to service_role;
grant execute on function platform_funding_private_v1_258.reserve(uuid,uuid,uuid) to service_role;
grant execute on function platform_funding_private_v1_258.finish(uuid,uuid,text) to service_role;
grant execute on function public.admin_owner_cleanup_candidates_v1_258(uuid) to service_role;
grant execute on function public.admin_owner_cleanup_reserve_v1_258(uuid,uuid,uuid) to service_role;
grant execute on function public.admin_owner_cleanup_finish_v1_258(uuid,uuid,text) to service_role;
