-- Chama São Gabriel — remove legacy cashback offset from reversal v1.14.6
-- The offset state was retired. Financial reversal must reason only about
-- explicit paid reimbursements and create a compensating recovery adjustment.

create or replace function public.reverse_settled_order_financials(
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
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_receivable public.platform_receivables%rowtype;
  v_reimbursement public.merchant_cashback_reimbursements%rowtype;
  v_existing public.order_financial_reversals%rowtype;
  v_result jsonb;
begin
  if p_reason is null
     or char_length(trim(p_reason))<3
     or char_length(trim(p_reason))>240 then
    raise exception 'INVALID_REVERSAL_REASON' using errcode='22023';
  end if;

  if p_reference is not null
     and (char_length(trim(p_reference))<3 or char_length(trim(p_reference))>120) then
    raise exception 'INVALID_REVERSAL_REFERENCE' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('reward:'||p_order_id::text,0)
  );

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  select *
  into v_existing
  from public.order_financial_reversals
  where order_id=v_order.id;

  if found then
    return jsonb_build_object(
      'ok',true,
      'orderId',v_order.id,
      'financialState','reversed',
      'alreadyReversed',true,
      'reversedAt',v_existing.created_at
    );
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.settled_at is null then
    raise exception 'ORDER_NOT_REVERSIBLE' using errcode='40001';
  end if;

  insert into public.order_financial_reversals(order_id,reason,reference)
  values(v_order.id,trim(p_reason),nullif(trim(p_reference),''))
  returning * into v_existing;

  select *
  into v_grant
  from public.order_reward_grants
  where order_id=v_order.id
  for update;

  if found and v_grant.reversed_at is null then
    if v_grant.cashback_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_reversal',
        -v_grant.cashback_cents,
        'reversal:'||replace(v_order.id::text,'-','')||':cashback',
        jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
      )
      on conflict(idempotency_key) do nothing;
    end if;

    if v_grant.referral_pending_cents>0
       and v_grant.referrer_user_id is not null then
      if v_grant.matured_at is null then
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_pending',
          'referral_pending_release',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-pending',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      else
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_available',
          'referral_reversal',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-available',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      end if;
    end if;

    update public.order_reward_grants
    set reversed_at=clock_timestamp(),
        reversal_reason=trim(p_reason)
    where order_id=v_order.id
      and reversed_at is null;
  end if;

  update public.referrals
  set qualified_order_id=null
  where qualified_order_id=v_order.id;

  select *
  into v_receivable
  from public.platform_receivables
  where order_id=v_order.id
  for update;

  if found then
    if v_receivable.status='paid' and v_receivable.platform_fee_cents>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,amount_cents,status,reason,reference
      )
      values(
        v_order.id,v_receivable.merchant_id,'platform_fee_refund_due',
        'platform_owes_merchant',v_receivable.platform_fee_cents,
        'open',trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
    end if;

    update public.platform_receivables
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  select *
  into v_reimbursement
  from public.merchant_cashback_reimbursements
  where order_id=v_order.id
  for update;

  if found then
    if v_reimbursement.status='paid'
       and v_reimbursement.cashback_cents>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,amount_cents,
        status,reason,reference
      )
      values(
        v_order.id,v_reimbursement.merchant_id,
        'cashback_reimbursement_recovery_due','merchant_owes_platform',
        v_reimbursement.cashback_cents,'open',
        trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
    end if;

    update public.merchant_cashback_reimbursements
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  update public.orders
  set financial_state='reversed',
      financial_reversed_at=clock_timestamp(),
      financial_reversal_reason=trim(p_reason),
      financial_reversal_reference=nullif(trim(p_reference),''),
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,null,'system','FINANCIAL_REVERSED',
    'Liquidação financeira revertida',
    'Benefícios e recebíveis da plataforma foram estornados após confirmação da reversão.',
    jsonb_build_object(
      'reason',trim(p_reason),
      'reference',p_reference,
      'operationalStatus',v_order.status
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'financialState',v_order.financial_state,
    'version',v_order.version,
    'alreadyReversed',false,
    'reversedAt',v_order.financial_reversed_at
  );

  return v_result;
end;
$$;

revoke all on function public.reverse_settled_order_financials(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.reverse_settled_order_financials(uuid,text,text)
to postgres, service_role;
