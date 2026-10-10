-- TAMÃO V1.146 — First real PSP pilot preflight authority
-- A payment capability can only be enabled after an evidence-backed,
-- server-evaluated checklist passes. The global traffic kill switch remains
-- an Edge/runtime gate and is intentionally not mutable from the Admin UI.

create or replace function public.admin_merchant_provider_payment_preflight(
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
  v_definition public.payment_provider_catalog%rowtype;
  v_merchant public.merchants%rowtype;
  v_account public.merchant_payment_provider_accounts%rowtype;
  v_route public.merchant_payment_routes%rowtype;
  v_has_definition boolean:=false;
  v_merchant_active boolean:=false;
  v_account_connected boolean:=false;
  v_account_active boolean:=false;
  v_account_bound boolean:=false;
  v_can_validate boolean:=false;
  v_connection_fresh boolean:=false;
  v_account_healthy boolean:=false;
  v_route_ready boolean:=false;
  v_review_clear boolean:=false;
  v_live_pilot_clear boolean:=false;
  v_funds_direct boolean:=false;
  v_adapter_implemented boolean:=false;
  v_e2e_validated boolean:=false;
  v_ready boolean:=false;
  v_review_count integer:=0;
  v_live_pilot_count integer:=0;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance','readonly') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if p_merchant_id is null
     or v_provider='' or v_provider='manual'
     or v_provider!~'^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'INVALID_MERCHANT_PAYMENT_CAPABILITY' using errcode='22023';
  end if;

  select *
  into v_definition
  from public.payment_provider_catalog
  where provider_key=v_provider;
  v_has_definition:=found;

  if v_has_definition then
    v_adapter_implemented:=v_definition.adapter_status='implemented';
    v_funds_direct:=v_definition.funds_flow='merchant_direct';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id;
  v_merchant_active:=found and v_merchant.status='active';

  select *
  into v_account
  from public.merchant_payment_provider_accounts
  where merchant_id=p_merchant_id
    and provider=v_provider;
  v_account_connected:=found;

  if v_account_connected then
    v_account_active:=v_account.status='active';
    v_account_bound:=v_account.provider_account_id is not null
      and trim(v_account.provider_account_id)<>'';
    v_can_validate:=coalesce(
      (v_account.capabilities->>'canValidateProviderTransactions')::boolean,
      false
    );
    v_e2e_validated:=coalesce(
      (v_account.capabilities->>'e2eValidated')::boolean,
      false
    );
    v_account_healthy:=v_account.last_error_code is null;
    v_connection_fresh:=
      case
        when v_account.connection_mode='oauth'
          then v_account.token_expires_at is not null
            and v_account.token_expires_at>clock_timestamp()+interval '10 minutes'
        else true
      end;

    select *
    into v_route
    from public.merchant_payment_routes
    where merchant_id=p_merchant_id
      and provider=v_provider
      and connection_id=v_account.id
      and active
      and verification_mode in ('provider_api','device')
    order by priority asc,id asc
    limit 1;
    v_route_ready:=found;

    select count(*)::integer
    into v_review_count
    from public.merchant_sale_payment_attempts
    where merchant_id=p_merchant_id
      and provider=v_provider
      and status='review_required';

    select count(*)::integer
    into v_live_pilot_count
    from public.merchant_sale_payment_attempts
    where merchant_id=p_merchant_id
      and provider=v_provider
      and pilot_guard
      and status in (
        'preparing','checkout_ready','pending','approved','review_required'
      );
  end if;

  v_review_clear:=v_review_count=0;
  v_live_pilot_clear:=v_live_pilot_count=0;

  v_ready:=
    v_has_definition
    and v_adapter_implemented
    and v_funds_direct
    and v_merchant_active
    and v_account_connected
    and v_account_active
    and v_account_bound
    and v_can_validate
    and v_connection_fresh
    and v_account_healthy
    and v_route_ready
    and v_review_clear
    and v_live_pilot_clear;

  return jsonb_build_object(
    'ok',true,
    'preflightVersion','v1.146',
    'merchantId',p_merchant_id,
    'provider',v_provider,
    'readyForCapabilityActivation',v_ready,
    'activationKind',case when v_e2e_validated then 'reactivation' else 'pilot' end,
    'e2eValidated',v_e2e_validated,
    'accountId',case when v_account_connected then v_account.id else null end,
    'routeId',case when v_route_ready then v_route.id else null end,
    'reviewCount',v_review_count,
    'livePilotCount',v_live_pilot_count,
    'fundsOwner','merchant',
    'tamaoReceivesSaleProceeds',false,
    'gates',jsonb_build_array(
      jsonb_build_object(
        'key','provider-catalog','ok',v_has_definition,
        'label','PSP reconhecido',
        'detail',case when v_has_definition then v_definition.display_name else 'PSP ausente do catálogo' end
      ),
      jsonb_build_object(
        'key','adapter-implemented','ok',v_adapter_implemented,
        'label','Adaptador automático implementado',
        'detail',case when v_has_definition then v_definition.adapter_status else 'indisponível' end
      ),
      jsonb_build_object(
        'key','merchant-direct-funds','ok',v_funds_direct,
        'label','Dinheiro vai direto à revenda',
        'detail',case when v_has_definition then v_definition.funds_flow else 'indisponível' end
      ),
      jsonb_build_object(
        'key','merchant-active','ok',v_merchant_active,
        'label','Revenda operacionalmente ativa',
        'detail',case when v_merchant.id is null then 'revenda não encontrada' else coalesce(v_merchant.status,'sem status') end
      ),
      jsonb_build_object(
        'key','account-connected','ok',v_account_connected,
        'label','Conta PSP conectada',
        'detail',case when v_account_connected then coalesce(v_account.connection_mode,'conectada') else 'nenhuma conta conectada' end
      ),
      jsonb_build_object(
        'key','account-active','ok',v_account_active,
        'label','Conexão ativa',
        'detail',case when v_account_connected then coalesce(v_account.status,'sem status') else 'sem conta' end
      ),
      jsonb_build_object(
        'key','provider-account-bound','ok',v_account_bound,
        'label','Identidade da conta PSP vinculada',
        'detail',case when v_account_bound then 'provider_account_id confirmado' else 'identidade externa ausente' end
      ),
      jsonb_build_object(
        'key','validation-capable','ok',v_can_validate,
        'label','Validação transacional habilitada',
        'detail',case when v_can_validate then 'provider/device evidence disponível' else 'sem autoridade de validação automática' end
      ),
      jsonb_build_object(
        'key','connection-fresh','ok',v_connection_fresh,
        'label','Credencial válida para o piloto',
        'detail',case
          when not v_account_connected then 'sem conta'
          when v_account.connection_mode='oauth' and v_account.token_expires_at is null then 'expiração OAuth ausente'
          when v_account.connection_mode='oauth' then 'expira em '||v_account.token_expires_at::text
          else 'credencial não-OAuth'
        end
      ),
      jsonb_build_object(
        'key','account-healthy','ok',v_account_healthy,
        'label','Conta sem erro pendente',
        'detail',case when v_account_healthy then 'sem erro registrado' else coalesce(v_account.last_error_code,'erro pendente') end
      ),
      jsonb_build_object(
        'key','automated-route','ok',v_route_ready,
        'label','Rota automática vinculada à conta',
        'detail',case when v_route_ready then v_route.payment_method||' / '||v_route.verification_mode else 'nenhuma rota provider_api/device ativa' end
      ),
      jsonb_build_object(
        'key','payment-review-clear','ok',v_review_clear,
        'label','Sem transação em revisão',
        'detail',v_review_count||' revisão(ões) aberta(s)'
      ),
      jsonb_build_object(
        'key','pilot-slot-clear','ok',v_live_pilot_clear,
        'label','Slot de primeiro piloto livre',
        'detail',v_live_pilot_count||' piloto(s) vivo(s)'
      )
    )
  );
end;
$function$;

revoke all on function public.admin_merchant_provider_payment_preflight(
  uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_provider_payment_preflight(
  uuid,uuid,text
) to service_role;

comment on function public.admin_merchant_provider_payment_preflight(
  uuid,uuid,text
) is 'V1.146 server-evaluated PSP pilot preflight; read-only and service-role only.';

create or replace function public.admin_merchant_provider_payment_capability_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_provider text,
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
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_action public.action_requests%rowtype;
  v_definition public.payment_provider_catalog%rowtype;
  v_merchant public.merchants%rowtype;
  v_account public.merchant_payment_provider_accounts%rowtype;
  v_route public.merchant_payment_routes%rowtype;
  v_reference text:=trim(coalesce(p_reference,''));
  v_changed_at timestamptz:=clock_timestamp();
  v_capabilities jsonb;
  v_e2e_validated boolean:=false;
  v_activation_kind text;
  v_current_enabled boolean:=false;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if p_merchant_id is null or p_enabled is null
     or v_provider='' or v_provider='manual'
     or v_provider!~'^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'INVALID_MERCHANT_PAYMENT_CAPABILITY' using errcode='22023';
  end if;
  if char_length(v_reference)<3 or char_length(v_reference)>240
     or v_reference~'[[:cntrl:]]' then
    raise exception 'MERCHANT_PAYMENT_CAPABILITY_REFERENCE_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-payment-capability:'||v_provider,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found
     or v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-payment-capability:'||v_provider
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
    and provider=v_provider
  for update;

  if not found then
    raise exception 'MERCHANT_PAYMENT_ACCOUNT_NOT_CONNECTED' using errcode='P0002';
  end if;

  v_current_enabled:=coalesce(
    (v_account.capabilities->>'directSalePaymentsEnabled')::boolean,false
  );
  v_e2e_validated:=coalesce(
    (v_account.capabilities->>'e2eValidated')::boolean,false
  );
  v_activation_kind:=case when v_e2e_validated then 'reactivation' else 'pilot' end;

  if p_enabled and v_current_enabled then
    v_result:=jsonb_build_object(
      'ok',true,'merchantId',p_merchant_id,'provider',v_provider,
      'enabled',true,'unchanged',true,
      'connectionStatus',v_account.status,
      'activationKind',v_activation_kind,
      'preflightVersion','v1.146',
      'e2eValidated',v_e2e_validated,
      'fundsOwner','merchant','tamaoReceivesSaleProceeds',false
    );
    update public.action_requests
    set result_json=v_result,completed_at=v_changed_at
    where idempotency_key=p_idempotency_key;
    return v_result;
  end if;

  if p_enabled then
    select *
    into v_definition
    from public.payment_provider_catalog
    where provider_key=v_provider;

    if not found
       or v_definition.adapter_status<>'implemented'
       or v_definition.funds_flow<>'merchant_direct' then
      raise exception 'MERCHANT_PAYMENT_PREFLIGHT_FAILED'
        using errcode='40001';
    end if;

    select *
    into v_merchant
    from public.merchants
    where id=p_merchant_id
    for share;

    if not found or v_merchant.status<>'active' then
      raise exception 'MERCHANT_PAYMENT_MERCHANT_NOT_ACTIVE'
        using errcode='40001';
    end if;

    if v_account.status<>'active'
       or v_account.provider_account_id is null
       or trim(v_account.provider_account_id)=''
       or coalesce((v_account.capabilities->>'canValidateProviderTransactions')::boolean,false)<>true
       or v_account.last_error_code is not null
       or (
         v_account.connection_mode='oauth'
         and (
           v_account.token_expires_at is null
           or v_account.token_expires_at<=clock_timestamp()+interval '10 minutes'
         )
       ) then
      raise exception 'MERCHANT_PAYMENT_ACCOUNT_NOT_READY'
        using errcode='40001';
    end if;

    select *
    into v_route
    from public.merchant_payment_routes
    where merchant_id=p_merchant_id
      and provider=v_provider
      and connection_id=v_account.id
      and active
      and verification_mode in ('provider_api','device')
    order by priority asc,id asc
    limit 1
    for share;

    if not found then
      raise exception 'MERCHANT_PAYMENT_AUTOMATED_ROUTE_REQUIRED'
        using errcode='40001';
    end if;

    if exists(
      select 1
      from public.merchant_sale_payment_attempts
      where merchant_id=p_merchant_id
        and provider=v_provider
        and status='review_required'
    ) then
      raise exception 'MERCHANT_PAYMENT_REVIEW_REQUIRED'
        using errcode='40001';
    end if;

    if exists(
      select 1
      from public.merchant_sale_payment_attempts
      where merchant_id=p_merchant_id
        and provider=v_provider
        and pilot_guard
        and status in (
          'preparing','checkout_ready','pending','approved','review_required'
        )
    ) then
      raise exception 'MERCHANT_PAYMENT_PILOT_IN_FLIGHT'
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
        'reference',v_reference,
        'preflightVersion','v1.146',
        'activationKind',case when p_enabled then v_activation_kind else 'suspension' end
      )
    );

  update public.merchant_payment_provider_accounts
  set capabilities=v_capabilities,updated_at=v_changed_at
  where id=v_account.id
  returning * into v_account;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_enabled
      then case when v_e2e_validated
        then 'reactivate_merchant_direct_payment'
        else 'activate_merchant_payment_pilot'
      end
      else 'disable_merchant_direct_payment'
    end,
    'merchant',
    p_merchant_id::text,
    jsonb_build_object(
      'provider',v_provider,
      'enabled',p_enabled,
      'reference',v_reference,
      'providerAccountId',v_account.provider_account_id,
      'connectionStatus',v_account.status,
      'activationKind',case when p_enabled then v_activation_kind else 'suspension' end,
      'preflightVersion','v1.146',
      'routeId',case when p_enabled then v_route.id else null end,
      'e2eValidated',v_e2e_validated,
      'pilotGuardRequired',p_enabled and not v_e2e_validated,
      'fundsOwner','merchant',
      'tamaoReceivesSaleProceeds',false
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'merchantId',p_merchant_id,
    'provider',v_provider,
    'enabled',p_enabled,
    'unchanged',false,
    'connectionStatus',v_account.status,
    'changedAt',v_changed_at,
    'reference',v_reference,
    'activationKind',case when p_enabled then v_activation_kind else 'suspension' end,
    'preflightVersion','v1.146',
    'routeId',case when p_enabled then v_route.id else null end,
    'e2eValidated',v_e2e_validated,
    'pilotGuardRequired',p_enabled and not v_e2e_validated,
    'fundsOwner','merchant',
    'tamaoReceivesSaleProceeds',false
  );

  update public.action_requests
  set result_json=v_result,completed_at=v_changed_at
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.admin_merchant_provider_payment_capability_action(
  uuid,uuid,text,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_provider_payment_capability_action(
  uuid,uuid,text,boolean,text,text,text
) to service_role;

comment on function public.admin_merchant_provider_payment_capability_action(
  uuid,uuid,text,boolean,text,text,text
) is 'V1.146 atomic activation authority requiring active merchant, healthy PSP account, automated route, free pilot slot and no payment review.';
