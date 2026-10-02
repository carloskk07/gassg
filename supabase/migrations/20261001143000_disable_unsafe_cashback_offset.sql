-- Chama São Gabriel — disable unsafe cashback offset v1.14.1
-- Do not allow "offset" until a dedicated net-settlement authority records
-- both sides and any residual cash movement atomically.

alter table public.merchant_cashback_reimbursements
  drop constraint if exists merchant_cashback_reimbursements_status_check;

alter table public.merchant_cashback_reimbursements
  add constraint merchant_cashback_reimbursements_status_check
  check (status in ('open','paid','reversed'));

alter table public.merchant_cashback_reimbursements
  drop constraint if exists merchant_cashback_reimbursements_check1;

create or replace function public.admin_financial_action(
  p_actor_user_id uuid,
  p_kind text,
  p_target_id uuid,
  p_action text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_reference is not null
     and (char_length(trim(p_reference))<2 or char_length(trim(p_reference))>240) then
    raise exception 'INVALID_REFERENCE' using errcode='22023';
  end if;

  if p_kind='platform_receivable' then
    if p_action not in ('paid','waived') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.platform_receivables
    set status=p_action,
        paid_at=case when p_action='paid' then clock_timestamp() else paid_at end,
        waived_at=case when p_action='waived' then clock_timestamp() else waived_at end,
        updated_at=clock_timestamp()
    where order_id=p_target_id
      and status='open'
    returning to_jsonb(platform_receivables.*) into v_row;

  elsif p_kind='cashback_reimbursement' then
    if p_action<>'paid' then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.merchant_cashback_reimbursements
    set status='paid',
        paid_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where order_id=p_target_id
      and status='open'
    returning to_jsonb(merchant_cashback_reimbursements.*) into v_row;

  elsif p_kind='settlement_adjustment' then
    if p_action not in ('paid','waived') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.platform_settlement_adjustments
    set status=p_action,
        settled_at=case when p_action='paid' then clock_timestamp() else settled_at end
    where id=p_target_id
      and status='open'
    returning to_jsonb(platform_settlement_adjustments.*) into v_row;

  else
    raise exception 'INVALID_FINANCIAL_KIND' using errcode='22023';
  end if;

  if v_row is null then
    raise exception 'FINANCIAL_ITEM_NOT_OPEN' using errcode='40001';
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'financial_'||p_action,p_kind,p_target_id::text,
    jsonb_build_object('reference',p_reference,'result',v_row)
  );

  return jsonb_build_object(
    'ok',true,
    'kind',p_kind,
    'action',p_action,
    'item',v_row
  );
end;
$$;

revoke all on function public.admin_financial_action(uuid,text,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.admin_financial_action(uuid,text,uuid,text,text)
to service_role;
