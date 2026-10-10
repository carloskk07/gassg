-- V1.154: commercial prospect CRM and objective city opportunity radar.
-- Neither a CRM transition nor a score changes actual selling eligibility.
alter table public.anp_glp_prospects
  add column if not exists crm_version integer not null default 0,
  add column if not exists follow_up_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists contact_attempts integer not null default 0
    check(contact_attempts>=0),
  add column if not exists last_handled_by uuid;
create index if not exists anp_glp_prospects_followup_idx
  on public.anp_glp_prospects(follow_up_at,prospect_status)
  where follow_up_at is not null
    and prospect_status not in ('dismissed','partner');

create or replace function public.admin_update_anp_prospect(
 p_actor_user_id uuid,
 p_cnpj text,
 p_expected_version integer,
 p_next_status text,
 p_note text,
 p_follow_up_at timestamptz,
 p_contact_channel text
)
returns jsonb
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
 v_previous public.anp_glp_prospects%rowtype;
 v_next public.anp_glp_prospects%rowtype;
 v_note text:=trim(coalesce(p_note,''));
 v_channel text:=nullif(trim(coalesce(p_contact_channel,'')),'');
begin
 if not exists (
    select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations','compliance')
 ) then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;

 if p_cnpj !~ '^[0-9]{14}$' or p_expected_version is null or p_expected_version<0
   or p_next_status not in ('uncontacted','contacted','interested','onboarding','partner','dismissed')
   or length(v_note)<5 or length(v_note)>1000
   or (v_channel is not null and v_channel not in ('phone','whatsapp','email','in_person'))
   or (p_follow_up_at is not null and (p_follow_up_at<statement_timestamp()-interval '1 day'
      or p_follow_up_at>statement_timestamp()+interval '365 days'))
 then raise exception 'INVALID_PROSPECT_CHANGE' using errcode='22023'; end if;

 select * into v_previous from public.anp_glp_prospects
  where cnpj=p_cnpj for update;
 if not found then raise exception 'PROSPECT_NOT_FOUND' using errcode='P0002'; end if;
 if v_previous.crm_version<>p_expected_version then
   raise exception 'PROSPECT_VERSION_CONFLICT' using errcode='40001';
 end if;
 if p_next_status='partner' and not exists(
   select 1 from public.merchants m
   join public.merchant_business_details d on d.merchant_id=m.id
   where regexp_replace(m.cnpj,'[^0-9]','','g')=p_cnpj
     and m.status='active'
     and upper(trim(d.state))=v_previous.state
     and public.market_city_key(d.city)=v_previous.city_key
 ) then
   raise exception 'PROSPECT_PARTNER_NOT_VERIFIED' using errcode='42501';
 end if;
 -- A contact is only recorded after an operator has made it. No WhatsApp send here.
 if v_channel is not null and p_next_status in ('uncontacted','dismissed') then
   raise exception 'INVALID_CONTACT_EVENT' using errcode='22023';
 end if;

 update public.anp_glp_prospects p
 set prospect_status=p_next_status, notes=v_note,follow_up_at=p_follow_up_at,
     crm_version=crm_version+1,last_handled_by=p_actor_user_id,
     last_contacted_at=case when v_channel is not null then clock_timestamp()
                            else last_contacted_at end,
     contact_attempts=contact_attempts+case when v_channel is not null then 1 else 0 end,
     updated_at=clock_timestamp()
 where p.cnpj=p_cnpj
 returning * into v_next;

 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor_user_id,'anp-prospect-crm','anp_glp_prospect',p_cnpj,
   jsonb_build_object('city',v_next.city_name,'state',v_next.state,
     'previous_status',v_previous.prospect_status,'next_status',p_next_status,
     'previous_version',v_previous.crm_version,'version',v_next.crm_version,
     'contact_channel',v_channel,'follow_up_at',v_next.follow_up_at,
     'note',v_note));
 return jsonb_build_object('cnpj',v_next.cnpj,'status',v_next.prospect_status,
  'version',v_next.crm_version,'followUpAt',v_next.follow_up_at,
  'contactAttempts',v_next.contact_attempts);
end;
$func$;
revoke all on function public.admin_update_anp_prospect(uuid,text,integer,text,text,timestamptz,text)
from public,anon,authenticated;
grant execute on function public.admin_update_anp_prospect(uuid,text,integer,text,text,timestamptz,text)
to service_role;

-- Aggregate first and only perform expensive live-eligibility checks for the ranked subset.
-- Priority is a transparent OPERATIONS index, never a claim of market size/revenue.
create or replace function public.admin_expansion_radar(p_limit integer default 60)
returns table(
  state text, city text, city_key text,
  interested_customers bigint, anp_prospects bigint, uncontacted bigint,
  contacted bigint, interested_prospects bigint, onboarding bigint,
  partners bigint, overdue_followups bigint, registered_merchants bigint,
  eligible_merchants integer, anp_source_status text, anp_checked_at timestamptz,
  priority_score integer, admin_paused boolean
)
language sql stable security definer
set search_path to pg_catalog
as $func$
with demands as (
 select i.state,public.market_city_key(i.city) as city_key,
   count(distinct i.lead_id)::bigint as interested_customers
 from public.market_city_interests i
 join public.prelaunch_leads l on l.id=i.lead_id
 where i.city is not null and i.state is not null
   and l.lead_type='customer' and l.consent_at is not null
   and l.status not in ('closed','converted')
 group by i.state,public.market_city_key(i.city)
),
prospects as (
 select p.state,p.city_key,
   count(*)::bigint as anp_prospects,
   count(*) filter(where p.prospect_status='uncontacted')::bigint as uncontacted,
   count(*) filter(where p.prospect_status='contacted')::bigint as contacted,
   count(*) filter(where p.prospect_status='interested')::bigint as interested_prospects,
   count(*) filter(where p.prospect_status='onboarding')::bigint as onboarding,
   count(*) filter(where p.prospect_status='partner')::bigint as partners,
   count(*) filter(where p.follow_up_at<=statement_timestamp()
      and p.prospect_status not in ('dismissed','partner'))::bigint as overdue_followups
 from public.anp_glp_prospects p
 group by p.state,p.city_key
),
registered as (
 select upper(trim(d.state)) as state, public.market_city_key(d.city) as city_key,
   count(distinct d.merchant_id)::bigint as registered_merchants
 from public.merchant_business_details d
 join public.merchants m on m.id=d.merchant_id
 group by upper(trim(d.state)),public.market_city_key(d.city)
),
ranked as (
 select c.state,c.city_name as city,c.city_key,
  coalesce(d.interested_customers,0)::bigint as interested_customers,
  coalesce(p.anp_prospects,0)::bigint as anp_prospects,
  coalesce(p.uncontacted,0)::bigint as uncontacted,
  coalesce(p.contacted,0)::bigint as contacted,
  coalesce(p.interested_prospects,0)::bigint as interested_prospects,
  coalesce(p.onboarding,0)::bigint as onboarding,
  coalesce(p.partners,0)::bigint as partners,
  coalesce(p.overdue_followups,0)::bigint as overdue_followups,
  coalesce(r.registered_merchants,0)::bigint as registered_merchants,
  coalesce(f.status,'not_checked') as anp_source_status,
  f.last_checked_at as anp_checked_at,
  (least(coalesce(d.interested_customers,0)*8,240)
    +least(coalesce(p.uncontacted,0)*2,120)
    +least(coalesce(p.interested_prospects,0)*12,240)
    +least(coalesce(p.onboarding,0)*16,240)
    +least(coalesce(p.overdue_followups,0)*6,60))::integer as priority_score,
  c.admin_paused
 from public.market_cities c
 left join demands d on d.state=c.state and d.city_key=c.city_key
 left join prospects p on p.state=c.state and p.city_key=c.city_key
 left join registered r on r.state=c.state and r.city_key=c.city_key
 left join public.anp_prospect_refreshes f on f.state=c.state and f.city_key=c.city_key
),
shortlist as (
 select * from ranked order by priority_score desc,interested_customers desc,state,city
 limit least(greatest(coalesce(p_limit,60),1),100)
)
select s.state,s.city,s.city_key,
 s.interested_customers,s.anp_prospects,s.uncontacted,s.contacted,
 s.interested_prospects,s.onboarding,s.partners,s.overdue_followups,
 s.registered_merchants,
 cardinality(public.market_city_offer_scope(s.city,s.state))::integer as eligible_merchants,
 s.anp_source_status,s.anp_checked_at,s.priority_score,s.admin_paused
from shortlist s
order by s.priority_score desc,s.interested_customers desc,s.state,s.city;
$func$;
revoke all on function public.admin_expansion_radar(integer)
from public,anon,authenticated;
grant execute on function public.admin_expansion_radar(integer) to service_role;
