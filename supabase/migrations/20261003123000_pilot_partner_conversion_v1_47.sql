-- Chama São Gabriel — pilot partner conversion v1.47
-- A pilot commercial draft can be explicitly linked by an admin to a real legal
-- application. Approval imports the confirmed range into an INACTIVE, zero-stock
-- catalog row so no commercial draft can silently become a live offer.

alter table public.pilot_partner_drafts
  add column if not exists application_id uuid references public.merchant_applications(id) on delete restrict,
  add column if not exists application_linked_at timestamptz,
  add column if not exists application_linked_by uuid references auth.users(id) on delete set null;

create unique index if not exists pilot_partner_drafts_application_uidx
  on public.pilot_partner_drafts(application_id)
  where application_id is not null;

create index if not exists pilot_partner_drafts_application_linked_by_fk_idx
  on public.pilot_partner_drafts(application_linked_by);

create or replace function public.admin_link_pilot_partner_application(
  p_actor_user_id uuid,
  p_draft_id uuid,
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_draft public.pilot_partner_drafts%rowtype;
  v_app public.merchant_applications%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  select *
  into v_draft
  from public.pilot_partner_drafts
  where id=p_draft_id
  for update;

  if not found then
    raise exception 'PILOT_DRAFT_NOT_FOUND' using errcode='P0002';
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

  if v_draft.merchant_id is not null
     or v_draft.onboarding_status not in ('awaiting_legal_data','ready_for_review') then
    raise exception 'PILOT_DRAFT_STATE_INVALID' using errcode='40001';
  end if;

  if v_draft.price_status<>'confirmed' then
    raise exception 'PILOT_PRICE_NOT_CONFIRMED' using errcode='40001';
  end if;

  if exists(
    select 1
    from public.merchants m
    where m.cnpj=v_app.cnpj
  ) then
    raise exception 'PILOT_MERCHANT_ALREADY_EXISTS' using errcode='23505';
  end if;

  if v_draft.application_id is not null then
    if v_draft.application_id=p_application_id then
      return jsonb_build_object(
        'ok',true,
        'draftId',v_draft.id,
        'applicationId',v_app.id,
        'onboardingStatus',v_draft.onboarding_status,
        'alreadyLinked',true
      );
    end if;
    raise exception 'PILOT_DRAFT_ALREADY_LINKED' using errcode='23505';
  end if;

  if exists(
    select 1
    from public.pilot_partner_drafts d
    where d.application_id=p_application_id
      and d.id<>v_draft.id
  ) then
    raise exception 'APPLICATION_ALREADY_LINKED_TO_PILOT' using errcode='23505';
  end if;

  update public.pilot_partner_drafts
  set application_id=v_app.id,
      application_linked_at=clock_timestamp(),
      application_linked_by=p_actor_user_id,
      onboarding_status='ready_for_review',
      updated_at=clock_timestamp()
  where id=v_draft.id
  returning * into v_draft;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'pilot_partner_application_linked',
    'pilot_partner_draft',
    v_draft.id::text,
    jsonb_build_object(
      'applicationId',v_app.id,
      'companyName',v_app.company_name,
      'cnpj',v_app.cnpj,
      'productCode',v_draft.proposed_product_code
    )
  );

  return jsonb_build_object(
    'ok',true,
    'draftId',v_draft.id,
    'applicationId',v_app.id,
    'onboardingStatus',v_draft.onboarding_status,
    'alreadyLinked',false
  );
end;
$$;

revoke all on function public.admin_link_pilot_partner_application(uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.admin_link_pilot_partner_application(uuid,uuid,uuid)
to service_role;

CREATE OR REPLACE FUNCTION public.admin_approve_merchant_application(p_actor_user_id uuid, p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_app public.merchant_applications%rowtype;
  v_merchant public.merchants%rowtype;
  v_conflicting_owner uuid;
  v_draft public.pilot_partner_drafts%rowtype;
  v_has_draft boolean:=false;
  v_product_name text;
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

  select *
  into v_draft
  from public.pilot_partner_drafts d
  where d.application_id=v_app.id
  for update;
  v_has_draft:=found;

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

  if v_has_draft then
    if v_draft.onboarding_status not in ('ready_for_review','converted')
       or v_draft.price_status<>'confirmed'
       or v_draft.merchant_id is not null then
      raise exception 'PILOT_DRAFT_STATE_INVALID' using errcode='40001';
    end if;

    v_product_name:=case
      when v_draft.proposed_product_code~'^P([1-9]|[1-8][0-9]|90)
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
      'pilotDraftId',case when v_has_draft then v_draft.id else null end
    )
  );

  return jsonb_build_object(
    'ok',true,
    'applicationId',v_app.id,
    'merchantId',v_merchant.id,
    'status',v_merchant.status,
    'ownerUserId',v_app.applicant_user_id,
    'pilotDraftId',case when v_has_draft then v_draft.id else null end,
    'pilotCommercialProfileImported',v_has_draft,
    'alreadyApproved',false
  );
end;
$function$

        then 'Gás '||v_draft.proposed_product_code
      when v_draft.proposed_product_code='WATER20' then 'Água 20L'
      when v_draft.proposed_product_code='CHARCOAL4' then 'Carvão 4kg'
      when v_draft.proposed_product_code='WOOD' then 'Lenha'
      when v_draft.proposed_product_code='ICE5' then 'Gelo 5kg'
      else v_draft.proposed_product_code
    end;

    insert into public.catalog_items(
      merchant_id,product_code,product_name,price_cents,available_stock,active,
      price_confirmed_at,pricing_mode,min_price_cents,max_price_cents,pricing_strategy,
      updated_at
    )
    values(
      v_merchant.id,
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

    update public.pilot_partner_drafts
    set merchant_id=v_merchant.id,
        onboarding_status='converted',
        updated_at=clock_timestamp()
    where id=v_draft.id;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'pilot_partner_converted',
      'merchant',
      v_merchant.id::text,
      jsonb_build_object(
        'pilotDraftId',v_draft.id,
        'applicationId',v_app.id,
        'productCode',v_draft.proposed_product_code,
        'pricingMode',v_draft.pricing_mode,
        'minPriceCents',v_draft.min_delivered_price_cents,
        'preferredPriceCents',v_draft.preferred_delivered_price_cents,
        'maxPriceCents',v_draft.max_delivered_price_cents,
        'pricingStrategy',v_draft.pricing_strategy,
        'catalogActive',false,
        'availableStock',0
      )
    );
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
$function$


CREATE OR REPLACE FUNCTION public.admin_execute_action(p_actor_user_id uuid, p_action_name text, p_payload jsonb, p_idempotency_key text, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_action public.action_requests%rowtype;
  v_result jsonb;
  v_application_id uuid;
  v_merchant_id uuid;
  v_order_id uuid;
  v_target_id uuid;
  v_reason text;
  v_reference text;
  v_kind text;
  v_financial_action text;
  v_cnpj_status text;
  v_anp_status text;
  v_anp_reference text;
  v_notes text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_action_name is null
     or p_action_name not in (
       'link-pilot-application',
       'approve-application',
       'reject-application',
       'verify-merchant',
       'activate-merchant',
       'suspend-merchant',
       'reverse-order',
       'financial-action'
     ) then
    raise exception 'INVALID_ADMIN_ACTION' using errcode='22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'INVALID_ADMIN_PAYLOAD' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,
    p_actor_user_id,
    'admin-ops:'||p_action_name,
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
     or v_action.action_name<>('admin-ops:'||p_action_name)
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  case p_action_name
    when 'link-pilot-application' then
      begin
        v_target_id:=(p_payload->>'draftId')::uuid;
        v_application_id:=(p_payload->>'applicationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_PILOT_LINK' using errcode='22023';
      end;
      v_result:=public.admin_link_pilot_partner_application(
        p_actor_user_id,
        v_target_id,
        v_application_id
      );

    when 'approve-application' then
      begin
        v_application_id:=(p_payload->>'applicationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_APPLICATION' using errcode='22023';
      end;
      v_result:=public.admin_approve_merchant_application(
        p_actor_user_id,
        v_application_id
      );

    when 'reject-application' then
      begin
        v_application_id:=(p_payload->>'applicationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_APPLICATION' using errcode='22023';
      end;
      v_reason:=nullif(trim(p_payload->>'reason'),'');
      v_result:=public.admin_reject_merchant_application(
        p_actor_user_id,
        v_application_id,
        v_reason
      );

    when 'verify-merchant' then
      begin
        v_merchant_id:=(p_payload->>'merchantId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_MERCHANT' using errcode='22023';
      end;
      v_cnpj_status:=p_payload->>'cnpjStatus';
      v_anp_status:=p_payload->>'anpStatus';
      v_anp_reference:=nullif(trim(p_payload->>'anpReference'),'');
      v_notes:=nullif(trim(p_payload->>'notes'),'');
      v_result:=public.admin_verify_merchant(
        p_actor_user_id,
        v_merchant_id,
        v_cnpj_status,
        v_anp_status,
        v_anp_reference,
        v_notes
      );

    when 'activate-merchant' then
      begin
        v_merchant_id:=(p_payload->>'merchantId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_MERCHANT' using errcode='22023';
      end;
      v_result:=public.admin_set_merchant_status(
        p_actor_user_id,
        v_merchant_id,
        'active'
      );

    when 'suspend-merchant' then
      begin
        v_merchant_id:=(p_payload->>'merchantId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_MERCHANT' using errcode='22023';
      end;
      v_result:=public.admin_set_merchant_status(
        p_actor_user_id,
        v_merchant_id,
        'suspended'
      );

    when 'reverse-order' then
      begin
        v_order_id:=(p_payload->>'orderId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_ORDER' using errcode='22023';
      end;
      v_reason:=nullif(trim(p_payload->>'reason'),'');
      v_reference:=nullif(trim(p_payload->>'reference'),'');
      v_result:=public.admin_reverse_settled_order(
        p_actor_user_id,
        v_order_id,
        v_reason,
        v_reference
      );

    when 'financial-action' then
      begin
        v_target_id:=(p_payload->>'targetId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_TARGET' using errcode='22023';
      end;
      v_kind:=p_payload->>'kind';
      v_financial_action:=p_payload->>'financialAction';
      v_reference:=nullif(trim(p_payload->>'reference'),'');
      v_result:=public.admin_financial_action(
        p_actor_user_id,
        v_kind,
        v_target_id,
        v_financial_action,
        v_reference
      );
  end case;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$

