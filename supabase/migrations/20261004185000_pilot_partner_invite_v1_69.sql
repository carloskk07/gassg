-- TAMÃO v1.69 — convite piloto de uso único + aproveitamento seguro do rascunho comercial.

alter table public.pilot_partner_drafts
  drop constraint if exists pilot_partner_drafts_proposed_product_code_check;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='pilot_partner_drafts_product_registry_fkey'
      and conrelid='public.pilot_partner_drafts'::regclass
  ) then
    alter table public.pilot_partner_drafts
      add constraint pilot_partner_drafts_product_registry_fkey
      foreign key(proposed_product_code)
      references public.product_delivery_profiles(product_code)
      on update cascade on delete restrict;
  end if;
end
$$;

create index if not exists pilot_partner_drafts_product_code_idx
  on public.pilot_partner_drafts(proposed_product_code);

alter table public.merchant_applications
  add column if not exists pilot_partner_draft_id uuid;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='merchant_applications_pilot_partner_draft_fkey'
      and conrelid='public.merchant_applications'::regclass
  ) then
    alter table public.merchant_applications
      add constraint merchant_applications_pilot_partner_draft_fkey
      foreign key(pilot_partner_draft_id)
      references public.pilot_partner_drafts(id)
      on update cascade on delete set null;
  end if;
end
$$;

create unique index if not exists merchant_applications_pilot_partner_draft_uidx
  on public.merchant_applications(pilot_partner_draft_id)
  where pilot_partner_draft_id is not null;

create table if not exists public.pilot_partner_invites(
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.pilot_partner_drafts(id)
    on update cascade on delete cascade,
  token_hash text not null unique
    check(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_user_id uuid references auth.users(id) on delete set null,
  application_id uuid references public.merchant_applications(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(expires_at>created_at),
  check((claimed_at is null and claimed_user_id is null and application_id is null)
        or (claimed_at is not null and claimed_user_id is not null and application_id is not null))
);

create unique index if not exists pilot_partner_invites_draft_active_uidx
  on public.pilot_partner_invites(draft_id)
  where revoked_at is null and claimed_at is null;

create index if not exists pilot_partner_invites_expiry_idx
  on public.pilot_partner_invites(expires_at)
  where revoked_at is null and claimed_at is null;

alter table public.pilot_partner_invites enable row level security;
revoke all on table public.pilot_partner_invites from public, anon, authenticated;
grant all on table public.pilot_partner_invites to service_role;

create or replace function public.claim_pilot_partner_invite(
  p_user_id uuid,
  p_application_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_app public.merchant_applications%rowtype;
  v_invite public.pilot_partner_invites%rowtype;
  v_draft public.pilot_partner_drafts%rowtype;
  v_hash text;
begin
  if p_user_id is null or p_application_id is null then
    raise exception 'INVALID_PILOT_INVITE_CLAIM' using errcode='22023';
  end if;

  p_token:=trim(coalesce(p_token,''));
  if char_length(p_token)<20 or char_length(p_token)>240
     or p_token!~'^[A-Za-z0-9_-]+$' then
    raise exception 'INVALID_PILOT_INVITE' using errcode='22023';
  end if;

  if not exists(
    select 1
    from auth.users u
    where u.id=p_user_id
      and u.is_anonymous is false
      and u.email_confirmed_at is not null
  ) then
    raise exception 'PERMANENT_IDENTITY_REQUIRED' using errcode='42501';
  end if;

  select * into v_app
  from public.merchant_applications
  where id=p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002';
  end if;
  if v_app.applicant_user_id<>p_user_id then
    raise exception 'PILOT_INVITE_APPLICATION_OWNER_MISMATCH' using errcode='42501';
  end if;
  if v_app.status='approved' then
    raise exception 'APPLICATION_ALREADY_APPROVED' using errcode='40001';
  end if;

  v_hash:=encode(public.digest(p_token,'sha256'),'hex');

  select * into v_invite
  from public.pilot_partner_invites
  where token_hash=v_hash
  for update;

  if not found then
    raise exception 'INVALID_PILOT_INVITE' using errcode='22023';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'PILOT_INVITE_REVOKED' using errcode='40001';
  end if;
  if v_invite.expires_at<=clock_timestamp() then
    raise exception 'PILOT_INVITE_EXPIRED' using errcode='40001';
  end if;

  if v_invite.claimed_at is not null then
    if v_invite.claimed_user_id=p_user_id
       and v_invite.application_id=p_application_id then
      select * into v_draft
      from public.pilot_partner_drafts
      where id=v_invite.draft_id;
      return jsonb_build_object(
        'ok',true,
        'alreadyClaimed',true,
        'draftId',v_invite.draft_id,
        'pilotPartnerName',v_draft.display_name,
        'productCode',v_draft.proposed_product_code
      );
    end if;
    raise exception 'PILOT_INVITE_ALREADY_CLAIMED' using errcode='23505';
  end if;

  select * into v_draft
  from public.pilot_partner_drafts
  where id=v_invite.draft_id
  for update;

  if not found then
    raise exception 'PILOT_PARTNER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_draft.onboarding_status='cancelled' then
    raise exception 'PILOT_PARTNER_CANCELLED' using errcode='40001';
  end if;
  if v_draft.merchant_id is not null or v_draft.onboarding_status='converted' then
    raise exception 'PILOT_PARTNER_ALREADY_CONVERTED' using errcode='40001';
  end if;

  if v_app.pilot_partner_draft_id is not null
     and v_app.pilot_partner_draft_id<>v_draft.id then
    raise exception 'APPLICATION_PILOT_LINK_CONFLICT' using errcode='23505';
  end if;

  update public.merchant_applications
  set pilot_partner_draft_id=v_draft.id,
      updated_at=clock_timestamp()
  where id=v_app.id;

  update public.pilot_partner_invites
  set claimed_at=clock_timestamp(),
      claimed_user_id=p_user_id,
      application_id=v_app.id,
      updated_at=clock_timestamp()
  where id=v_invite.id;

  update public.pilot_partner_drafts
  set onboarding_status=case
        when onboarding_status='awaiting_legal_data' then 'ready_for_review'
        else onboarding_status
      end,
      updated_at=clock_timestamp()
  where id=v_draft.id;

  return jsonb_build_object(
    'ok',true,
    'alreadyClaimed',false,
    'draftId',v_draft.id,
    'pilotPartnerName',v_draft.display_name,
    'productCode',v_draft.proposed_product_code,
    'pricingMode',v_draft.pricing_mode,
    'minDeliveredPriceCents',v_draft.min_delivered_price_cents,
    'preferredDeliveredPriceCents',v_draft.preferred_delivered_price_cents,
    'maxDeliveredPriceCents',v_draft.max_delivered_price_cents,
    'deliveryIncluded',v_draft.delivery_included
  );
end;
$$;

revoke all on function public.claim_pilot_partner_invite(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_pilot_partner_invite(uuid,uuid,text)
  to service_role;

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
        updated_at=clock_timestamp();

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

revoke all on function public.admin_approve_merchant_application(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.admin_approve_merchant_application(uuid,uuid)
  to service_role;
