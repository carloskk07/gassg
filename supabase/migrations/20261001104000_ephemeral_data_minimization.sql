-- Chama São Gabriel — ephemeral data minimization v1.5.9

create or replace function public.process_data_retention()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_quotes integer:=0;
  v_actions integer:=0;
  v_pins integer:=0;
  v_rates integer:=0;
  v_requotes integer:=0;
begin
  delete from public.order_delivery_secrets s
  using public.orders o
  where o.id=s.order_id
    and o.status in ('SETTLED','CANCELLED')
    and o.updated_at<clock_timestamp()-interval '1 hour';
  get diagnostics v_pins=row_count;

  delete from public.quotes
  where expires_at<clock_timestamp()-interval '2 hours';
  get diagnostics v_quotes=row_count;

  delete from public.action_requests
  where coalesce(completed_at,created_at)<clock_timestamp()-interval '30 days';
  get diagnostics v_actions=row_count;

  delete from public.api_rate_limits
  where window_started_at<clock_timestamp()-interval '2 days';
  get diagnostics v_rates=row_count;

  delete from public.order_requote_items ri
  using public.orders o
  where o.id=ri.order_id
    and (
      o.status<>'REQUOTE_REQUIRED'
      or o.proposed_merchant_id is null
    );
  get diagnostics v_requotes=row_count;

  return jsonb_build_object(
    'quotesDeleted',v_quotes,
    'actionsDeleted',v_actions,
    'deliverySecretsDeleted',v_pins,
    'rateBucketsDeleted',v_rates,
    'requoteSnapshotsDeleted',v_requotes
  );
end;
$$;

revoke all on function public.process_data_retention()
from public, anon, authenticated;
grant execute on function public.process_data_retention()
to postgres, service_role;
