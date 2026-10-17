-- TAMÃO V1.401 — deny unsafe PILOT draft linkage during application approval.
-- Same trusted source as 20261004185000_pilot_partner_invite_v1_69.sql,
-- with two fail-closed guards. No historical grants or status are rewritten.
-- The existing SQL body was verified identical to the live RPC before this patch.
create or replace function public.admin_approve_merchant_application(
  p_actor_user_id uuid,
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_app public.merchant_applications%rowtype;
  v_merchant public.merchants%rowtype;
  v_conflicting_owner uuid;
  v_draft public.pilot_partner_drafts%rowtype;
  v_product public.product_delivery_profiles%rowtype;
  v_pilot_terms_seeded boolean:=false;
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
      'pilotDraftId',v_app.pilot_partner_draft_id,
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

  -- A claimed PILOT draft must never downgrade a live merchant or overwrite
  -- its working catalog. The row is already locked above.
  if v_app.pilot_partner_draft_id is not null
     and (v_merchant.status is distinct from 'pending'
       or v_merchant.online is distinct from false) then
    raise exception 'PILOT_MERCHANT_NOT_PENDING' using errcode='40001';
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

  if v_app.pilot_partner_draft_id is not null then
    select * into v_draft
    from public.pilot_partner_drafts
    where id=v_app.pilot_partner_draft_id
    for update;

    if not found then
      raise exception 'PILOT_PARTNER_NOT_FOUND' using errcode='P0002';
    end if;
    if v_draft.onboarding_status='cancelled' then
      raise exception 'PILOT_PARTNER_CANCELLED' using errcode='40001';
    end if;
    if v_draft.merchant_id is not null
       and v_draft.merchant_id<>v_merchant.id then
      raise exception 'PILOT_PARTNER_ALREADY_CONVERTED' using errcode='40001';
    end if;

    select * into v_product
    from public.product_delivery_profiles
    where product_code=v_draft.proposed_product_code
      and active
      and merchant_add_allowed
    for share;

    if not found then
      raise exception 'PILOT_PRODUCT_NOT_AVAILABLE' using errcode='40001';
    end if;

    insert into public.catalog_items(
      merchant_id,product_code,product_name,
      price_cents,pricing_mode,min_price_cents,max_price_cents,pricing_strategy,
      available_stock,active,price_confirmed_at,updated_at
    )
    values(
      v_merchant.id,
      v_draft.proposed_product_code,
      v_product.product_name,
      v_draft.preferred_delivered_price_cents,
      v_draft.pricing_mode,
      v_draft.min_delivered_price_cents,
      v_draft.max_delivered_price_cents,
      v_draft.pricing_strategy,
      0,
      false,
      case when v_draft.price_status='confirmed' then clock_timestamp() else null end,
      clock_timestamp()
    )
    on conflict(merchant_id,product_code) do update
    set product_name=excluded.product_name,
        price_cents=excluded.price_cents,
        pricing_mode=excluded.pricing_mode,
        min_price_cents=excluded.min_price_cents,
        max_price_cents=excluded.max_price_cents,
        pricing_strategy=excluded.pricing_strategy,
        available_stock=0,
        active=false,
        price_confirmed_at=excluded.price_confirmed_at,
        updated_at=clock_timestamp()
    where catalog_items.active is false
      and catalog_items.available_stock=0;

    -- ON CONFLICT ... DO UPDATE WHERE may skip a concurrently activated SKU.
    -- FOUND is false in that case and the entire approval is rolled back.
    if not found then
      raise exception 'PILOT_CATALOG_CONFLICT' using errcode='40001';
    end if;

    if v_draft.delivery_included then
      update public.merchants
      set delivery_fee_cents=0,
          delivery_fee_confirmed_at=clock_timestamp()
      where id=v_merchant.id;
    end if;

    update public.pilot_partner_drafts
    set onboarding_status='converted',
        merchant_id=v_merchant.id,
        updated_at=clock_timestamp()
    where id=v_draft.id;

    v_pilot_terms_seeded:=true;
  end if;

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
      'ownerUserId',v_app.applicant_user_id,
      'pilotDraftId',v_app.pilot_partner_draft_id,
      'pilotTermsSeeded',v_pilot_terms_seeded
    )
  );

  return jsonb_build_object(
    'ok',true,
    'applicationId',v_app.id,
    'merchantId',v_merchant.id,
    'status',v_merchant.status,
    'ownerUserId',v_app.applicant_user_id,
    'pilotDraftId',v_app.pilot_partner_draft_id,
    'pilotTermsSeeded',v_pilot_terms_seeded,
    'alreadyApproved',false
  );
end;
$$;

revoke all on function public.admin_approve_merchant_application(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_approve_merchant_application(uuid,uuid) to service_role;
