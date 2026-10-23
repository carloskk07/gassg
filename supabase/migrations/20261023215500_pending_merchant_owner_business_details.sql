-- TAMÃO — optional owner self-declaration of missing pending-merchant
-- business details. Extend EXISTING merchant_config_action; no parallel API,
-- and fail closed if another release altered the canonical function body.
DO $migration$
DECLARE
  ddl text;
  original text;
  extended text;
  role_old text;
  action_old text;
BEGIN
  select pg_get_functiondef(
    'public.merchant_config_action(uuid,uuid,text,timestamptz,jsonb,text,text)'::regprocedure
  ) into ddl;
  IF ddl IS NULL THEN RAISE EXCEPTION 'MERCHANT_CONFIG_BASELINE_MISSING'; END IF;

  original:='  if p_action not in (''update-logistics'',''update-capacity'',''update-scheduling'',''update-payment-methods'') then';
  extended:='  if p_action not in (''update-logistics'',''update-capacity'',''update-scheduling'',''update-payment-methods'',''update-business-details'') then';
  IF strpos(ddl,original)=0 OR strpos(ddl,extended)>0 THEN
    RAISE EXCEPTION 'MERCHANT_CONFIG_ACTION_BASELINE_DRIFT';
  END IF;
  ddl:=replace(ddl,original,extended);

  role_old:='  select *'||chr(10)||'  into v_merchant'||chr(10)||
    '  from public.merchants';
  IF strpos(ddl,role_old)=0 THEN
    RAISE EXCEPTION 'MERCHANT_CONFIG_ROLE_GATE_DRIFT';
  END IF;
  ddl:=replace(ddl,role_old,$role$
  if p_action='update-business-details' and v_role<>'owner' then
    raise exception 'MERCHANT_OWNER_REQUIRED' using errcode='42501';
  end if;

  select *
  into v_merchant
  from public.merchants$role$);

  action_old:='  end if;'||chr(10)||chr(10)||
    '  update public.action_requests'||chr(10)||
    '  set result_json=v_result';
  IF strpos(ddl,action_old)=0 THEN
    RAISE EXCEPTION 'MERCHANT_CONFIG_TRANSACTION_GATE_DRIFT';
  END IF;
  ddl:=replace(ddl,action_old,$action$
  elsif p_action='update-business-details' then
    -- The owner can DECLARE business contact/location details only while
    -- pending; this is not KYC/CNPJ/ANP approval or publication authority.
    if v_merchant.status <> 'pending' or exists(
      select 1 from public.merchant_compliance mc where mc.merchant_id=p_merchant_id
      and (mc.cnpj_status in ('verified','approved')
        or mc.anp_status in ('verified','approved'))
    ) then
      raise exception 'MERCHANT_PROFILE_LOCKED' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload)<>'object' or not
      (p_payload ?& array['legalName','tradeName','responsibleName','phone',
        'whatsapp','postalCode','city','state','addressText'])
       or length(btrim(coalesce(p_payload->>'legalName',''))) not between 2 and 180
       or length(btrim(coalesce(p_payload->>'tradeName',''))) not between 2 and 120
       or length(btrim(coalesce(p_payload->>'responsibleName',''))) not between 2 and 120
       or coalesce(p_payload->>'phone','') !~ '^[0-9]{10,13}$'
       or coalesce(p_payload->>'whatsapp','') !~ '^[0-9]{10,13}$'
       or coalesce(p_payload->>'postalCode','') !~ '^[0-9]{8}$'
       or length(btrim(coalesce(p_payload->>'city',''))) not between 2 and 120
       or coalesce(p_payload->>'state','') !~ '^[A-Z]{2}$'
       or length(btrim(coalesce(p_payload->>'addressText',''))) not between 5 and 240
       or exists(
         select 1 from jsonb_each_text(p_payload) e
         where e.key not in ('legalName','tradeName','responsibleName','phone',
           'whatsapp','postalCode','city','state','addressText')
       ) then
      raise exception 'INVALID_BUSINESS_DETAILS' using errcode='22023';
    end if;

    insert into public.merchant_business_details(
      merchant_id,legal_name,trade_name,responsible_name,phone,whatsapp,
      postal_code,city,state,address_text,updated_at
    ) values (
      p_merchant_id,btrim(p_payload->>'legalName'),btrim(p_payload->>'tradeName'),
      btrim(p_payload->>'responsibleName'),p_payload->>'phone',p_payload->>'whatsapp',
      p_payload->>'postalCode',btrim(p_payload->>'city'),
      p_payload->>'state',btrim(p_payload->>'addressText'),v_now
    ) on conflict(merchant_id) do update set
      legal_name=excluded.legal_name,
      trade_name=excluded.trade_name,
      responsible_name=excluded.responsible_name,
      phone=excluded.phone,whatsapp=excluded.whatsapp,
      postal_code=excluded.postal_code,
      city=excluded.city,state=excluded.state,
      address_text=excluded.address_text,updated_at=v_now;
    -- Do NOT overwrite admin_notes, compliance, merchant status, last_seen_at,
    -- online or any payment/stock confirmation timestamp.
    update public.merchants set updated_at=v_now where id=p_merchant_id
      returning * into v_merchant;
    v_result:=jsonb_build_object(
      'ok',true,'action',p_action,'businessDetailsSaved',true,
      'configUpdatedAt',v_merchant.updated_at,
      'merchantStatus',v_merchant.status
    );
  end if;

  update public.action_requests
  set result_json=v_result$action$);
  EXECUTE ddl;
END $migration$;

-- No GRANT EXECUTE to anon/authenticated. The canonical merchant-ops Edge
-- function checks the permanent Auth identity and owner role first.
-- Merchant remains pending; compliance and sales remain unchanged.
