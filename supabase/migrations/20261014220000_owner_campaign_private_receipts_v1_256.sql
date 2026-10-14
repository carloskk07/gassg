-- TAMÃO V1.256 — receipt files for documented owner marketing costs.
-- Private bucket + immutable metadata. No anonymous/authenticated object grants or RLS policies.
-- A receipt is documentary evidence, NOT PSP/bank proof or spending permission.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tamao-owner-campaign-receipts-v1-256','tamao-owner-campaign-receipts-v1-256',
  false,3145728,array['application/pdf','image/png','image/jpeg'])
on conflict(id) do nothing;

do $bucket$begin
 if not exists (
  select 1 from storage.buckets b where b.id='tamao-owner-campaign-receipts-v1-256'
   and b.public=false and b.file_size_limit=3145728
   and b.allowed_mime_types @> array['application/pdf','image/png','image/jpeg']
 ) then raise exception 'OWNER_RECEIPT_BUCKET_CONFIGURATION_UNSAFE' using errcode='42501';end if;
end$bucket$;

create table public.platform_campaign_marketing_receipts_v1_256(
 expense_id uuid primary key references public.platform_campaign_marketing_costs_v1_255(expense_id) on delete restrict,
 object_path text not null unique check(char_length(object_path) between 78 and 100),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes integer not null check(size_bytes between 64 and 3145728),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 check(object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg)$')
);
alter table public.platform_campaign_marketing_receipts_v1_256 enable row level security;
revoke all on public.platform_campaign_marketing_receipts_v1_256 from public,anon,authenticated,service_role;
create schema if not exists platform_funding_private_v1_256;
revoke all on schema platform_funding_private_v1_256 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_256 to service_role;

create or replace function platform_funding_private_v1_256.eligible(
 p_actor uuid,p_expense uuid
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $func$
declare v_existing public.platform_campaign_marketing_receipts_v1_256%rowtype;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin'
 ) then raise exception 'RECEIPT_UPLOAD_DENIED' using errcode='42501';end if;
 if p_expense is null or not exists(
  select 1 from public.platform_campaign_marketing_costs_v1_255 c
  where c.expense_id=p_expense
    and not exists(select 1 from public.platform_campaign_marketing_cost_voids_v1_255 v
       where v.expense_id=c.expense_id)
 ) then raise exception 'RECEIPT_EXPENSE_NOT_ELIGIBLE' using errcode='22023';end if;
 select * into v_existing from public.platform_campaign_marketing_receipts_v1_256 r
 where r.expense_id=p_expense;
 return jsonb_build_object('source','admin_owner_campaign_receipt_eligible_v1_256',
  'eligible',v_existing.expense_id is null,'alreadyAttached',v_existing.expense_id is not null,
  'bankVerified',false,'cashMoved',false);
end;$func$;

create or replace function platform_funding_private_v1_256.attach(
 p_actor uuid,p_expense uuid,p_path text,p_mime text,p_size integer,p_sha text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $func$
declare v_prev public.platform_campaign_marketing_receipts_v1_256%rowtype;
 v_replayed boolean:=false;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin'
 ) then raise exception 'RECEIPT_ATTACH_DENIED' using errcode='42501';end if;
 if p_expense is null or p_path is null
   or p_path !~ ('^'||p_expense::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$')
   or p_mime is null or p_mime not in ('application/pdf','image/png','image/jpeg')
   or right(p_path,4) not in ('.pdf','.png','.jpg')
   or (p_mime='application/pdf' and right(p_path,4)<>'.pdf')
   or (p_mime='image/png' and right(p_path,4)<>'.png')
   or (p_mime='image/jpeg' and right(p_path,4)<>'.jpg')
   or p_size is null or p_size not between 64 and 3145728
   or p_sha is null or p_sha !~ '^[0-9a-f]{64}$'
 then raise exception 'RECEIPT_METADATA_INVALID' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('campaign-receipt-v1-256:'||p_expense::text,0));
 if not exists(
   select 1 from public.platform_campaign_marketing_costs_v1_255 c
   where c.expense_id=p_expense and not exists(
    select 1 from public.platform_campaign_marketing_cost_voids_v1_255 v
    where v.expense_id=c.expense_id)
 ) then raise exception 'RECEIPT_EXPENSE_NOT_ELIGIBLE' using errcode='22023';end if;
 select * into v_prev from public.platform_campaign_marketing_receipts_v1_256
 where expense_id=p_expense;
 if found then
  if v_prev.recorded_by<>p_actor or v_prev.object_path<>p_path
    or v_prev.mime_type<>p_mime or v_prev.size_bytes<>p_size
    or v_prev.sha256<>p_sha
  then raise exception 'RECEIPT_ALREADY_ATTACHED' using errcode='23505';end if;
  v_replayed:=true;
 else
  insert into public.platform_campaign_marketing_receipts_v1_256
   (expense_id,object_path,mime_type,size_bytes,sha256,recorded_by)
  values(p_expense,p_path,p_mime,p_size,p_sha,p_actor);
 end if;
 return jsonb_build_object('source','admin_owner_campaign_receipt_attach_v1_256',
  'attached',true,'replayed',v_replayed,'bankVerified',false,
  'cashMoved',false,'newBenefitsEnabled',false);
end;$func$;

create or replace function platform_funding_private_v1_256.receipts_read(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $func$
declare
 v_month date:=coalesce(p_month,
   date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_rows jsonb;v_total bigint;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'RECEIPT_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')+
   interval '2 months')::date
 then raise exception 'RECEIPT_MONTH_INVALID' using errcode='22023';end if;
 select count(*) into v_total
 from public.platform_campaign_marketing_receipts_v1_256 r
 join public.platform_campaign_marketing_costs_v1_255 c on c.expense_id=r.expense_id
 join public.platform_owner_budget_allocations_v1_247 a on a.allocation_id=c.allocation_id
 where a.month_key=v_month;
 select coalesce(jsonb_agg(jsonb_build_object(
  'expenseId',x.expense_id,'sizeBytes',x.size_bytes,
  'mimeType',x.mime_type,'sha256',x.sha256,
  'uploadedAt',x.recorded_at,'voided',x.voided
 ) order by x.recorded_at desc,x.expense_id),'[]'::jsonb)
 into v_rows from (
  select r.expense_id,r.size_bytes,r.mime_type,r.sha256,r.recorded_at,
   exists(select 1 from public.platform_campaign_marketing_cost_voids_v1_255 v
    where v.expense_id=r.expense_id) as voided
  from public.platform_campaign_marketing_receipts_v1_256 r
  join public.platform_campaign_marketing_costs_v1_255 c on c.expense_id=r.expense_id
  join public.platform_owner_budget_allocations_v1_247 a on a.allocation_id=c.allocation_id
  where a.month_key=v_month
  order by r.recorded_at desc,r.expense_id limit 100
 )x;
 return jsonb_build_object('source','admin_owner_campaign_receipts_read_v1_256',
  'month',v_month,'total',v_total,'rows',v_rows,'limit',100,'truncated',v_total>100,
  'readOnly',true,'privateBucket',true,'bankVerified',false,'noPublicUrls',true);
end;$func$;

create or replace function platform_funding_private_v1_256.receipt_path(
 p_actor uuid,p_expense uuid
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $func$
declare v_receipt public.platform_campaign_marketing_receipts_v1_256%rowtype;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 select * into v_receipt from public.platform_campaign_marketing_receipts_v1_256 r
 where r.expense_id=p_expense;
 if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode='22023';end if;
 return jsonb_build_object('source','admin_owner_campaign_receipt_path_v1_256',
  'objectPath',v_receipt.object_path,'mimeType',v_receipt.mime_type,
  'sha256',v_receipt.sha256,'sizeBytes',v_receipt.size_bytes);
end;$func$;

revoke all on function platform_funding_private_v1_256.eligible(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_256.attach(uuid,uuid,text,text,integer,text) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_256.receipts_read(uuid,date) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_256.receipt_path(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_256.eligible(uuid,uuid) to service_role;
grant execute on function platform_funding_private_v1_256.attach(uuid,uuid,text,text,integer,text) to service_role;
grant execute on function platform_funding_private_v1_256.receipts_read(uuid,date) to service_role;
grant execute on function platform_funding_private_v1_256.receipt_path(uuid,uuid) to service_role;

create function public.admin_owner_campaign_receipt_eligible_v1_256(p_actor uuid,p_expense uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_256.eligible($1,$2)
$wrap$;
create function public.admin_owner_campaign_receipt_attach_v1_256(
 p_actor uuid,p_expense uuid,p_path text,p_mime text,p_size integer,p_sha text)
returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_256.attach($1,$2,$3,$4,$5,$6)
$wrap$;
create function public.admin_owner_campaign_receipts_read_v1_256(p_actor uuid,p_month date default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_256.receipts_read($1,$2)
$wrap$;
create function public.admin_owner_campaign_receipt_path_v1_256(p_actor uuid,p_expense uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_256.receipt_path($1,$2)
$wrap$;
revoke all on function public.admin_owner_campaign_receipt_eligible_v1_256(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_campaign_receipt_attach_v1_256(uuid,uuid,text,text,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_campaign_receipts_read_v1_256(uuid,date) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_campaign_receipt_path_v1_256(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_receipt_eligible_v1_256(uuid,uuid) to service_role;
grant execute on function public.admin_owner_campaign_receipt_attach_v1_256(uuid,uuid,text,text,integer,text) to service_role;
grant execute on function public.admin_owner_campaign_receipts_read_v1_256(uuid,date) to service_role;
grant execute on function public.admin_owner_campaign_receipt_path_v1_256(uuid,uuid) to service_role;

do $acl$begin
 if has_table_privilege('authenticated','public.platform_campaign_marketing_receipts_v1_256','SELECT')
 or has_table_privilege('service_role','public.platform_campaign_marketing_receipts_v1_256','INSERT')
 or has_function_privilege('anon','public.admin_owner_campaign_receipts_read_v1_256(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_campaign_receipt_attach_v1_256(uuid,uuid,text,text,integer,text)','EXECUTE')
 then raise exception 'RECEIPT_STORAGE_ACCESS_DRIFT' using errcode='42501';end if;
end$acl$;
