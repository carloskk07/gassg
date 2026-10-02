-- Chama São Gabriel — referral review reversal guard v1.9.3
-- A full financial reversal already clawed back referral value. A later
-- administrative review must never debit the same commission a second time.

create or replace function public.admin_review_referral_reward(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_review public.referral_reward_reviews%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_amount integer:=0;
  v_key text;
  v_bucket text;
  v_entry_type text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_decision not in ('approved','rejected') then
    raise exception 'INVALID_REFERRAL_REVIEW_DECISION' using errcode='22023';
  end if;

  if p_notes is not null and char_length(trim(p_notes))>1000 then
    raise exception 'NOTES_TOO_LONG' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('reward:'||p_order_id::text,0)
  );

  select *
  into v_review
  from public.referral_reward_reviews
  where order_id=p_order_id
  for update;

  if not found then
    raise exception 'REFERRAL_REVIEW_NOT_FOUND' using errcode='P0002';
  end if;

  if v_review.risk_status=p_decision then
    return jsonb_build_object(
      'ok',true,'orderId',p_order_id,'riskStatus',p_decision,'alreadyInState',true
    );
  end if;

  if v_review.risk_status in ('approved','rejected') then
    raise exception 'REFERRAL_REVIEW_ALREADY_FINAL' using errcode='40001';
  end if;

  select *
  into v_grant
  from public.order_reward_grants
  where order_id=p_order_id
  for update;

  if not found then
    raise exception 'REWARD_GRANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_grant.reversed_at is not null and p_decision='approved' then
    raise exception 'REFERRAL_REWARD_ALREADY_REVERSED' using errcode='40001';
  end if;

  if v_grant.reversed_at is not null then
    v_amount:=0;
  elsif p_decision='rejected' then
    v_amount:=v_grant.referral_pending_cents;

    if v_amount>0 then
      v_key:='referral-risk:'||replace(p_order_id::text,'-','')||':reject';

      if v_grant.matured_at is null then
        v_bucket:='commission_pending';
        v_entry_type:='referral_pending_rejected';
      else
        v_bucket:='commission_available';
        v_entry_type:='referral_available_rejected';
      end if;

      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_grant.referrer_user_id,p_order_id,v_bucket,v_entry_type,-v_amount,
        v_key,
        jsonb_build_object(
          'riskReasons',v_review.risk_reasons,
          'reviewedBy',p_actor_user_id,
          'reviewedAt',clock_timestamp()
        )
      )
      on conflict(idempotency_key) do nothing;

      update public.order_reward_grants
      set referral_pending_cents=0,
          commission_available_at=null,
          platform_contribution_cents=platform_contribution_cents+v_amount
      where order_id=p_order_id;
    end if;
  end if;

  update public.referral_reward_reviews
  set risk_status=p_decision,
      reviewed_at=clock_timestamp(),
      reviewed_by=p_actor_user_id,
      review_notes=nullif(trim(p_notes),''),
      updated_at=clock_timestamp()
  where order_id=p_order_id;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_decision='approved'
      then 'referral_reward_approved'
      else 'referral_reward_rejected'
    end,
    'order',
    p_order_id::text,
    jsonb_build_object(
      'riskReasons',v_review.risk_reasons,
      'amountCents',v_amount,
      'notes',p_notes,
      'rewardAlreadyReversed',v_grant.reversed_at is not null
    )
  );

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    p_order_id,p_actor_user_id,'admin',
    case when p_decision='approved'
      then 'REFERRAL_REVIEW_APPROVED'
      else 'REFERRAL_REVIEW_REJECTED'
    end,
    case when p_decision='approved'
      then 'Indicação aprovada'
      else 'Comissão de indicação rejeitada'
    end,
    case when p_decision='approved'
      then 'A revisão de segurança aprovou a comissão; as demais condições ainda precisam ser cumpridas.'
      else 'A revisão de segurança rejeitou a comissão; o pedido e cashback do cliente permanecem válidos.'
    end,
    jsonb_build_object(
      'riskReasons',v_review.risk_reasons,
      'rewardAlreadyReversed',v_grant.reversed_at is not null
    )
  );

  return jsonb_build_object(
    'ok',true,
    'orderId',p_order_id,
    'riskStatus',p_decision,
    'amountCents',v_amount,
    'rewardAlreadyReversed',v_grant.reversed_at is not null
  );
end;
$$;

revoke all on function public.admin_review_referral_reward(uuid,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.admin_review_referral_reward(uuid,uuid,text,text)
to service_role;
