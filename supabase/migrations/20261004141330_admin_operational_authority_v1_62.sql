-- TAMÃO v1.62 — autoridade operacional administrável.
-- Separa segurança técnica (fail closed) de pendências comerciais confirmáveis pelo admin.
-- Preserva commerce_enabled para compatibilidade e adiciona PRELAUNCH/PILOT/LIVE/PAUSED.

alter table public.platform_launch_control
  add column if not exists operation_mode text not null default 'PRELAUNCH',
  add column if not exists mode_changed_at timestamptz,
  add column if not exists mode_changed_by uuid,
  add column if not exists mode_reason text,
  add column if not exists mode_source_sha text;

update public.platform_launch_control
set operation_mode=case when commerce_enabled then 'LIVE' else 'PRELAUNCH' end
where operation_mode is null
   or operation_mode not in ('PRELAUNCH','PILOT','LIVE','PAUSED');

do $$
begin
  if not exists(
    select 1 from pg_catalog.pg_constraint
    where conname='platform_launch_control_operation_mode_check'
      and conrelid='public.platform_launch_control'::regclass
  ) then
    alter table public.platform_launch_control
      add constraint platform_launch_control_operation_mode_check
      check(operation_mode in ('PRELAUNCH','PILOT','LIVE','PAUSED'));
  end if;
  if not exists(
    select 1 from pg_catalog.pg_constraint
    where conname='platform_launch_control_mode_source_sha_check'
      and conrelid='public.platform_launch_control'::regclass
  ) then
    alter table public.platform_launch_control
      add constraint platform_launch_control_mode_source_sha_check
      check(mode_source_sha is null or mode_source_sha ~ '^[0-9a-f]{40}$');
  end if;
end
$$;

create table if not exists public.platform_launch_confirmations (
  id uuid primary key default gen_random_uuid(),
  requirement_key text not null
    check(requirement_key ~ '^[a-z0-9][a-z0-9_:-]{1,119}$'),
  status text not null
    check(status in ('confirmed','revoked')),
  reason text not null
    check(char_length(reason) between 3 and 1000),
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  confirmed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'admin-panel'
    check(char_length(source) between 2 and 80),
  created_at timestamptz not null default clock_timestamp(),
  check(expires_at is null or expires_at > confirmed_at)
);

create index if not exists platform_launch_confirmations_requirement_idx
  on public.platform_launch_confirmations(requirement_key,confirmed_at desc);

alter table public.platform_launch_confirmations enable row level security;
revoke all on table public.platform_launch_confirmations from public, anon, authenticated;
grant all on table public.platform_launch_confirmations to service_role;

create or replace function public.platform_launch_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_control public.platform_launch_control%rowtype;
  v_supply jsonb;
  v_active_admins integer:=0;
  v_owner_ready integer:=0;
  v_payment_ready integer:=0;
  v_offer_ready integer:=0;
  v_configured_merchants integer:=0;
  v_portals_fresh boolean:=false;
  v_database_ready boolean:=false;
  v_warnings text[]:=array[]::text[];
  v_security text[]:=array[]::text[];
  v_unresolved text[]:=array[]::text[];
  v_warning_details jsonb:='[]'::jsonb;
  v_requirement text;
  v_conf_status text;
  v_conf_reason text;
  v_conf_actor uuid;
  v_conf_at timestamptz;
  v_conf_expires timestamptz;
  v_confirmed boolean;
  v_state text;
begin
  select *
  into v_control
  from public.platform_launch_control
  where singleton=true;

  if not found then
    raise exception 'LAUNCH_CONTROL_MISSING' using errcode='P0002';
  end if;

  select count(*)::integer
  into v_active_admins
  from public.platform_admins
  where active;

  v_supply:=public.market_supply_status();
  v_configured_merchants:=coalesce((v_supply->>'configuredMerchantCount')::integer,0);

  select count(distinct m.id)::integer
  into v_owner_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=m.id and mm.active and mm.member_role='owner'
    )
    and exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=m.id and ci.active and ci.price_cents>0
    );

  select count(distinct m.id)::integer
  into v_payment_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and exists(
      select 1 from public.merchant_payment_methods p
      where p.merchant_id=m.id and p.active
    )
    and exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=m.id and ci.active and ci.price_cents>0
    );

  select count(distinct m.id)::integer
  into v_offer_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
    and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
    and exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=m.id and mm.active and mm.member_role='owner'
    )
    and exists(
      select 1 from public.merchant_payment_methods p
      where p.merchant_id=m.id and p.active
    )
    and exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.available_stock>0
        and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    );

  v_portals_fresh:=
    v_control.portals_verified_at is not null
    and v_control.portals_verified_at>=statement_timestamp()-interval '60 minutes'
    and v_control.customer_portal_ok
    and v_control.merchant_portal_ok
    and v_control.admin_portal_ok
    and v_control.portals_source_sha is not null;

  v_database_ready:=
    v_active_admins>0
    and coalesce((v_supply->>'realSupplyConfigured')::boolean,false)
    and v_configured_merchants>0
    and v_owner_ready>0
    and v_payment_ready>0
    and v_offer_ready>0;

  -- Segurança fundamental: acesso direto do browser a tabelas sensíveis é bloqueio real.
  if exists(
    select 1
    from information_schema.role_table_grants g
    where g.table_schema='public'
      and g.grantee in ('anon','authenticated')
      and g.table_name in (
        'orders','order_items','order_events','wallet_entries',
        'platform_admins','platform_admin_audit','action_requests',
        'merchant_compliance','platform_launch_control',
        'platform_launch_confirmations'
      )
      and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) then
    v_security:=array_append(v_security,'browser_sensitive_table_acl');
  end if;

  if exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in (
        'orders','order_items','order_events','wallet_entries',
        'platform_admins','platform_admin_audit','action_requests',
        'merchant_compliance','platform_launch_control',
        'platform_launch_confirmations'
      )
      and c.relkind in ('r','p')
      and not c.relrowsecurity
  ) then
    v_security:=array_append(v_security,'sensitive_table_rls_disabled');
  end if;

  if exists(
    select 1
    from information_schema.role_routine_grants g
    where g.routine_schema='public'
      and g.grantee in ('anon','authenticated')
      and g.routine_name in (
        'admin_launch_control_action',
        'admin_operation_mode_action',
        'admin_confirm_launch_requirement'
      )
      and g.privilege_type='EXECUTE'
  ) then
    v_security:=array_append(v_security,'admin_rpc_browser_exposure');
  end if;

  -- Negócio/operação: vira warning confirmável, não bloqueio técnico absoluto.
  if v_active_admins<1 then
    v_warnings:=array_append(v_warnings,'admin_required');
  end if;
  if not coalesce((v_supply->>'realSupplyConfigured')::boolean,false) then
    v_warnings:=array_append(v_warnings,'real_supply_required');
  end if;
  if v_owner_ready<1 then
    v_warnings:=array_append(v_warnings,'merchant_owner_required');
  end if;
  if v_payment_ready<1 then
    v_warnings:=array_append(v_warnings,'merchant_payment_required');
  end if;
  if v_offer_ready<1 then
    v_warnings:=array_append(v_warnings,'offerable_supply_required');
  end if;
  if not v_portals_fresh then
    v_warnings:=array_append(v_warnings,'live_portals_verification_required');
  end if;

  foreach v_requirement in array v_warnings loop
    v_conf_status:=null;
    v_conf_reason:=null;
    v_conf_actor:=null;
    v_conf_at:=null;
    v_conf_expires:=null;

    select c.status,c.reason,c.actor_user_id,c.confirmed_at,c.expires_at
    into v_conf_status,v_conf_reason,v_conf_actor,v_conf_at,v_conf_expires
    from public.platform_launch_confirmations c
    where c.requirement_key=v_requirement
    order by c.confirmed_at desc,c.id desc
    limit 1;

    v_confirmed:=
      v_conf_status='confirmed'
      and (v_conf_expires is null or v_conf_expires>statement_timestamp());

    if not v_confirmed then
      v_unresolved:=array_append(v_unresolved,v_requirement);
    end if;

    v_warning_details:=v_warning_details||jsonb_build_array(
      jsonb_build_object(
        'key',v_requirement,
        'status',case
          when v_confirmed then 'CONFIRMADO_PELO_ADMIN'
          when v_conf_status='confirmed' and v_conf_expires<=statement_timestamp() then 'ATENCAO'
          else 'PENDENTE'
        end,
        'confirmed',v_confirmed,
        'reason',v_conf_reason,
        'confirmedBy',v_conf_actor,
        'confirmedAt',v_conf_at,
        'expiresAt',v_conf_expires,
        'condition',case v_requirement
          when 'admin_required' then 'Nenhum administrador ativo foi detectado.'
          when 'real_supply_required' then 'Ainda não existe oferta real configurada.'
          when 'merchant_owner_required' then 'Nenhuma revenda elegível possui owner operacional ativo.'
          when 'merchant_payment_required' then 'Nenhuma revenda elegível possui forma de pagamento ativa.'
          when 'offerable_supply_required' then 'Nenhuma revenda está ofertável agora com estoque, preço, taxa e heartbeat frescos.'
          when 'live_portals_verification_required' then 'Os três portais live não possuem atestado recente e consistente.'
          else v_requirement
        end,
        'risk',case v_requirement
          when 'admin_required' then 'A operação pode ficar sem autoridade humana disponível.'
          when 'real_supply_required' then 'Clientes podem chegar sem oferta real configurada.'
          when 'merchant_owner_required' then 'A revenda pode não ter responsável operacional apto.'
          when 'merchant_payment_required' then 'O pedido pode não ter meio de pagamento operacional definido.'
          when 'offerable_supply_required' then 'A operação pode abrir sem capacidade imediata de atendimento.'
          when 'live_portals_verification_required' then 'Um portal pode estar indisponível ou com bundle divergente.'
          else 'Pendência operacional.'
        end,
        'recommendation',case v_requirement
          when 'admin_required' then 'Ative ao menos um administrador permanente.'
          when 'real_supply_required' then 'Converta e valide o primeiro parceiro real.'
          when 'merchant_owner_required' then 'Vincule um owner permanente à revenda.'
          when 'merchant_payment_required' then 'Cadastre Pix, dinheiro, cartão na entrega ou outro método aceito.'
          when 'offerable_supply_required' then 'Reconfirme disponibilidade, estoque, preço e capacidade de entrega.'
          when 'live_portals_verification_required' then 'Execute a verificação dos portais e Turnstile.'
          else 'Revise a condição antes de continuar.'
        end
      )
    );
  end loop;

  v_state:=case
    when cardinality(v_security)>0 then 'BLOCKED_SECURITY'
    when cardinality(v_warnings)>0 then 'READY_WITH_WARNINGS'
    else 'READY'
  end;

  return jsonb_build_object(
    'readinessState',v_state,
    'operationMode',v_control.operation_mode,
    'commerceEnabled',v_control.commerce_enabled,
    'databaseReady',v_database_ready,
    'readyToEnable',cardinality(v_security)=0 and cardinality(v_unresolved)=0,
    'canActivateOperation',cardinality(v_security)=0 and cardinality(v_unresolved)=0,
    'allWarningsConfirmed',cardinality(v_unresolved)=0,
    'activeAdminCount',v_active_admins,
    'configuredMerchantCount',v_configured_merchants,
    'ownerReadyMerchantCount',v_owner_ready,
    'paymentReadyMerchantCount',v_payment_ready,
    'offerReadyMerchantCount',v_offer_ready,
    'availableNow',coalesce((v_supply->>'availableNow')::boolean,false),
    'availableMerchantCount',coalesce((v_supply->>'availableMerchantCount')::integer,0),
    'portalsFresh',v_portals_fresh,
    'portalsVerifiedAt',v_control.portals_verified_at,
    'portalsSourceSha',v_control.portals_source_sha,
    'customerPortalOk',v_control.customer_portal_ok,
    'merchantPortalOk',v_control.merchant_portal_ok,
    'adminPortalOk',v_control.admin_portal_ok,
    'securityBlockers',to_jsonb(v_security),
    'warnings',to_jsonb(v_warnings),
    'warningDetails',v_warning_details,
    'unresolvedWarnings',to_jsonb(v_unresolved),
    -- Compatibilidade com UI anterior: blockers agora significa warnings ainda não confirmados.
    'blockers',to_jsonb(v_unresolved),
    'supply',v_supply
  );
end;
$$;

create or replace function public.admin_confirm_launch_requirement(
  p_actor_user_id uuid,
  p_requirement_key text,
  p_status text,
  p_reason text,
  p_evidence jsonb,
  p_expires_at timestamptz,
  p_metadata jsonb,
  p_source text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_readiness jsonb;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_requirement_key is null
     or p_requirement_key!~'^[a-z0-9][a-z0-9_:-]{1,119}$' then
    raise exception 'INVALID_LAUNCH_REQUIREMENT_KEY' using errcode='22023';
  end if;
  if p_status not in ('confirmed','revoked') then
    raise exception 'INVALID_LAUNCH_CONFIRMATION_STATUS' using errcode='22023';
  end if;
  if p_reason is null or char_length(trim(p_reason))<3 or char_length(p_reason)>1000 then
    raise exception 'LAUNCH_CONFIRMATION_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_expires_at is not null and p_expires_at<=clock_timestamp() then
    raise exception 'LAUNCH_CONFIRMATION_EXPIRY_INVALID' using errcode='22023';
  end if;
  if p_source is null or char_length(trim(p_source))<2 or char_length(p_source)>80 then
    raise exception 'INVALID_LAUNCH_CONFIRMATION_SOURCE' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  v_readiness:=public.platform_launch_readiness();
  if p_status='confirmed'
     and not coalesce((v_readiness->'warnings') ? p_requirement_key,false) then
    raise exception 'LAUNCH_REQUIREMENT_NOT_ACTIVE' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-launch-confirm:'||p_requirement_key||':'||p_status,
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
     or v_action.action_name<>'admin-launch-confirm:'||p_requirement_key||':'||p_status
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  insert into public.platform_launch_confirmations(
    requirement_key,status,reason,evidence,actor_user_id,
    confirmed_at,expires_at,metadata,source
  )
  values(
    p_requirement_key,p_status,trim(p_reason),coalesce(p_evidence,'{}'::jsonb),
    p_actor_user_id,clock_timestamp(),p_expires_at,
    coalesce(p_metadata,'{}'::jsonb),trim(p_source)
  );

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_status='confirmed'
      then 'confirm-launch-requirement'
      else 'revoke-launch-requirement'
    end,
    'platform_launch_requirement',
    p_requirement_key,
    jsonb_build_object(
      'status',p_status,
      'reason',trim(p_reason),
      'expiresAt',p_expires_at,
      'source',trim(p_source),
      'evidence',coalesce(p_evidence,'{}'::jsonb),
      'metadata',coalesce(p_metadata,'{}'::jsonb)
    )
  );

  v_readiness:=public.platform_launch_readiness();
  v_result:=jsonb_build_object(
    'ok',true,
    'requirementKey',p_requirement_key,
    'status',p_status,
    'readiness',v_readiness
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

create or replace function public.admin_operation_mode_action(
  p_actor_user_id uuid,
  p_mode text,
  p_reason text,
  p_source_sha text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_readiness jsonb;
  v_result jsonb;
  v_previous_mode text;
  v_enable boolean;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_mode:=upper(trim(coalesce(p_mode,'')));
  if p_mode not in ('PRELAUNCH','PILOT','LIVE','PAUSED') then
    raise exception 'INVALID_OPERATION_MODE' using errcode='22023';
  end if;
  if p_reason is null or char_length(trim(p_reason))<3 or char_length(p_reason)>1000 then
    raise exception 'OPERATION_MODE_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_source_sha is not null
     and lower(trim(p_source_sha))!~'^[0-9a-f]{40}$' then
    raise exception 'INVALID_OPERATION_SOURCE_SHA' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-mode:'||p_mode,p_request_hash
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
     or v_action.action_name<>'admin-mode:'||p_mode
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  v_readiness:=public.platform_launch_readiness();
  if p_mode in ('PILOT','LIVE') then
    if v_readiness->>'readinessState'='BLOCKED_SECURITY' then
      raise exception 'LAUNCH_BLOCKED_SECURITY' using errcode='42501';
    end if;
    if not coalesce((v_readiness->>'allWarningsConfirmed')::boolean,false) then
      raise exception 'LAUNCH_WARNINGS_UNCONFIRMED' using errcode='40001';
    end if;
  end if;

  select operation_mode
  into v_previous_mode
  from public.platform_launch_control
  where singleton=true
  for update;

  if not found then
    raise exception 'LAUNCH_CONTROL_MISSING' using errcode='P0002';
  end if;

  v_enable:=p_mode in ('PILOT','LIVE');

  update public.platform_launch_control
  set operation_mode=p_mode,
      commerce_enabled=v_enable,
      mode_changed_at=clock_timestamp(),
      mode_changed_by=p_actor_user_id,
      mode_reason=trim(p_reason),
      mode_source_sha=case
        when p_source_sha is null then portals_source_sha
        else lower(trim(p_source_sha))
      end,
      enabled_at=case
        when v_enable and not commerce_enabled then clock_timestamp()
        else enabled_at
      end,
      enabled_by=case
        when v_enable and not commerce_enabled then p_actor_user_id
        else enabled_by
      end,
      disabled_at=case when v_enable then null else clock_timestamp() end,
      disabled_by=case when v_enable then null else p_actor_user_id end,
      updated_at=clock_timestamp()
  where singleton=true;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'set-operation-mode',
    'platform_launch',
    null,
    jsonb_build_object(
      'previousMode',v_previous_mode,
      'newMode',p_mode,
      'reason',trim(p_reason),
      'sourceSha',coalesce(lower(trim(p_source_sha)),v_readiness->>'portalsSourceSha'),
      'readiness',v_readiness
    )
  );

  v_readiness:=public.platform_launch_readiness();
  v_result:=jsonb_build_object(
    'ok',true,
    'previousMode',v_previous_mode,
    'operationMode',p_mode,
    'commerceEnabled',v_enable,
    'readiness',v_readiness
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

create or replace function public.commerce_launch_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_enabled boolean:=false;
  v_mode text:='PRELAUNCH';
begin
  select commerce_enabled,operation_mode
  into v_enabled,v_mode
  from public.platform_launch_control
  where singleton=true;

  return jsonb_build_object(
    'commerceEnabled',coalesce(v_enabled,false),
    'operationMode',coalesce(v_mode,'PRELAUNCH')
  );
end;
$$;

create or replace function public.admin_launch_control_action(
  p_actor_user_id uuid,
  p_action text,
  p_source_sha text,
  p_customer_ok boolean,
  p_merchant_ok boolean,
  p_admin_ok boolean,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_readiness jsonb;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_action='enable-commerce' then
    return public.admin_operation_mode_action(
      p_actor_user_id,'PILOT',
      'Abertura pelo fluxo legado; iniciar em modo PILOT.',
      p_source_sha,p_idempotency_key,p_request_hash
    );
  elsif p_action='disable-commerce' then
    return public.admin_operation_mode_action(
      p_actor_user_id,'PAUSED',
      'Pausa imediata de novos pedidos pelo kill switch.',
      p_source_sha,p_idempotency_key,p_request_hash
    );
  elsif p_action<>'record-portals' then
    raise exception 'INVALID_LAUNCH_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;
  if p_source_sha is null
     or lower(trim(p_source_sha))!~'^[0-9a-f]{40}$'
     or not coalesce(p_customer_ok,false)
     or not coalesce(p_merchant_ok,false)
     or not coalesce(p_admin_ok,false) then
    raise exception 'PORTAL_ATTESTATION_INVALID' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-launch:record-portals',p_request_hash
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
     or v_action.action_name<>'admin-launch:record-portals'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  update public.platform_launch_control
  set portals_verified_at=clock_timestamp(),
      portals_source_sha=lower(trim(p_source_sha)),
      customer_portal_ok=true,
      merchant_portal_ok=true,
      admin_portal_ok=true,
      updated_at=clock_timestamp()
  where singleton=true;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'record-launch-portals','platform_launch',null,
    jsonb_build_object('sourceSha',lower(trim(p_source_sha)))
  );

  v_readiness:=public.platform_launch_readiness();
  v_result:=jsonb_build_object(
    'ok',true,
    'action','record-portals',
    'commerceEnabled',coalesce((v_readiness->>'commerceEnabled')::boolean,false),
    'readiness',v_readiness
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.platform_launch_readiness() from public, anon, authenticated;
grant execute on function public.platform_launch_readiness() to service_role;

revoke all on function public.commerce_launch_status() from public, anon, authenticated;
grant execute on function public.commerce_launch_status() to service_role;

revoke all on function public.admin_confirm_launch_requirement(
  uuid,text,text,text,jsonb,timestamptz,jsonb,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_confirm_launch_requirement(
  uuid,text,text,text,jsonb,timestamptz,jsonb,text,text,text
) to service_role;

revoke all on function public.admin_operation_mode_action(
  uuid,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_operation_mode_action(
  uuid,text,text,text,text,text
) to service_role;

revoke all on function public.admin_launch_control_action(
  uuid,text,text,boolean,boolean,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.admin_launch_control_action(
  uuid,text,text,boolean,boolean,boolean,text,text
) to service_role;
