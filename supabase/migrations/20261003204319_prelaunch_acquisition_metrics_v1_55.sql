-- TAMÃO v1.55 — aquisição mensurável sobre a base completa.
-- Agrega funil e campanhas sem transportar PII adicional ao navegador.

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

  with base as (
    select
      coalesce(nullif(trim(source),''),'direto') as source,
      coalesce(nullif(trim(medium),''),'sem_medium') as medium,
      coalesce(nullif(trim(campaign),''),'sem_campanha') as campaign,
      lead_type,
      status,
      created_at,
      contacted_at,
      qualified_at,
      converted_at,
      closed_at
    from public.prelaunch_leads
  ),
  totals as (
    select
      count(*)::int as total,
      count(*) filter (where lead_type='customer')::int as customers,
      count(*) filter (where lead_type='merchant')::int as merchants,
      count(*) filter (where status='new')::int as new_count,
      count(*) filter (where contacted_at is not null)::int as contacted,
      count(*) filter (where qualified_at is not null)::int as qualified,
      count(*) filter (where converted_at is not null)::int as converted,
      count(*) filter (where status='closed')::int as closed,
      count(*) filter (
        where status='new' and created_at <= clock_timestamp()-interval '24 hours'
      )::int as stale_new_24h,
      count(*) filter (
        where created_at >= date_trunc('day',clock_timestamp())-interval '6 days'
      )::int as last_7d,
      count(*) filter (
        where created_at >= date_trunc('day',clock_timestamp())-interval '29 days'
      )::int as last_30d,
      round(avg(extract(epoch from (contacted_at-created_at))/60.0)
        filter (where contacted_at is not null and contacted_at>=created_at)::numeric,1) as avg_first_contact_minutes,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (contacted_at-created_at))/60.0
      ) filter (where contacted_at is not null and contacted_at>=created_at)::numeric,1) as median_first_contact_minutes
    from base
  ),
  campaign_rows as (
    select
      source,
      medium,
      campaign,
      count(*)::int as total,
      count(*) filter (where lead_type='customer')::int as customers,
      count(*) filter (where lead_type='merchant')::int as merchants,
      count(*) filter (where contacted_at is not null)::int as contacted,
      count(*) filter (where qualified_at is not null)::int as qualified,
      count(*) filter (where converted_at is not null)::int as converted,
      count(*) filter (where status='closed')::int as closed,
      round(
        (100.0*count(*) filter (where contacted_at is not null)/nullif(count(*),0))::numeric,
        1
      ) as contact_rate_pct,
      round(
        (100.0*count(*) filter (where qualified_at is not null)/nullif(count(*),0))::numeric,
        1
      ) as qualification_rate_pct,
      round(
        (100.0*count(*) filter (where converted_at is not null)/nullif(count(*),0))::numeric,
        1
      ) as conversion_rate_pct,
      round(avg(extract(epoch from (contacted_at-created_at))/60.0)
        filter (where contacted_at is not null and contacted_at>=created_at)::numeric,1) as avg_first_contact_minutes
    from base
    group by source,medium,campaign
  ),
  campaign_top as (
    select *
    from campaign_rows
    order by total desc, converted desc, qualified desc, source, campaign
    limit 20
  ),
  campaign_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source',source,
          'medium',medium,
          'campaign',campaign,
          'total',total,
          'customers',customers,
          'merchants',merchants,
          'contacted',contacted,
          'qualified',qualified,
          'converted',converted,
          'closed',closed,
          'contactRatePct',contact_rate_pct,
          'qualificationRatePct',qualification_rate_pct,
          'conversionRatePct',conversion_rate_pct,
          'avgFirstContactMinutes',avg_first_contact_minutes
        )
        order by total desc,converted desc,qualified desc,source,campaign
      ),
      '[]'::jsonb
    ) as items
    from campaign_top
  )
  select jsonb_build_object(
    'generatedAt',clock_timestamp(),
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
  cross join campaign_json c;

  return v_result;
end;
$$;

revoke all on function public.admin_prelaunch_acquisition_metrics(uuid)
from public, anon, authenticated;
grant execute on function public.admin_prelaunch_acquisition_metrics(uuid)
to service_role;
