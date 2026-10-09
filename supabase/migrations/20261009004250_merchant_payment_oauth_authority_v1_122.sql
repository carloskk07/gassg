
create or replace function public.consume_merchant_payment_oauth_state(
  p_state_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_hash text:=lower(trim(coalesce(p_state_hash,'')));
  v_state public.merchant_payment_oauth_states%rowtype;
begin
  if v_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_OAUTH_STATE_HASH' using errcode='22023';
  end if;

  select *
  into v_state
  from public.merchant_payment_oauth_states
  where state_hash=v_hash
  for update;

  if not found then
    raise exception 'OAUTH_STATE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_state.consumed_at is not null then
    raise exception 'OAUTH_STATE_ALREADY_CONSUMED' using errcode='40001';
  end if;

  if v_state.expires_at<=clock_timestamp() then
    update public.merchant_payment_oauth_states
    set consumed_at=clock_timestamp()
    where id=v_state.id;
    raise exception 'OAUTH_STATE_EXPIRED' using errcode='40001';
  end if;

  update public.merchant_payment_oauth_states
  set consumed_at=clock_timestamp()
  where id=v_state.id;

  return jsonb_build_object(
    'id',v_state.id,
    'merchantId',v_state.merchant_id,
    'provider',v_state.provider,
    'initiatedBy',v_state.initiated_by,
    'codeVerifierCiphertext',v_state.code_verifier_ciphertext,
    'codeVerifierNonce',v_state.code_verifier_nonce,
    'redirectUri',v_state.redirect_uri,
    'expiresAt',v_state.expires_at
  );
end;
$function$;

revoke all on function public.consume_merchant_payment_oauth_state(text)
  from public,anon,authenticated;
grant execute on function public.consume_merchant_payment_oauth_state(text)
  to service_role;

create or replace function public.disconnect_merchant_payment_provider_account(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_account public.merchant_payment_provider_accounts%rowtype;
begin
  if v_provider not in ('mercadopago','woovi') then
    raise exception 'PAYMENT_PROVIDER_INVALID' using errcode='22023';
  end if;

  select member_role
  into v_role
  from public.merchant_members
  where merchant_id=p_merchant_id
    and user_id=p_actor_user_id
    and active
  for share;

  if v_role not in ('owner','manager') then
    raise exception 'MERCHANT_PAYMENT_PERMISSION_DENIED' using errcode='42501';
  end if;

  update public.merchant_payment_provider_accounts
  set status='revoked',
      access_token_ciphertext=null,
      access_token_nonce=null,
      refresh_token_ciphertext=null,
      refresh_token_nonce=null,
      token_expires_at=null,
      revoked_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where merchant_id=p_merchant_id
    and provider=v_provider
  returning * into v_account;

  if not found then
    return jsonb_build_object(
      'ok',true,
      'merchantId',p_merchant_id,
      'provider',v_provider,
      'status','not_connected'
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'merchantId',v_account.merchant_id,
    'provider',v_account.provider,
    'status',v_account.status,
    'revokedAt',v_account.revoked_at
  );
end;
$function$;

revoke all on function public.disconnect_merchant_payment_provider_account(
  uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.disconnect_merchant_payment_provider_account(
  uuid,uuid,text
) to service_role;

create index if not exists merchant_payment_provider_accounts_status_idx
  on public.merchant_payment_provider_accounts(status,merchant_id);
