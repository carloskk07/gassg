-- TAMÃO v1.56 — first-party prelaunch analytics.
-- Daily aggregate campaign counters without persistent analytics identifiers.

create table if not exists public.prelaunch_marketing_event_daily (
  bucket_key text primary key check (bucket_key ~ '^[0-9a-f]{64}$'),
  event_date date not null,
  event_type text not null check (event_type in ('landing_view','lead_form_view')),
  audience text not null check (audience in ('customer','merchant')),
  source text not null default '' check (char_length(source) <= 80),
  medium text not null default '' check (char_length(medium) <= 80),
  campaign text not null default '' check (char_length(campaign) <= 120),
  content text not null default '' check (char_length(content) <= 120),
  landing_path text not null default '' check (char_length(landing_path) <= 240),
  referrer_host text not null default '' check (char_length(referrer_host) <= 253),
  event_count bigint not null default 1 check (event_count between 1 and 1000000000000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists prelaunch_marketing_event_daily_date_idx
  on public.prelaunch_marketing_event_daily(event_date desc,event_type,audience);
create index if not exists prelaunch_marketing_event_daily_campaign_idx
  on public.prelaunch_marketing_event_daily(event_date desc,source,medium,campaign);

alter table public.prelaunch_marketing_event_daily enable row level security;
revoke all on table public.prelaunch_marketing_event_daily from public, anon, authenticated;
grant all on table public.prelaunch_marketing_event_daily to service_role;

create or replace function public.record_prelaunch_marketing_event(
  p_event_type text,
  p_audience text,
  p_source text,
  p_medium text,
  p_campaign text,
  p_content text,
  p_landing_path text,
  p_referrer_host text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'pg_catalog'
as $$
declare
  v_date date;
  v_source text;
  v_medium text;
  v_campaign text;
  v_content text;
  v_landing_path text;
  v_referrer_host text;
  v_bucket_key text;
  v_count bigint;
begin
  if p_event_type not in ('landing_view','lead_form_view') then
    raise exception 'INVALID_MARKETING_EVENT_TYPE' using errcode='22023';
  end if;
  if p_audience not in ('customer','merchant') then
    raise exception 'INVALID_MARKETING_AUDIENCE' using errcode='22023';
  end if;

  v_source:=left(trim(coalesce(p_source,'')),80);
  v_medium:=left(trim(coalesce(p_medium,'')),80);
  v_campaign:=left(trim(coalesce(p_campaign,'')),120);
  v_content:=left(trim(coalesce(p_content,'')),120);
  v_landing_path:=left(trim(coalesce(p_landing_path,'')),240);
  v_referrer_host:=lower(left(trim(coalesce(p_referrer_host,'')),253));

  if v_landing_path<>'' and v_landing_path !~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*(#[A-Za-z0-9_-]{1,80})?$' then
    raise exception 'INVALID_MARKETING_LANDING_PATH' using errcode='22023';
  end if;
  if v_referrer_host<>'' and v_referrer_host !~ '^[A-Za-z0-9.-]+$' then
    raise exception 'INVALID_MARKETING_REFERRER_HOST' using errcode='22023';
  end if;

  v_date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  v_bucket_key:=encode(
    extensions.digest(
      jsonb_build_array(
        v_date,p_event_type,p_audience,v_source,v_medium,v_campaign,v_content,v_landing_path,v_referrer_host
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.prelaunch_marketing_event_daily(
    bucket_key,event_date,event_type,audience,source,medium,campaign,content,landing_path,referrer_host,event_count
  )
  values(
    v_bucket_key,v_date,p_event_type,p_audience,v_source,v_medium,v_campaign,v_content,v_landing_path,v_referrer_host,1
  )
  on conflict(bucket_key) do update set
    event_count=public.prelaunch_marketing_event_daily.event_count+1,
    updated_at=clock_timestamp()
  where public.prelaunch_marketing_event_daily.event_date=excluded.event_date
    and public.prelaunch_marketing_event_daily.event_type=excluded.event_type
    and public.prelaunch_marketing_event_daily.audience=excluded.audience
    and public.prelaunch_marketing_event_daily.source=excluded.source
    and public.prelaunch_marketing_event_daily.medium=excluded.medium
    and public.prelaunch_marketing_event_daily.campaign=excluded.campaign
    and public.prelaunch_marketing_event_daily.content=excluded.content
    and public.prelaunch_marketing_event_daily.landing_path=excluded.landing_path
    and public.prelaunch_marketing_event_daily.referrer_host=excluded.referrer_host
  returning event_count into v_count;

  if v_count is null then
    raise exception 'MARKETING_EVENT_BUCKET_COLLISION' using errcode='23505';
  end if;

  return jsonb_build_object('ok',true,'eventDate',v_date,'count',v_count);
end;
$$;

revoke all on function public.record_prelaunch_marketing_event(text,text,text,text,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.record_prelaunch_marketing_event(text,text,text,text,text,text,text,text)
to service_role;

create or replace function public.admin_prelaunch_acquisition_metrics(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  with lead_base as (
    select
      lead_type as audience,
      coalesce(nullif(trim(source),''),'direto') as source,
      coalesce(nullif(trim(medium),''),'sem_medium') as medium,
      coalesce(nullif(trim(campaign),''),'sem_campanha') as campaign,
      coalesce(nullif(trim(content),''),'sem_conteudo') as content,
      status,created_at,contacted_at,qualified_at,converted_at,closed_at
    from public.prelaunch_leads
  ),
  event_base as (
    select
      audience,
      coalesce(nullif(trim(source),''),'direto') as source,
      coalesce(nullif(trim(medium),''),'sem_medium') as medium,
      coalesce(nullif(trim(campaign),''),'sem_campanha') as campaign,
      coalesce(nullif(trim(content),''),'sem_conteudo') as content,
      event_type,event_count
    from public.prelaunch_marketing_event_daily
  ),
  totals as (
    select
      count(*)::int as total,
      count(*) filter (where audience='customer')::int as customers,
      count(*) filter (where audience='merchant')::int as merchants,
      count(*) filter (where status='new')::int as new_count,
      count(*) filter (where contacted_at is not null)::int as contacted,
      count(*) filter (where qualified_at is not null)::int as qualified,
      count(*) filter (where converted_at is not null)::int as converted,
      count(*) filter (where status='closed')::int as closed,
      count(*) filter (where status='new' and created_at<=clock_timestamp()-interval '24 hours')::int as stale_new_24h,
      count(*) filter (where created_at>=date_trunc('day',clock_timestamp())-interval '6 days')::int as last_7d,
      count(*) filter (where created_at>=date_trunc('day',clock_timestamp())-interval '29 days')::int as last_30d,
      round(avg(extract(epoch from (contacted_at-created_at))/60.0)
        filter (where contacted_at is not null and contacted_at>=created_at)::numeric,1) as avg_first_contact_minutes,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (contacted_at-created_at))/60.0
      ) filter (where contacted_at is not null and contacted_at>=created_at)::numeric,1) as median_first_contact_minutes
    from lead_base
  ),
  event_totals as (
    select
      coalesce(sum(event_count) filter (where event_type='landing_view'),0)::bigint as landing_views,
      coalesce(sum(event_count) filter (where event_type='lead_form_view'),0)::bigint as form_views
    from event_base
  ),
  lead_campaign as (
    select audience,source,medium,campaign,content,
      count(*)::int as total,
      count(*) filter (where contacted_at is not null)::int as contacted,
      count(*) filter (where qualified_at is not null)::int as qualified,
      count(*) filter (where converted_at is not null)::int as converted,
      count(*) filter (where status='closed')::int as closed,
      round(avg(extract(epoch from (contacted_at-created_at))/60.0)
        filter (where contacted_at is not null and contacted_at>=created_at)::numeric,1) as avg_first_contact_minutes
    from lead_base
    group by audience,source,medium,campaign,content
  ),
  event_campaign as (
    select audience,source,medium,campaign,content,
      coalesce(sum(event_count) filter (where event_type='landing_view'),0)::bigint as landing_views,
      coalesce(sum(event_count) filter (where event_type='lead_form_view'),0)::bigint as form_views
    from event_base
    group by audience,source,medium,campaign,content
  ),
  joined_campaign as (
    select
      coalesce(l.audience,e.audience) as audience,
      coalesce(l.source,e.source) as source,
      coalesce(l.medium,e.medium) as medium,
      coalesce(l.campaign,e.campaign) as campaign,
      coalesce(l.content,e.content) as content,
      coalesce(e.landing_views,0)::bigint as landing_views,
      coalesce(e.form_views,0)::bigint as form_views,
      coalesce(l.total,0)::int as total,
      coalesce(l.contacted,0)::int as contacted,
      coalesce(l.qualified,0)::int as qualified,
      coalesce(l.converted,0)::int as converted,
      coalesce(l.closed,0)::int as closed,
      l.avg_first_contact_minutes
    from lead_campaign l
    full outer join event_campaign e
      on e.audience=l.audience
      and e.source=l.source
      and e.medium=l.medium
      and e.campaign=l.campaign
      and e.content=l.content
  ),
  campaign_top as (
    select * from joined_campaign
    order by landing_views desc,total desc,converted desc,qualified desc,source,campaign,content
    limit 30
  ),
  campaign_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'audience',audience,'source',source,'medium',medium,'campaign',campaign,'content',content,
          'landingViews',landing_views,'formViews',form_views,'total',total,'contacted',contacted,
          'qualified',qualified,'converted',converted,'closed',closed,
          'landingToFormPct',coalesce(round((100.0*form_views/nullif(landing_views,0))::numeric,1),0),
          'landingToLeadPct',coalesce(round((100.0*total/nullif(landing_views,0))::numeric,1),0),
          'formToLeadPct',coalesce(round((100.0*total/nullif(form_views,0))::numeric,1),0),
          'contactRatePct',coalesce(round((100.0*contacted/nullif(total,0))::numeric,1),0),
          'qualificationRatePct',coalesce(round((100.0*qualified/nullif(total,0))::numeric,1),0),
          'conversionRatePct',coalesce(round((100.0*converted/nullif(total,0))::numeric,1),0),
          'avgFirstContactMinutes',avg_first_contact_minutes
        )
        order by landing_views desc,total desc,converted desc,qualified desc,source,campaign,content
      ),
      '[]'::jsonb
    ) as items
    from campaign_top
  )
  select jsonb_build_object(
    'generatedAt',clock_timestamp(),
    'landingViews',e.landing_views,
    'formViews',e.form_views,
    'total',t.total,
    'customers',t.customers,
    'merchants',t.merchants,
    'new',t.new_count,
    'contacted',t.contacted,
    'qualified',t.qualified,
    'converted',t.converted,
    'closed',t.closed,
    'staleNew24h',t.stale_new_24h,
    'last7d',t.last_7d,
    'last30d',t.last_30d,
    'landingToFormPct',coalesce(round((100.0*e.form_views/nullif(e.landing_views,0))::numeric,1),0),
    'landingToLeadPct',coalesce(round((100.0*t.total/nullif(e.landing_views,0))::numeric,1),0),
    'formToLeadPct',coalesce(round((100.0*t.total/nullif(e.form_views,0))::numeric,1),0),
    'contactRatePct',coalesce(round((100.0*t.contacted/nullif(t.total,0))::numeric,1),0),
    'qualificationRatePct',coalesce(round((100.0*t.qualified/nullif(t.total,0))::numeric,1),0),
    'conversionRatePct',coalesce(round((100.0*t.converted/nullif(t.total,0))::numeric,1),0),
    'qualifiedToConvertedPct',coalesce(round((100.0*t.converted/nullif(t.qualified,0))::numeric,1),0),
    'avgFirstContactMinutes',t.avg_first_contact_minutes,
    'medianFirstContactMinutes',t.median_first_contact_minutes,
    'campaigns',c.items
  )
  into v_result
  from totals t
  cross join event_totals e
  cross join campaign_json c;

  return v_result;
end;
$$;

revoke all on function public.admin_prelaunch_acquisition_metrics(uuid)
from public, anon, authenticated;
grant execute on function public.admin_prelaunch_acquisition_metrics(uuid)
to service_role;
