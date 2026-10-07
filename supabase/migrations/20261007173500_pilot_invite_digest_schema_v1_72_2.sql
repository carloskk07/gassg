-- TAMÃO V1.72.2 — Repair pgcrypto schema and retire legacy claim body
-- Reasserts V1.72.1 using extensions.digest() and makes the old internal
-- claim authority delegate to V2 so no production path depends on public.digest().

-- TAMÃO V1.72.1 — Pilot invite claim ordering
-- A delayed/retried invite claim remains valid when the same permanent
-- applicant has already been approved by the admin. Rejected applications
-- remain closed and require resubmission.

create or replace function public.claim_pilot_partner_invite_v2(
  p_user_id uuid,
  p_application_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
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
  if v_app.status='rejected' then
    raise exception 'APPLICATION_REJECTED' using errcode='40001';
  end if;
  if v_app.status not in ('pending','approved') then
    raise exception 'APPLICATION_STATUS_NOT_CLAIMABLE' using errcode='40001';
  end if;

  v_hash:=encode(extensions.digest(p_token,'sha256'),'hex');

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

revoke all on function public.claim_pilot_partner_invite_v2(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.claim_pilot_partner_invite_v2(uuid,uuid,text)
to service_role;

create or replace function public.claim_my_pilot_partner_invite(
  p_application_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_user_id uuid;
begin
  v_user_id:=auth.uid();

  if v_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  return public.claim_pilot_partner_invite_v2(
    v_user_id,
    p_application_id,
    p_token
  );
end;
$$;

revoke all on function public.claim_my_pilot_partner_invite(uuid,text)
from public, anon;
grant execute on function public.claim_my_pilot_partner_invite(uuid,text)
to authenticated, service_role;


create or replace function public.claim_pilot_partner_invite(
  p_user_id uuid,
  p_application_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  return public.claim_pilot_partner_invite_v2(
    p_user_id,
    p_application_id,
    p_token
  );
end;
$$;

revoke all on function public.claim_pilot_partner_invite(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.claim_pilot_partner_invite(uuid,uuid,text)
to service_role;
