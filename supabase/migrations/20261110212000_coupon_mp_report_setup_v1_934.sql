-- V1.934: hard cap on external MP report-configuration mutations.
-- Only service_role machine can claim; this never touches invoices or credits.
create table if not exists public.clube_coupon_mp_report_setup_claims_v1_934(
 action text primary key check(action in ('create_config','enable_schedule')),
 claimed_at timestamptz not null default clock_timestamp()
);
alter table public.clube_coupon_mp_report_setup_claims_v1_934 enable row level security;
revoke all on public.clube_coupon_mp_report_setup_claims_v1_934 from public,anon,authenticated;
grant select,insert,update on public.clube_coupon_mp_report_setup_claims_v1_934 to service_role;

create or replace function public.clube_coupon_mp_report_setup_claim_v1_934(p_action text)
returns boolean language plpgsql security invoker set search_path=pg_catalog
as $fn$
declare v_claim text;
begin
 if p_action not in ('create_config','enable_schedule') then
  return false;
 end if;
 if not exists(select 1 from public.clube_coupon_net_auto_config_v1_931 c where c.id=true and c.enabled)
    or not exists(select 1 from public.clube_coupon_paid_invoices i
      where i.status='paid' and i.paid_at is not null
        and i.net_proceeds_verified_at is null) then
  return false;
 end if;
 insert into public.clube_coupon_mp_report_setup_claims_v1_934(action,claimed_at)
 values(p_action,clock_timestamp())
 on conflict(action) do update set claimed_at=excluded.claimed_at
 where public.clube_coupon_mp_report_setup_claims_v1_934.claimed_at <
   clock_timestamp()-interval '24 hours'
 returning action into v_claim;
 return v_claim=p_action;
end $fn$;
revoke all on function public.clube_coupon_mp_report_setup_claim_v1_934(text)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_mp_report_setup_claim_v1_934(text)
 to service_role;
