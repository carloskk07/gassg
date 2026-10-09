
create or replace function public.admin_merchant_payment_capability_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_enabled boolean,
  p_reference text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_action public.action_requests%rowtype;
  v_account public.merchant_payment_provider_accounts%rowtype;
  v_reference text:=trim(coalesce(p_reference,''));
  v_changed_at timestamptz:=clock_timestamp();
  v_capabilities jsonb;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if p_merchant_id is null or p_enabled is null then
    raise exception 'INVALID_MERCHANT_PAYMENT_CAPABILITY'
      using errcode='22023';
  end if;

  if char_length(v_reference)<3 or char_length(v_reference)>240
     or v_reference~'[[:cntrl:]]' then
    raise exception 'MERCHANT_PAYMENT_CAPABILITY_REFERENCE_REQUIRED'
      using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,
    p_actor_user_id,
    'admin-ops:merchant-payment-capability',
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-payment-capability'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_account
  from public.merchant_payment_provider_accounts
  where merchant_id=p_merchant_id
    and provider='mercadopago'
  for update;

  if not found then
    raise exception 'MERCHANT_PAYMENT_ACCOUNT_NOT_CONNECTED'
      using errcode='P0002';
  end if;

  if p_enabled then
    if v_account.status<>'active'
       or v_account.provider_account_id is null
       or v_account.access_token_ciphertext is null
       or v_account.access_token_nonce is null
       or coalesce((v_account.capabilities->>'oauthConnected')::boolean,false)<>true
       or coalesce((v_account.capabilities->>'canValidateProviderTransactions')::boolean,false)<>true then
      raise exception 'MERCHANT_PAYMENT_ACCOUNT_NOT_READY'
        using errcode='40001';
    end if;

    if exists(
      select 1
      from public.merchant_sale_payment_attempts
      where merchant_id=p_merchant_id
        and status='review_required'
    ) then
      raise exception 'MERCHANT_PAYMENT_REVIEW_REQUIRED'
        using errcode='40001';
    end if;
  end if;

  v_capabilities:=
    coalesce(v_account.capabilities,'{}'::jsonb)
    ||jsonb_build_object(
      'directSalePaymentsEnabled',p_enabled,
      'directSalePaymentApproval',jsonb_build_object(
        'enabled',p_enabled,
        'changedAt',v_changed_at,
        'changedBy',p_actor_user_id,
        'reference',v_reference
      )
    );

  update public.merchant_payment_provider_accounts
  set capabilities=v_capabilities,
      updated_at=v_changed_at
  where id=v_account.id
  returning * into v_account;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_enabled
      then 'enable_merchant_direct_payment'
      else 'disable_merchant_direct_payment'
    end,
    'merchant',
    p_merchant_id::text,
    jsonb_build_object(
      'provider','mercadopago',
      'enabled',p_enabled,
      'reference',v_reference,
      'providerAccountId',v_account.provider_account_id,
      'connectionStatus',v_account.status
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'merchantId',p_merchant_id,
    'provider','mercadopago',
    'enabled',p_enabled,
    'connectionStatus',v_account.status,
    'changedAt',v_changed_at,
    'reference',v_reference
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=v_changed_at
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.admin_merchant_payment_capability_action(
  uuid,uuid,boolean,text,text,text
) from public,anon,authenticated;

grant execute on function public.admin_merchant_payment_capability_action(
  uuid,uuid,boolean,text,text,text
) to service_role;
