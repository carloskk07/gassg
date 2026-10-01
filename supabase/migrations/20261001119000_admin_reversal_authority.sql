-- Chama São Gabriel — atomic admin reversal authority v1.7.1

create or replace function public.admin_reverse_settled_order(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_reason text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  v_result:=public.reverse_settled_order_financials(
    p_order_id,
    p_reason,
    p_reference
  );

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'order_financial_reversed',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'reason',p_reason,
      'reference',p_reference,
      'result',v_result
    )
  );

  return v_result;
end;
$$;

revoke all on function public.admin_reverse_settled_order(uuid,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.admin_reverse_settled_order(uuid,uuid,text,text)
to service_role;
