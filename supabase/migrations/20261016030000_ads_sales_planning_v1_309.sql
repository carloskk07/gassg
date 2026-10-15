-- TAMÃO V1.309 — private Ads commercial planning. No charge, publication or merchant commitment.
create table if not exists public.platform_ads_sales_plans_v1_309(
 merchant_id uuid primary key references public.merchants(id),
 creative_version integer not null check(creative_version>=1),
 price_cents integer not null check(price_cents between 1000 and 5000000),
 duration_days integer not null check(duration_days between 7 and 90),
 stage text not null check(stage in ('draft','ready_for_contact','paused','closed_lost')),
 note text not null check(char_length(note) between 12 and 500),
 version integer not null default 1 check(version>=1),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null
);
create index if not exists platform_ads_sales_plans_v1_309_stage_idx
 on public.platform_ads_sales_plans_v1_309(stage,updated_at desc);
alter table public.platform_ads_sales_plans_v1_309 enable row level security;
revoke all on public.platform_ads_sales_plans_v1_309 from public,anon,authenticated;
grant select,insert,update on public.platform_ads_sales_plans_v1_309 to service_role;

create table if not exists public.platform_ads_sales_plan_requests_v1_309(
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,
 signature jsonb not null,
 response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists platform_ads_sales_plan_requests_v1_309_merchant_idx
 on public.platform_ads_sales_plan_requests_v1_309(merchant_id,created_at desc);
alter table public.platform_ads_sales_plan_requests_v1_309 enable row level security;
revoke all on public.platform_ads_sales_plan_requests_v1_309 from public,anon,authenticated;
grant select,insert on public.platform_ads_sales_plan_requests_v1_309 to service_role;

create or replace function public.admin_ads_sales_plans_read_v1_309(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $function$
declare v_rows jsonb;v_total bigint;v_ready bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_PLAN_READ_DENIED' using errcode='42501'; end if;
 select count(*) into v_total from public.platform_ads_sales_plans_v1_309;
 select count(*) into v_ready from public.merchant_ads_campaigns_v1_233
  where status='approved_creative' and ads_live=false and no_charge=true;
 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',x.merchant_id,'companyName',left(m.name,120),
   'title',left(coalesce(c.title,''),80),'city',left(coalesce(c.target_city,''),100),
   'state',c.target_state,'creativeVersion',c.version,
   'creativeEligible',coalesce(c.status='approved_creative' and c.ads_live=false and c.no_charge=true,false),
   'planCreativeVersion',p.creative_version,'priceCents',p.price_cents,
   'durationDays',p.duration_days,'stage',p.stage,'note',p.note,
   'version',coalesce(p.version,0),'updatedAt',p.updated_at
 ) order by x.priority,x.changed_at desc,x.merchant_id),'[]'::jsonb)
 into v_rows
 from (
    select coalesce(p.merchant_id,c.merchant_id) merchant_id,
      case when c.status='approved_creative' and c.ads_live=false then 0 else 1 end priority,
      greatest(coalesce(p.updated_at,'epoch'::timestamptz),coalesce(c.updated_at,'epoch'::timestamptz)) changed_at
    from public.merchant_ads_campaigns_v1_233 c
    full join public.platform_ads_sales_plans_v1_309 p on p.merchant_id=c.merchant_id
    where p.merchant_id is not null or (c.status='approved_creative' and c.ads_live=false and c.no_charge=true)
    order by priority,changed_at desc limit 50
 ) x
 join public.merchants m on m.id=x.merchant_id
 left join public.merchant_ads_campaigns_v1_233 c on c.merchant_id=x.merchant_id
 left join public.platform_ads_sales_plans_v1_309 p on p.merchant_id=x.merchant_id;
 return jsonb_build_object('source','admin_ads_sales_plans_v1_309','readOnly',true,
  'checkedAt',clock_timestamp(),'totalPlans',v_total,'approvedCreatives',v_ready,
  'rows',v_rows,'noCharge',true,'adsLive',false,'revenueCents',0,
  'contractsSigned',0,'independentlyMeasuredImpressions',0);
end;
$function$;
revoke all on function public.admin_ads_sales_plans_read_v1_309(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_sales_plans_read_v1_309(uuid) to service_role;

create or replace function public.admin_ads_sales_plan_save_v1_309(
 p_actor uuid,p_merchant uuid,p_creative_version integer,p_expected_version integer,
 p_price_cents integer,p_duration_days integer,p_stage text,p_note text,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $function$
declare
 v_sig jsonb;v_prior record;v_current record;v_response jsonb;
 v_next integer;v_changed boolean;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_PLAN_ADMIN_DENIED' using errcode='42501'; end if;
 if p_merchant is null or p_request is null or p_creative_version is null or p_creative_version<1
   or p_expected_version is null or p_expected_version<0
   or p_price_cents is null or p_price_cents not between 1000 and 5000000
   or p_duration_days is null or p_duration_days not between 7 and 90
   or p_stage is null or p_stage not in ('draft','ready_for_contact','paused','closed_lost')
   or p_note is null or char_length(btrim(p_note)) not between 12 and 500
 then raise exception 'ADS_PLAN_INVALID' using errcode='22023'; end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,
   'creative',p_creative_version,'expected',p_expected_version,'price',p_price_cents,
   'duration',p_duration_days,'stage',p_stage,'note',btrim(p_note));
 select signature,response into v_prior
 from public.platform_ads_sales_plan_requests_v1_309 where request_id=p_request;
 if found then
  if v_prior.signature is distinct from v_sig then
    raise exception 'ADS_PLAN_REQUEST_REUSE' using errcode='23505'; end if;
  return v_prior.response||jsonb_build_object('replayed',true);
 end if;
 -- Serialize per creative to protect against merchant withdrawal or later editing.
 perform 1 from public.merchant_ads_campaigns_v1_233 c
 where c.merchant_id=p_merchant and c.version=p_creative_version
   and c.status='approved_creative' and c.ads_live=false and c.no_charge=true for update;
 if not found then raise exception 'ADS_PLAN_CREATIVE_NOT_APPROVED' using errcode='40001';end if;
 select version,creative_version,price_cents,duration_days,stage,note into v_current
 from public.platform_ads_sales_plans_v1_309 where merchant_id=p_merchant for update;
 if found then
   if v_current.version<>p_expected_version then
     raise exception 'ADS_PLAN_VERSION_CONFLICT' using errcode='40001';end if;
   v_changed:=v_current.creative_version is distinct from p_creative_version
    or v_current.price_cents is distinct from p_price_cents
    or v_current.duration_days is distinct from p_duration_days
    or v_current.stage is distinct from p_stage or v_current.note is distinct from btrim(p_note);
   v_next:=v_current.version;
   if v_changed then
     update public.platform_ads_sales_plans_v1_309 set
       creative_version=p_creative_version,price_cents=p_price_cents,
       duration_days=p_duration_days,stage=p_stage,note=btrim(p_note),
       version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
     where merchant_id=p_merchant returning version into v_next;
   end if;
 else
   if p_expected_version<>0 then raise exception 'ADS_PLAN_VERSION_CONFLICT' using errcode='40001';end if;
   insert into public.platform_ads_sales_plans_v1_309(
     merchant_id,creative_version,price_cents,duration_days,stage,note,updated_by)
   values(p_merchant,p_creative_version,p_price_cents,p_duration_days,p_stage,btrim(p_note),p_actor);
   v_next:=1;v_changed:=true;
 end if;
 v_response:=jsonb_build_object('source','admin_ads_sales_plan_save_v1_309',
   'merchantId',p_merchant,'creativeVersion',p_creative_version,'version',v_next,
   'changed',v_changed,'replayed',false,'stage',p_stage,'priceCents',p_price_cents,
   'durationDays',p_duration_days,'noCharge',true,'adsLive',false,
   'contractSigned',false,'merchantNotified',false,'paymentCreated',false);
 if v_changed then
  insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
  values(p_actor,'ads-commercial-plan','merchant',p_merchant::text,
   jsonb_build_object('version',v_next,'creativeVersion',p_creative_version,
     'priceCents',p_price_cents,'durationDays',p_duration_days,'stage',p_stage,
     'note',btrim(p_note),'requestId',p_request));
 end if;
 insert into public.platform_ads_sales_plan_requests_v1_309
 (request_id,merchant_id,actor_user_id,signature,response)
 values(p_request,p_merchant,p_actor,v_sig,v_response);
 return v_response;
end;
$function$;
revoke all on function public.admin_ads_sales_plan_save_v1_309(uuid,uuid,integer,integer,integer,integer,text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_sales_plan_save_v1_309(uuid,uuid,integer,integer,integer,integer,text,text,uuid)
 to service_role;
