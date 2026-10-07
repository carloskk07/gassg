-- TAMÃO V1.72 — Pilot owner claim authority
-- Ensures a pilot draft can only become owned by the permanent account that
-- actually claimed its invite. The approved/pending order of admin review is
-- intentionally irrelevant.

create or replace function public.admin_assisted_merchant_onboarding_v2(
  p_actor_user_id uuid,
  p_draft_id uuid,
  p_trade_name text,
  p_legal_name text,
  p_cnpj text,
  p_responsible_name text,
  p_phone text,
  p_whatsapp text,
  p_postal_code text,
  p_city text,
  p_state text,
  p_address_text text,
  p_owner_user_id uuid,
  p_owner_display_name text,
  p_product_code text,
  p_product_name text,
  p_pricing_mode text,
  p_min_price_cents integer,
  p_preferred_price_cents integer,
  p_max_price_cents integer,
  p_pricing_strategy text,
  p_available_stock integer,
  p_payment_methods text[],
  p_delivery_fee_cents integer,
  p_base_eta_minutes integer,
  p_accepts_citywide boolean,
  p_service_radius_km numeric,
  p_admin_notes text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_claimed_owner uuid;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_draft_id is not null then
    select i.claimed_user_id
    into v_claimed_owner
    from public.pilot_partner_invites i
    join public.merchant_applications a
      on a.id=i.application_id
    join auth.users u
      on u.id=i.claimed_user_id
    where i.draft_id=p_draft_id
      and i.claimed_at is not null
      and i.claimed_user_id is not null
      and i.application_id is not null
      and a.applicant_user_id=i.claimed_user_id
      and a.pilot_partner_draft_id=p_draft_id
      and a.status in ('pending','approved')
      and u.is_anonymous is false
      and u.email_confirmed_at is not null
    order by i.claimed_at desc
    limit 1;

    if v_claimed_owner is null then
      raise exception 'PILOT_OWNER_REQUIRED' using errcode='42501';
    end if;

    if p_owner_user_id is not null
       and p_owner_user_id<>v_claimed_owner then
      raise exception 'PILOT_OWNER_MISMATCH' using errcode='42501';
    end if;

    p_owner_user_id:=v_claimed_owner;
  end if;

  return public.admin_assisted_merchant_onboarding(
    p_actor_user_id,
    p_draft_id,
    p_trade_name,
    p_legal_name,
    p_cnpj,
    p_responsible_name,
    p_phone,
    p_whatsapp,
    p_postal_code,
    p_city,
    p_state,
    p_address_text,
    p_owner_user_id,
    p_owner_display_name,
    p_product_code,
    p_product_name,
    p_pricing_mode,
    p_min_price_cents,
    p_preferred_price_cents,
    p_max_price_cents,
    p_pricing_strategy,
    p_available_stock,
    p_payment_methods,
    p_delivery_fee_cents,
    p_base_eta_minutes,
    p_accepts_citywide,
    p_service_radius_km,
    p_admin_notes,
    p_idempotency_key,
    p_request_hash
  );
end;
$$;

revoke all on function public.admin_assisted_merchant_onboarding_v2(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,uuid,text,text,text,
  text,integer,integer,integer,text,integer,text[],integer,integer,boolean,
  numeric,text,text,text
) from public, anon, authenticated;

grant execute on function public.admin_assisted_merchant_onboarding_v2(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,uuid,text,text,text,
  text,integer,integer,integer,text,integer,text[],integer,integer,boolean,
  numeric,text,text,text
) to service_role;
