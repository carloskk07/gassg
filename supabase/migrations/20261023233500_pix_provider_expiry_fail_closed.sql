-- A provider charge is not payable without a verified expiration.
-- Do not invent a new 24h deadline inside an RPC; provider-facing Edge
-- supplies the actual deadline. Preserve cancelled/expired late-PSP evidence.
DO $guard$
DECLARE
  ddl text;
  old_deadline text:=$old$
  v_expires_at timestamptz:=coalesce(
    p_expires_at,
    clock_timestamp()+interval '24 hours'
  );$old$;
  new_deadline text:=$new$
  v_expires_at timestamptz:=p_expires_at;$new$;
  old_transition text:=$oldtrans$
  else
    update public.merchant_billing_provider_charges
    set status=v_status,$oldtrans$;
  new_transition text:=$newtrans$
  else
    if v_expires_at is null
       or v_expires_at<=clock_timestamp()+interval '60 seconds' then
      raise exception 'PIX_PROVIDER_CHARGE_EXPIRY_REQUIRED' using errcode='22023';
    end if;
    update public.merchant_billing_provider_charges
    set status=v_status,$newtrans$;
BEGIN
  SELECT pg_get_functiondef(
    'public.merchant_billing_provider_charge_commit(uuid,text,text,text,text,text,timestamp with time zone,text)'::regprocedure
  ) INTO ddl;
  IF ddl IS NULL OR strpos(ddl,old_deadline)=0 OR strpos(ddl,old_transition)=0
     OR length(ddl)-length(replace(ddl,old_deadline,''))<>length(old_deadline)
     OR length(ddl)-length(replace(ddl,old_transition,''))<>length(old_transition)
  THEN
    RAISE EXCEPTION 'PIX_CHARGE_EXPIRY_BASELINE_DRIFT_BLOCKED' USING ERRCODE='42501';
  END IF;
  EXECUTE replace(replace(ddl,old_deadline,new_deadline),old_transition,new_transition);
END $guard$;
-- Existing GRANTs and the terminal cancelled/expired persistence branch unchanged.
-- Does not create charges, credit balances, alter a payment, or enable commerce.
