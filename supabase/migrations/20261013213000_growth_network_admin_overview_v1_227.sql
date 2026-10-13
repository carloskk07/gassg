-- TAMÃO V1.227 — admin acquisition analytics for attributed network leads.
-- Read-only; no wallet, fee, commission or payment mutation. CRM conversions
-- are admin-stage marks and MUST NOT be presented as settled orders.
create or replace function public.admin_growth_network_overview_v1_227(
  p_actor_user_id uuid
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog
as $fn$
declare
  v_total bigint:=0;
  v_from_customer bigint:=0;
  v_from_merchant bigint:=0;
  v_customer_leads bigint:=0;
  v_merchant_leads bigint:=0;
  v_crm_converted bigint:=0;
  v_recent bigint:=0;
  v_inviting_merchants bigint:=0;
  v_rows jsonb:='[]'::jsonb;
begin
  if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations','readonly','compliance')) then
    raise exception 'ADMIN_GROWTH_PERMISSION_DENIED' using errcode='42501';
  end if;
  select count(*)::bigint,
    count(*) filter(where a.inviter_kind='customer')::bigint,
    count(*) filter(where a.inviter_kind='merchant')::bigint,
    count(*) filter(where l.lead_type='customer')::bigint,
    count(*) filter(where l.lead_type='merchant')::bigint,
    count(*) filter(where l.status='converted')::bigint,
    count(*) filter(where a.attributed_at>=clock_timestamp()-interval '30 days')::bigint
  into v_total,v_from_customer,v_from_merchant,v_customer_leads,
       v_merchant_leads,v_crm_converted,v_recent
  from public.growth_lead_attributions_v1_226 a
    join public.prelaunch_leads l on l.id=a.lead_id;
  select count(*)::bigint into v_inviting_merchants
    from public.growth_merchant_invites_v1_226;
  select coalesce(jsonb_agg(jsonb_build_object(
    'merchantId',x.merchant_id,'name',x.name,'customerInterests',x.customers,
    'merchantInterests',x.merchants,'crmConvertedLeads',x.crm_converted,
    'lastAttributedAt',x.last_attributed_at
  ) order by x.total desc,x.name asc),'[]'::jsonb)
  into v_rows
  from (
    select a.inviter_merchant_id as merchant_id,
      m.name as name,
      count(*) as total,
      count(*) filter(where l.lead_type='customer') as customers,
      count(*) filter(where l.lead_type='merchant') as merchants,
      count(*) filter(where l.status='converted') as crm_converted,
      max(a.attributed_at) as last_attributed_at
    from public.growth_lead_attributions_v1_226 a
    join public.prelaunch_leads l on l.id=a.lead_id
    join public.merchants m on m.id=a.inviter_merchant_id
    where a.inviter_kind='merchant'
    group by a.inviter_merchant_id,m.name
    order by count(*) desc,m.name asc
    limit 12
  ) x;
  return jsonb_build_object(
    'source','growth_network_server_v1_227',
    'readOnly',true,'noPayout',true,'noPersonalData',true,
    'leadScope','consented_prelaunch_leads_only',
    'crmConversionIsNotOrderSettlement',true,
    'attributedLeads',v_total,
    'customerInvitedLeads',v_from_customer,
    'merchantInvitedLeads',v_from_merchant,
    'customerInterests',v_customer_leads,
    'merchantInterests',v_merchant_leads,
    'crmConvertedLeads',v_crm_converted,
    'last30d',v_recent,
    'merchantsWithInviteCode',v_inviting_merchants,
    'merchantBreakdown',v_rows
  );
end;
$fn$;
revoke all on function public.admin_growth_network_overview_v1_227(uuid)
  from public,anon,authenticated;
grant execute on function public.admin_growth_network_overview_v1_227(uuid)
  to service_role;
