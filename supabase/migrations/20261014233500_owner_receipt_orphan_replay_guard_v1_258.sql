-- V1.258 security patch for databases that already applied the initial migration.
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
  -- A replay never authorizes deletion from a stale reservation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'campaign-receipt-v1-256:'||v_old.expense_id::text,0));
  if not exists (
   select 1 from storage.objects o where o.id=v_old.object_id
    and o.name=v_old.object_path
    and o.bucket_id='tamao-owner-campaign-receipts-v1-256'
    and coalesce(o.is_delete_marker,false)=false
    and o.created_at<=clock_timestamp()-interval '24 hours'
  ) or exists (
   select 1 from public.platform_campaign_marketing_receipts_v1_256 r
    where r.object_path=v_old.object_path
  ) or not exists (
   select 1 from public.platform_campaign_marketing_costs_v1_255 c
    where c.expense_id=v_old.expense_id
  ) then raise exception 'ORPHAN_CLEANUP_REPLAY_UNSAFE' using errcode='42501';end if;
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
