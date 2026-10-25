-- TAMÃO: Prevent manually writing paid for coupon-backed merchant reimbursements.
-- No new finance tables or payout paths. Existing RPC and ACL preserved.
-- Until recipient account ownership and an independent PSP/bank credit are
-- validated, coupon-backed reimbursement stays OPEN (no false "paid").
-- Normal non-coupon reimbursement and receivable paths are unchanged.
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
  v_reference text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  v_reference:=nullif(trim(p_reference),'');

  if v_reference is null
     or char_length(v_reference)<3
     or char_length(v_reference)>240 then
    raise exception 'FINANCIAL_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  if p_kind='platform_receivable' then
    if p_action not in ('paid','waived') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.platform_receivables
    set status=p_action,
        paid_at=case when p_action='paid' then clock_timestamp() else null end,
        waived_at=case when p_action='waived' then clock_timestamp() else null end,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where order_id=p_target_id
      and status='open'
    returning to_jsonb(platform_receivables.*) into v_row;

  elsif p_kind='cashback_reimbursement' then
    if p_action<>'paid' then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    -- A coupon-backed order carries a financed merchant obligation.
    -- A manual reference is not a verified bank/PSP payout to the
    -- merchant. Do not allow service-role/Admin or direct RPC callers
    -- to turn that liability into a fictitious external payment.
    -- Preserve legacy manual settlement for orders WITHOUT paid coupons.
    if exists (
      select 1 from public.clube_coupon_paid_order_applications
      where order_id=p_target_id
    ) then
      raise exception 'COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED'
        using errcode='P0001';
    end if;

    update public.merchant_cashback_reimbursements
    set status='paid',
        paid_at=clock_timestamp(),
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
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
        settled_at=clock_timestamp(),
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference
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
    jsonb_build_object('reference',v_reference,'result',v_row)
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
