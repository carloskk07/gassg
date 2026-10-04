-- TAMÃO v1.62.1 — confirmação ausente precisa ser false, nunca NULL.
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

    v_confirmed:=coalesce(
      v_conf_status='confirmed'
      and (v_conf_expires is null or v_conf_expires>statement_timestamp()),
      false
    );

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
