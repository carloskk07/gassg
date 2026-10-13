-- TAMÃO Ads V1.233 — creative review, NOT ad delivery, placement or billing.
-- Only one bounded draft per revenda. No links, tracking pixels, client identifiers or prices.
create table public.merchant_ads_campaigns_v1_233 (
 merchant_id uuid primary key references public.merchants(id) on delete cascade,
 title text not null check (char_length(title) between 12 and 80),
 description text not null check (char_length(description) between 30 and 240),
 category_key text not null check(category_key ~ '^[a-z][a-z0-9_]{1,39}$' or category_key='all'),
 target_city text not null check(char_length(target_city) between 2 and 100),
 target_state text not null check(target_state ~ '^[A-Z]{2}$'),
 status text not null check(status in ('draft','submitted','approved_creative','needs_changes','withdrawn')),
 version integer not null default 1 check(version>0),
 submitted_at timestamptz,
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete restrict,
 review_note text,
 updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 ads_live boolean not null default false check(ads_live=false),
 no_charge boolean not null default true check(no_charge=true)
);
create index merchant_ads_campaigns_status_v1_233
 on public.merchant_ads_campaigns_v1_233(status,submitted_at desc,merchant_id);

create table public.merchant_ads_campaign_events_v1_233 (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 event text not null check(event in ('created','edited','submitted','withdrawn','approved_creative','needs_changes')),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{32}$'),
 version integer not null check(version>0),
 note text,
 created_at timestamptz not null default clock_timestamp()
);
create index merchant_ads_events_merchant_v1_233
 on public.merchant_ads_campaign_events_v1_233(merchant_id,created_at desc,id desc);
create index merchant_ads_events_actor_v1_233
 on public.merchant_ads_campaign_events_v1_233(actor_user_id);
create index merchant_ads_campaigns_updated_by_v1_233
 on public.merchant_ads_campaigns_v1_233(updated_by);
create index merchant_ads_campaigns_reviewed_by_v1_233
 on public.merchant_ads_campaigns_v1_233(reviewed_by);

alter table public.merchant_ads_campaigns_v1_233 enable row level security;
alter table public.merchant_ads_campaign_events_v1_233 enable row level security;
revoke all on public.merchant_ads_campaigns_v1_233 from public,anon,authenticated,service_role;
revoke all on public.merchant_ads_campaign_events_v1_233 from public,anon,authenticated,service_role;
grant select on public.merchant_ads_campaigns_v1_233 to service_role;

create schema if not exists ads_internal_v1_233;
revoke all on schema ads_internal_v1_233 from public,anon,authenticated;
grant usage on schema ads_internal_v1_233 to service_role;

create or replace function ads_internal_v1_233.merchant_campaign(
 p_actor uuid,p_merchant uuid,p_action text,p_request uuid,
 p_title text,p_description text,p_category text,p_version integer
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v public.merchant_ads_campaigns_v1_233%rowtype;
 e public.merchant_ads_campaign_events_v1_233%rowtype;
 v_name text:=btrim(coalesce(p_title,''));
 v_body text:=btrim(coalesce(p_description,''));
 v_cat text:=coalesce(nullif(btrim(p_category),''),'all');
 v_city text;
 v_state text;
 v_merchant_status text;
 v_hash text;
 v_event text;
 v_now timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from public.merchant_members mm
    where mm.user_id=p_actor and mm.merchant_id=p_merchant and mm.active
      and mm.member_role in ('owner','manager')) then
   raise exception 'ADS_CAMPAIGN_MERCHANT_DENIED' using errcode='42501';
 end if;
 if p_action not in ('view','save','submit','withdraw') or p_action is null then
   raise exception 'ADS_CAMPAIGN_ACTION_INVALID' using errcode='22023';
 end if;
 if p_action<>'view' and p_request is null then
   raise exception 'ADS_CAMPAIGN_REQUEST_ID_REQUIRED' using errcode='22023';
 end if;
 v_hash:=md5(jsonb_build_object('action',p_action,'merchant',p_merchant,
   'title',v_name,'description',v_body,'category',v_cat,'version',p_version)::text);
 if p_action<>'view' then
   perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('ads-campaign:'||p_merchant::text,233));
   select * into e from public.merchant_ads_campaign_events_v1_233
     where request_id=p_request;
   if found then
     if e.merchant_id is distinct from p_merchant or e.actor_user_id is distinct from p_actor
        or e.request_hash is distinct from v_hash then
       raise exception 'ADS_CAMPAIGN_REQUEST_REUSED' using errcode='23505';
     end if;
     select * into v from public.merchant_ads_campaigns_v1_233 where merchant_id=p_merchant;
     return jsonb_build_object('source','merchant_ads_campaign_v1_233',
       'merchantId',p_merchant,'campaign',to_jsonb(v)-'updated_by'-'reviewed_by',
       'idempotent',true,'noCharge',true,'adsLive',false);
   end if;
 end if;
 select * into v from public.merchant_ads_campaigns_v1_233
   where merchant_id=p_merchant;
 if p_action='view' then
   return jsonb_build_object('source','merchant_ads_campaign_v1_233',
     'merchantId',p_merchant,'campaign',case when found then
       to_jsonb(v)-'updated_by'-'reviewed_by' else null end,
     'readOnly',true,'noCharge',true,'adsLive',false);
 end if;
 if (not found and coalesce(p_version,0)<>0) or
    (found and p_version is distinct from v.version) then
   raise exception 'ADS_CAMPAIGN_VERSION_CONFLICT' using errcode='40001';
 end if;
 if p_action='save' then
   if char_length(v_name) not between 12 and 80
      or char_length(v_body) not between 30 and 240
      or v_cat !~ '^[a-z][a-z0-9_]{1,39}$'
      or (v_cat<>'all' and not exists (
        select 1 from public.product_delivery_profiles pr
        where pr.category_key=v_cat and pr.active)) then
     raise exception 'ADS_CAMPAIGN_CREATIVE_INVALID' using errcode='22023';
   end if;
   if v.merchant_id is not null and v.status not in ('draft','needs_changes','withdrawn') then
     raise exception 'ADS_CAMPAIGN_EDIT_LOCKED' using errcode='23514';
   end if;
   select left(btrim(d.city),100),upper(left(btrim(d.state),2))
     into v_city,v_state
   from public.merchant_business_details d where d.merchant_id=p_merchant;
   if char_length(coalesce(v_city,''))<2 or v_state !~ '^[A-Z]{2}$' or v_state is null then
     raise exception 'ADS_CAMPAIGN_CITY_REQUIRED' using errcode='22023';
   end if;
   if v.merchant_id is null then
     insert into public.merchant_ads_campaigns_v1_233
      (merchant_id,title,description,category_key,target_city,target_state,status,updated_by)
     values(p_merchant,v_name,v_body,v_cat,v_city,v_state,'draft',p_actor);
     v_event:='created';
   else
     update public.merchant_ads_campaigns_v1_233
       set title=v_name,description=v_body,category_key=v_cat,
        target_city=v_city,target_state=v_state,
        status='draft',version=version+1,submitted_at=null,
        reviewed_at=null,reviewed_by=null,review_note=null,
        updated_by=p_actor,updated_at=v_now
       where merchant_id=p_merchant;
     v_event:='edited';
   end if;
 else
   if v.merchant_id is null then
     raise exception 'ADS_CAMPAIGN_DRAFT_REQUIRED' using errcode='22023';
   end if;
   if p_action='submit' then
     if v.status<>'draft' then
       raise exception 'ADS_CAMPAIGN_SUBMIT_STATE' using errcode='23514';
     end if;
     if not exists(select 1 from public.merchant_ads_interest_v1_232 i
       where i.merchant_id=p_merchant and i.interested) then
       raise exception 'ADS_CAMPAIGN_OPT_IN_REQUIRED' using errcode='22023';
     end if;
     select m.status into v_merchant_status from public.merchants m where m.id=p_merchant;
     if v_merchant_status<>'active' then
       raise exception 'ADS_CAMPAIGN_MERCHANT_NOT_ACTIVE' using errcode='22023';
     end if;
     if not exists(select 1 from public.merchant_business_details d
       where d.merchant_id=p_merchant and btrim(d.city)=v.target_city
         and upper(btrim(d.state))=v.target_state) then
       raise exception 'ADS_CAMPAIGN_CITY_CHANGED' using errcode='22023';
     end if;
     if not exists(select 1 from public.catalog_items ci
       join public.product_delivery_profiles pr on pr.product_code=ci.product_code
         and pr.active
       where ci.merchant_id=p_merchant and ci.active
         and (v.category_key='all' or pr.category_key=v.category_key)) then
       raise exception 'ADS_CAMPAIGN_ACTIVE_CATALOG_REQUIRED' using errcode='22023';
     end if;
     update public.merchant_ads_campaigns_v1_233
       set status='submitted',submitted_at=v_now,version=version+1,
         updated_by=p_actor,updated_at=v_now
       where merchant_id=p_merchant;
     v_event:='submitted';
   elsif p_action='withdraw' then
     if v.status not in ('submitted','approved_creative','needs_changes','draft') then
       raise exception 'ADS_CAMPAIGN_WITHDRAW_STATE' using errcode='23514';
     end if;
     update public.merchant_ads_campaigns_v1_233
       set status='withdrawn',version=version+1,
         updated_by=p_actor,updated_at=v_now
       where merchant_id=p_merchant;
     v_event:='withdrawn';
   end if;
 end if;
 select * into v from public.merchant_ads_campaigns_v1_233 where merchant_id=p_merchant;
 insert into public.merchant_ads_campaign_events_v1_233
  (request_id,merchant_id,actor_user_id,event,request_hash,version)
 values(p_request,p_merchant,p_actor,v_event,v_hash,v.version);
 return jsonb_build_object('source','merchant_ads_campaign_v1_233',
   'merchantId',p_merchant,'campaign',to_jsonb(v)-'updated_by'-'reviewed_by',
   'idempotent',false,'readOnly',false,'noCharge',true,'adsLive',false);
end;
$fn$;
revoke all on function ads_internal_v1_233.merchant_campaign(uuid,uuid,text,uuid,text,text,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function ads_internal_v1_233.merchant_campaign(uuid,uuid,text,uuid,text,text,text,integer)
 to service_role;

create or replace function public.merchant_ads_campaign_v1_233(
 p_actor uuid,p_merchant uuid,p_action text,p_request uuid default null,
 p_title text default null,p_description text default null,p_category text default null,
 p_version integer default null
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select ads_internal_v1_233.merchant_campaign($1,$2,$3,$4,$5,$6,$7,$8)
$wrapper$;
revoke all on function public.merchant_ads_campaign_v1_233(uuid,uuid,text,uuid,text,text,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.merchant_ads_campaign_v1_233(uuid,uuid,text,uuid,text,text,text,integer)
 to service_role;

create or replace function public.admin_ads_campaign_queue_v1_233(p_actor uuid)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare v_count bigint; v_rows jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role in ('superadmin','operations','compliance','finance','readonly')) then
   raise exception 'ADS_CAMPAIGN_ADMIN_DENIED' using errcode='42501';
 end if;
 select count(*) into v_count from public.merchant_ads_campaigns_v1_233
   where status='submitted';
 select coalesce(jsonb_agg(jsonb_build_object(
    'merchantId',c.merchant_id,'companyName',left(m.name,120),
    'title',c.title,'description',c.description,'category',c.category_key,
    'city',c.target_city,'state',c.target_state,'status',c.status,
    'version',c.version,'submittedAt',c.submitted_at,
    'reviewNote',c.review_note,'updatedAt',c.updated_at)
    order by c.updated_at desc,c.merchant_id),'[]'::jsonb)
 into v_rows
 from (select * from public.merchant_ads_campaigns_v1_233
   order by case when status='submitted' then 0 else 1 end,
     updated_at desc,merchant_id desc limit 50) c
 join public.merchants m on m.id=c.merchant_id;
 return jsonb_build_object('source','admin_ads_campaign_queue_v1_233',
   'submittedCount',v_count,'rows',v_rows,'noCharge',true,'adsLive',false);
end;
$fn$;
revoke all on function public.admin_ads_campaign_queue_v1_233(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_campaign_queue_v1_233(uuid) to service_role;

create or replace function ads_internal_v1_233.review_campaign(
 p_actor uuid,p_merchant uuid,p_request uuid,p_version integer,
 p_decision text,p_note text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 c public.merchant_ads_campaigns_v1_233%rowtype;
 e public.merchant_ads_campaign_events_v1_233%rowtype;
 v_note text:=btrim(coalesce(p_note,''));
 v_hash text;
 v_now timestamptz:=clock_timestamp();
 v_decision text;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
    and a.active and a.admin_role in ('superadmin','compliance')) then
   raise exception 'ADS_CAMPAIGN_REVIEW_DENIED' using errcode='42501';
 end if;
 if p_request is null or p_decision not in ('approved_creative','needs_changes')
    or p_decision is null or char_length(v_note) not between 12 and 500 then
   raise exception 'ADS_CAMPAIGN_REVIEW_INVALID' using errcode='22023';
 end if;
 v_hash:=md5(jsonb_build_object('merchant',p_merchant,'version',p_version,
   'decision',p_decision,'note',v_note)::text);
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('ads-campaign:'||p_merchant::text,233));
 select * into e from public.merchant_ads_campaign_events_v1_233 where request_id=p_request;
 if found then
   if e.merchant_id is distinct from p_merchant or e.actor_user_id is distinct from p_actor
     or e.request_hash is distinct from v_hash or e.event<>p_decision then
     raise exception 'ADS_CAMPAIGN_REQUEST_REUSED' using errcode='23505';
   end if;
   return jsonb_build_object('recorded',true,'idempotent',true,
      'noCharge',true,'adsLive',false);
 end if;
 select * into c from public.merchant_ads_campaigns_v1_233 where merchant_id=p_merchant;
 if not found or c.status<>'submitted' then
   raise exception 'ADS_CAMPAIGN_NOT_SUBMITTED' using errcode='22023';
 end if;
 if c.version is distinct from p_version then
   raise exception 'ADS_CAMPAIGN_VERSION_CONFLICT' using errcode='40001';
 end if;
 if p_decision='approved_creative' and
    (not exists(select 1 from public.merchants m
     where m.id=p_merchant and m.status='active')
    or not exists(select 1 from public.merchant_ads_interest_v1_232 i
     where i.merchant_id=p_merchant and i.interested)
    or not exists(select 1 from public.merchant_business_details d
     where d.merchant_id=p_merchant and btrim(d.city)=c.target_city
       and upper(btrim(d.state))=c.target_state)
    or not exists(select 1 from public.catalog_items ci
      join public.product_delivery_profiles p on p.product_code=ci.product_code and p.active
      where ci.merchant_id=p_merchant and ci.active
        and (c.category_key='all' or p.category_key=c.category_key))) then
   raise exception 'ADS_CAMPAIGN_EVIDENCE_STALE' using errcode='22023';
 end if;
 update public.merchant_ads_campaigns_v1_233
   set status=p_decision,version=version+1,reviewed_by=p_actor,reviewed_at=v_now,
       review_note=v_note,updated_at=v_now,updated_by=p_actor
   where merchant_id=p_merchant;
 select * into c from public.merchant_ads_campaigns_v1_233 where merchant_id=p_merchant;
 insert into public.merchant_ads_campaign_events_v1_233
   (request_id,merchant_id,actor_user_id,event,request_hash,version,note)
 values(p_request,p_merchant,p_actor,p_decision,v_hash,c.version,v_note);
 return jsonb_build_object('recorded',true,'idempotent',false,
     'version',c.version,'status',c.status,'noCharge',true,'adsLive',false);
end;
$fn$;
revoke all on function ads_internal_v1_233.review_campaign(uuid,uuid,uuid,integer,text,text)
 from public,anon,authenticated,service_role;
grant execute on function ads_internal_v1_233.review_campaign(uuid,uuid,uuid,integer,text,text)
 to service_role;

create or replace function public.admin_ads_campaign_review_v1_233(
 p_actor uuid,p_merchant uuid,p_request uuid,p_version integer,p_decision text,p_note text
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select ads_internal_v1_233.review_campaign($1,$2,$3,$4,$5,$6)
$wrapper$;
revoke all on function public.admin_ads_campaign_review_v1_233(uuid,uuid,uuid,integer,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_campaign_review_v1_233(uuid,uuid,uuid,integer,text,text)
 to service_role;

do $acl$
begin
 if has_table_privilege('anon','public.merchant_ads_campaigns_v1_233','SELECT')
 or has_table_privilege('authenticated','public.merchant_ads_campaigns_v1_233','UPDATE')
 or has_table_privilege('service_role','public.merchant_ads_campaigns_v1_233','INSERT')
 or has_table_privilege('service_role','public.merchant_ads_campaign_events_v1_233','INSERT')
 or has_function_privilege('authenticated',
    'public.merchant_ads_campaign_v1_233(uuid,uuid,text,uuid,text,text,text,integer)','EXECUTE')
 or has_function_privilege('anon',
    'public.admin_ads_campaign_review_v1_233(uuid,uuid,uuid,integer,text,text)','EXECUTE')
 or not has_function_privilege('service_role',
    'public.admin_ads_campaign_queue_v1_233(uuid)','EXECUTE')
 then
   raise exception 'ADS_CAMPAIGN_ACL_DRIFT' using errcode='42501';
 end if;
end;
$acl$;