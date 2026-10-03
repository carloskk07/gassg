-- Chama São Gabriel — assisted pilot partner activation v1.44
-- Binds an admin-reviewed legal application to a pre-existing commercial pilot draft.
-- The merchant remains pending/offline and seeded catalog stays inactive/unconfirmed.

alter table public.merchant_applications
  add column if not exists pilot_draft_id uuid
    references public.pilot_partner_drafts(id) on delete restrict;

create unique index if not exists merchant_applications_pilot_draft_unique_idx
  on public.merchant_applications(pilot_draft_id)
  where pilot_draft_id is not null;

create or replace function public.admin_approve_pilot_application(
  p_actor_user_id uuid,
  p_application_id uuid,
  p_pilot_draft_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_app public.merchant_applications%rowtype;
  v_draft public.pilot_partner_drafts%rowtype;
  v_base jsonb;
  v_result jsonb;
  v_merchant_id uuid;
  v_merchant public.merchants%rowtype;
  v_existing public.catalog_items%rowtype;
  v_product_name text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_application_id is null or p_pilot_draft_id is null then
    raise exception 'PILOT_APPLICATION_IDS_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,
    p_actor_user_id,
    'admin-ops:approve-pilot-application',
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;
  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:approve-pilot-application'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_app
  from public.merchant_applications
  where id=p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002';
  end if;
  if v_app.status<>'pending' then
    raise exception 'PILOT_APPLICATION_NOT_PENDING' using errcode='40001';
  end if;
  if v_app.pilot_draft_id is not null
     and v_app.pilot_draft_id<>p_pilot_draft_id then
    raise exception 'PILOT_APPLICATION_ALREADY_LINKED' using errcode='23505';
  end if;

  select *
  into v_draft
  from public.pilot_partner_drafts
  where id=p_pilot_draft_id
  for update;

  if not found then
    raise exception 'PILOT_DRAFT_NOT_FOUND' using errcode='P0002';
  end if;
  if v_draft.onboarding_status not in ('awaiting_legal_data','ready_for_review')
     or v_draft.merchant_id is not null then
    raise exception 'PILOT_DRAFT_ALREADY_CONVERTED' using errcode='40001';
  end if;
  if v_draft.price_status<>'confirmed' then
    raise exception 'PILOT_PRICE_NOT_CONFIRMED' using errcode='40001';
  end if;
  if v_draft.proposed_product_code is null
     or not (
       v_draft.proposed_product_code in ('WATER20','CHARCOAL4','WOOD','ICE5')
       or v_draft.proposed_product_code~'^P([1-9]|[1-8][0-9]|90)$'
     ) then
    raise exception 'PILOT_PRODUCT_INVALID' using errcode='22023';
  end if;

  v_base:=public.admin_approve_merchant_application(
    p_actor_user_id,
    p_application_id
  );
  v_merchant_id:=(v_base->>'merchantId')::uuid;

  select *
  into v_merchant
  from public.merchants
  where id=v_merchant_id
  for update;

  if not found then
    raise exception 'PILOT_MERCHANT_MISSING' using errcode='P0002';
  end if;
  if v_merchant.status<>'pending' or v_merchant.online then
    raise exception 'PILOT_MERCHANT_NOT_PENDING' using errcode='40001';
  end if;

  select *
  into v_existing
  from public.catalog_items
  where merchant_id=v_merchant_id
    and product_code=v_draft.proposed_product_code
  for update;

  if found and (
    v_existing.active
    or v_existing.available_stock>0
    or v_existing.price_confirmed_at is not null
  ) then
    raise exception 'PILOT_CATALOG_CONFLICT' using errcode='40001';
  end if;

  v_product_name:=case
    when v_draft.proposed_product_code~'^P([1-9]|[1-8][0-9]|90)$'
      then 'Gás '||v_draft.proposed_product_code
    when v_draft.proposed_product_code='WATER20' then 'Água 20 L'
    when v_draft.proposed_product_code='CHARCOAL4' then 'Carvão 4 kg'
    when v_draft.proposed_product_code='WOOD' then 'Lenha'
    when v_draft.proposed_product_code='ICE5' then 'Gelo 5 kg'
    else v_draft.proposed_product_code
  end;

  insert into public.catalog_items(
    merchant_id,
    product_code,
    product_name,
    price_cents,
    available_stock,
    active,
    price_confirmed_at,
    pricing_mode,
    min_price_cents,
    max_price_cents,
    pricing_strategy,
    updated_at
  )
  values(
    v_merchant_id,
    v_draft.proposed_product_code,
    v_product_name,
    v_draft.preferred_delivered_price_cents,
    0,
    false,
    null,
    v_draft.pricing_mode,
    v_draft.min_delivered_price_cents,
    v_draft.max_delivered_price_cents,
    v_draft.pricing_strategy,
    clock_timestamp()
  )
  on conflict(merchant_id,product_code) do update
  set product_name=excluded.product_name,
      price_cents=excluded.price_cents,
      available_stock=0,
      active=false,
      price_confirmed_at=null,
      pricing_mode=excluded.pricing_mode,
      min_price_cents=excluded.min_price_cents,
      max_price_cents=excluded.max_price_cents,
      pricing_strategy=excluded.pricing_strategy,
      updated_at=clock_timestamp();

  update public.merchant_applications
  set pilot_draft_id=v_draft.id,
      updated_at=clock_timestamp()
  where id=v_app.id;

  update public.pilot_partner_drafts
  set merchant_id=v_merchant_id,
      onboarding_status='converted',
      updated_at=clock_timestamp()
  where id=v_draft.id;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'pilot_partner_application_approved',
    'merchant',
    v_merchant_id::text,
    jsonb_build_object(
      'applicationId',v_app.id,
      'pilotDraftId',v_draft.id,
      'productCode',v_draft.proposed_product_code,
      'pricingMode',v_draft.pricing_mode,
      'minPriceCents',v_draft.min_delivered_price_cents,
      'preferredPriceCents',v_draft.preferred_delivered_price_cents,
      'maxPriceCents',v_draft.max_delivered_price_cents,
      'catalogActive',false,
      'stock',0,
      'priceConfirmed',false
    )
  );

  v_result:=v_base||jsonb_build_object(
    'pilotDraftId',v_draft.id,
    'pilotPartnerName',v_draft.display_name,
    'catalogSeeded',true,
    'seededProductCode',v_draft.proposed_product_code,
    'catalogActive',false,
    'stock',0,
    'priceConfirmed',false,
    'requiresCompliance',true,
    'requiresOperationalConfirmation',true
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_approve_pilot_application(
  uuid,uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.admin_approve_pilot_application(
  uuid,uuid,uuid,text,text
) to service_role;
