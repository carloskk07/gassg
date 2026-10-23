-- Existing idempotent merchant-config RPC extended only for the owner's
-- self-declared business/contact address. Never verifies legal identity or
-- activates the merchant. Preserve existing compliance/order/payment logic.
DO $extend$
DECLARE
 ddl text;
 old_actions text:=$a$'update-payment-methods')$a$;
 new_actions text:=$b$'update-payment-methods','update-business-details')$b$;
 old_tail text:=$tail$
  end if;

  update public.action_requests
  set result_json=v_result,$tail$;
 new_tail text:=$new$
  elsif p_action='update-business-details' then
    -- The owner, not a manager/operator/driver, attests their own
    -- company contact and operating address. Approval stays independent.
    if v_role<>'owner' then
      raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload)<>'object'
      or (SELECT count(*) FROM jsonb_object_keys(p_payload))<>9
      or p_payload ?& array['legalName','tradeName','responsibleName',
        'phone','whatsapp','postalCode','city','state','addressText'] IS NOT TRUE
    then
      raise exception 'INVALID_BUSINESS_PROFILE' using errcode='22023';
    end if;
    if length(trim(coalesce(p_payload->>'legalName',''))) not between 3 and 160
      or length(trim(coalesce(p_payload->>'tradeName',''))) not between 2 and 140
      or length(trim(coalesce(p_payload->>'responsibleName',''))) not between 3 and 120
      or trim(coalesce(p_payload->>'phone','')) !~ '^[0-9]{10,11}$'
      or trim(coalesce(p_payload->>'whatsapp','')) !~ '^[0-9]{10,11}$'
      or trim(coalesce(p_payload->>'postalCode','')) !~ '^[0-9]{8}$'
      or length(trim(coalesce(p_payload->>'city',''))) not between 2 and 100
      or trim(coalesce(p_payload->>'state','')) !~ '^[A-Z]{2}$'
      or length(trim(coalesce(p_payload->>'addressText',''))) not between 8 and 260
    then
      raise exception 'INVALID_BUSINESS_PROFILE' using errcode='22023';
    end if;
    insert into public.merchant_business_details(
      merchant_id,legal_name,trade_name,responsible_name,phone,
      whatsapp,postal_code,city,state,address_text,updated_at
    ) values (
      p_merchant_id,trim(p_payload->>'legalName'),trim(p_payload->>'tradeName'),
      trim(p_payload->>'responsibleName'),trim(p_payload->>'phone'),
      trim(p_payload->>'whatsapp'),trim(p_payload->>'postalCode'),
      trim(p_payload->>'city'),trim(p_payload->>'state'),
      trim(p_payload->>'addressText'),v_now
    )
    on conflict(merchant_id) do update set
      legal_name=excluded.legal_name,trade_name=excluded.trade_name,
      responsible_name=excluded.responsible_name,phone=excluded.phone,
      whatsapp=excluded.whatsapp,postal_code=excluded.postal_code,
      city=excluded.city,state=excluded.state,
      address_text=excluded.address_text,updated_at=v_now;
    update public.merchants set updated_at=v_now
    where id=p_merchant_id returning * into v_merchant;
    v_result:=jsonb_build_object(
      'ok',true,'action',p_action,'merchantId',p_merchant_id,
      'profileSavedAt',v_now,'configUpdatedAt',v_merchant.updated_at,
      'pendingAdministrativeVerification',true
    );
  end if;

  update public.action_requests
  set result_json=v_result,$new$;
BEGIN
 SELECT pg_get_functiondef('public.merchant_config_action(uuid,uuid,text,timestamp with time zone,jsonb,text,text)'::regprocedure)
 INTO ddl;
 IF ddl IS NULL OR strpos(ddl,old_actions)=0 OR strpos(ddl,old_tail)=0 THEN
   RAISE EXCEPTION 'MERCHANT_CONFIG_BASELINE_DRIFT_BLOCKED' USING ERRCODE='42501';
 END IF;
 IF length(ddl)-length(replace(ddl,old_actions,''))<>length(old_actions)
   OR length(ddl)-length(replace(ddl,old_tail,''))<>length(old_tail) THEN
   RAISE EXCEPTION 'MERCHANT_CONFIG_UNEXPECTED_DUPLICATE' USING ERRCODE='42501';
 END IF;
 EXECUTE replace(replace(ddl,old_actions,new_actions),old_tail,new_tail);
END $extend$;
-- The RPC is invoked with service_role by merchant-ops after permanent Auth
-- and merchant_members lookup. No browser role is granted EXECUTE here.
