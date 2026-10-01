-- Chama São Gabriel — admin state transition hardening v1.7.6
-- Prevent duplicate ownership claims and make repeated admin state transitions
-- safe even when a new idempotency key is used.

create unique index if not exists merchant_applications_one_live_cnpj_idx
  on public.merchant_applications(cnpj)
  where status in ('pending','approved');

create or replace function public.admin_approve_merchant_application(
  p_actor_user_id uuid,
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_app public.merchant_applications%rowtype;
  v_merchant public.merchants%rowtype;
  v_conflicting_owner uuid;
begin
  perform public.require_platform_admin(p_actor_user_id);

  select *
  into v_app
  from public.merchant_applications
  where id=p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002';
  end if;

  if v_app.status='rejected' then
    raise exception 'APPLICATION_REJECTED' using errcode='40001';
  end if;

  select *
  into v_merchant
  from public.merchants
  where cnpj=v_app.cnpj
  for update;

  if v_app.status='approved' then
    if not found then
      raise exception 'APPROVED_APPLICATION_MERCHANT_MISSING' using errcode='40001';
    end if;

    return jsonb_build_object(
      'ok',true,
      'applicationId',v_app.id,
      'merchantId',v_merchant.id,
      'status',v_merchant.status,
      'ownerUserId',v_app.applicant_user_id,
      'alreadyApproved',true
    );
  end if;

  if found then
    if v_merchant.status='rejected' then
      raise exception 'MERCHANT_REJECTED_EXISTS' using errcode='40001';
    end if;

    select mm.user_id
    into v_conflicting_owner
    from public.merchant_members mm
    where mm.merchant_id=v_merchant.id
      and mm.member_role='owner'
      and mm.active
      and mm.user_id<>v_app.applicant_user_id
    limit 1;

    if found then
      raise exception 'MERCHANT_OWNERSHIP_CONFLICT' using errcode='42501';
    end if;
  else
    insert into public.merchants(
      name,cnpj,status,online,address_text,trust_score,
      delivery_fee_cents,base_eta_minutes,accepts_citywide
    )
    values(
      v_app.company_name,v_app.cnpj,'pending',false,v_app.address_text,80,
      0,30,false
    )
    returning * into v_merchant;
  end if;

  insert into public.merchant_members(
    merchant_id,user_id,member_role,active
  )
  values(
    v_merchant.id,v_app.applicant_user_id,'owner',true
  )
  on conflict(merchant_id,user_id) do update
    set member_role='owner',
        active=true;

  insert into public.merchant_compliance(merchant_id)
  values(v_merchant.id)
  on conflict(merchant_id) do nothing;

  update public.merchant_applications
  set status='approved',
      updated_at=clock_timestamp()
  where id=v_app.id;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'merchant_application_approved',
    'merchant',
    v_merchant.id::text,
    jsonb_build_object(
      'applicationId',v_app.id,
      'cnpj',v_app.cnpj,
      'ownerUserId',v_app.applicant_user_id
    )
  );

  return jsonb_build_object(
    'ok',true,
    'applicationId',v_app.id,
    'merchantId',v_merchant.id,
    'status',v_merchant.status,
    'ownerUserId',v_app.applicant_user_id,
    'alreadyApproved',false
  );
end;
$$;

revoke all on function public.admin_approve_merchant_application(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.admin_approve_merchant_application(uuid,uuid)
to postgres, service_role;

create or replace function public.admin_reject_merchant_application(
  p_actor_user_id uuid,
  p_application_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_app public.merchant_applications%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_reason is null
     or char_length(trim(p_reason))<3
     or char_length(trim(p_reason))>240 then
    raise exception 'INVALID_REASON' using errcode='22023';
  end if;

  select *
  into v_app
  from public.merchant_applications
  where id=p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002';
  end if;

  if v_app.status='approved' then
    raise exception 'APPLICATION_ALREADY_APPROVED' using errcode='40001';
  end if;

  if v_app.status='rejected' then
    return jsonb_build_object(
      'ok',true,
      'applicationId',v_app.id,
      'status','rejected',
      'alreadyRejected',true
    );
  end if;

  update public.merchant_applications
  set status='rejected',
      updated_at=clock_timestamp()
  where id=v_app.id;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'merchant_application_rejected',
    'merchant_application',
    v_app.id::text,
    jsonb_build_object(
      'cnpj',v_app.cnpj,
      'reason',trim(p_reason)
    )
  );

  return jsonb_build_object(
    'ok',true,
    'applicationId',v_app.id,
    'status','rejected',
    'alreadyRejected',false
  );
end;
$$;

revoke all on function public.admin_reject_merchant_application(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_reject_merchant_application(uuid,uuid,text)
to postgres, service_role;

create or replace function public.admin_set_merchant_status(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant public.merchants%rowtype;
  v_compliance public.merchant_compliance%rowtype;
  v_has_p13 boolean:=false;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_status not in ('active','suspended') then
    raise exception 'INVALID_MERCHANT_STATUS' using errcode='22023';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_merchant.status=p_status then
    return jsonb_build_object(
      'ok',true,
      'merchantId',v_merchant.id,
      'status',v_merchant.status,
      'online',v_merchant.online,
      'alreadyInState',true
    );
  end if;

  if p_status='active' then
    if v_merchant.status not in ('pending','suspended') then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;

    select *
    into v_compliance
    from public.merchant_compliance
    where merchant_id=v_merchant.id;

    if not found
       or v_compliance.cnpj_status<>'verified' then
      raise exception 'CNPJ_VERIFICATION_REQUIRED' using errcode='40001';
    end if;

    select exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=v_merchant.id
        and ci.product_code='P13'
        and ci.active
    )
    into v_has_p13;

    if v_has_p13
       and v_compliance.anp_status<>'verified' then
      raise exception 'ANP_VERIFICATION_REQUIRED' using errcode='40001';
    end if;
  else
    if v_merchant.status<>'active' then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;
  end if;

  update public.merchants
  set status=p_status,
      online=false,
      updated_at=clock_timestamp()
  where id=v_merchant.id
  returning * into v_merchant;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case
      when p_status='active' then 'merchant_activated'
      else 'merchant_suspended'
    end,
    'merchant',
    v_merchant.id::text,
    jsonb_build_object('status',p_status)
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',v_merchant.id,
    'status',v_merchant.status,
    'online',v_merchant.online,
    'alreadyInState',false
  );
end;
$$;

revoke all on function public.admin_set_merchant_status(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_set_merchant_status(uuid,uuid,text)
to postgres, service_role;
