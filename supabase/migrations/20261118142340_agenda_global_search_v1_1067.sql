-- TAMÃO Agenda V1.1067 — search all public, active schedules with bounded pages.
-- Public read-only API. NEVER exposes private owner, booking or customer data.
-- Keeps agenda_public_directory() intact for older clients during deployment.
begin;

create function public.agenda_search_directory(
 p_query text default '',
 p_limit integer default 12,
 p_offset integer default 0
)
returns table (
 slug text,
 title text,
 city text,
 about text,
 photo_path text,
 total_count bigint
)
language sql stable security definer set search_path='pg_catalog'
as $search$
 with request as (
  select
   pg_catalog.translate(
    pg_catalog.lower(pg_catalog.btrim(pg_catalog.left(coalesce(p_query,''),80))),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
   ) as terms,
   greatest(1,least(coalesce(p_limit,12),24)) as take,
   greatest(0,coalesce(p_offset,0)) as skip
 ),
 eligible as (
  select p.id,p.slug,p.title,p.city,pg_catalog.left(p.about,180) as about,
   p.photo_paths[1] as photo_path,p.created_at
  from public.agenda_pages p
  cross join request r
  where p.published is true
   and exists(
    select 1 from public.agenda_services s
    where s.page_id=p.id and s.active is true
   )
   and exists(
    select 1 from public.agenda_hours h
    where h.page_id=p.id
   )
   and (
    r.terms='' or
    not exists(
     select 1
     from pg_catalog.regexp_split_to_table(r.terms,'[[:space:]]+') as word(token)
     where pg_catalog.strpos(
      pg_catalog.translate(
       pg_catalog.lower(pg_catalog.concat_ws(' ',p.title,p.city,pg_catalog.left(p.about,180))),
       'áàâãäéèêëíìîïóòôõöúùûüç',
       'aaaaaeeeeiiiiooooouuuuc'
      ),word.token
     )=0
    )
   )
 )
 select e.slug,e.title,e.city,e.about,e.photo_path,
  pg_catalog.count(*) over() as total_count
 from eligible e
 order by e.created_at desc,e.id desc
 limit (select take from request)
 offset (select skip from request)
$search$;

revoke all on function public.agenda_search_directory(text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.agenda_search_directory(text,integer,integer)
 to anon,authenticated;

-- Reviewed exact V1.1067 56-RPC fingerprint; all other ACL changes remain fail-closed.
CREATE OR REPLACE FUNCTION public.platform_launch_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    and public.merchant_has_compliant_catalog_item(m.id)
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
    and public.merchant_has_compliant_catalog_item(m.id)
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
    and public.merchant_has_compliant_catalog_item(m.id)
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

  -- Reviewed narrow grants: seven exposed tables (five table-level, two
  -- column-only) with RLS and verified policy expressions, and 28 reviewed
  -- authenticated SECURITY DEFINER signatures/bodies. All other grants or
  -- body/policy changes remain fail-closed until separately tested.
  -- The fingerprints were computed from the commercial database on
  -- 23 October 2026 using the same catalog query as the function above.
  if (public.tamao_launch_acl_posture_v1()->>'tableDigest')
     is distinct from '45caac3d2036da0b2e6cb1772436fe7d' then
    v_security:=array_append(v_security,'browser_sensitive_table_acl');
  end if;

  -- Preserve the original global guard: even an unrelated/new public
  -- table without browser grants must retain RLS.
  if exists(
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and not c.relrowsecurity
  ) then
    v_security:=array_append(v_security,'sensitive_table_rls_disabled');
  end if;

  if (public.tamao_launch_acl_posture_v1()->>'rpcDigest')
     is distinct from 'a2541222631102b9b6766d1f36784893' then
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
    v_security:=array_append(v_security,'live_portals_verification_required');
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
    'readyToEnable',v_database_ready and cardinality(v_security)=0 and cardinality(v_unresolved)=0,
    'canActivateOperation',v_database_ready and cardinality(v_security)=0 and cardinality(v_unresolved)=0,
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
$function$;

commit;
