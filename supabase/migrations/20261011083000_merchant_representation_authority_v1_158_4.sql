-- V1.158.4 — independently verified merchant representative before selling.
-- Depends on V1.158.1 / V1.158.2 / V1.158.3.
-- Approval of an application creates a pending merchant and an owner account,
-- but does NOT prove authority to sell on behalf of that CNPJ.
-- This review is administered separately, records only a reference to evidence,
-- and is invalidated on CNPJ change, owner removal, expiration or revocation.

create table if not exists public.merchant_representation_reviews (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  merchant_cnpj text not null check (merchant_cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  authority_kind text not null check (
    authority_kind in ('legal_representative','authorized_delegate')
  ),
  evidence_reference text not null check (
    char_length(trim(evidence_reference)) between 8 and 240
  ),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_representation_review_dates check (
    expires_at>verified_at and
    ((revoked_at is null and revoked_by is null)
      or (revoked_at is not null and revoked_by is not null))
  )
);
alter table public.merchant_representation_reviews enable row level security;
revoke all on public.merchant_representation_reviews from public,anon,authenticated;
grant select,insert,update on public.merchant_representation_reviews to service_role;

create or replace function public.merchant_representative_verification_current(
  p_merchant_id uuid
) returns boolean language sql stable security definer
set search_path to pg_catalog
as $func$
  select coalesce(exists(
    select 1 from public.merchant_representation_reviews r
    join public.merchants m on m.id=r.merchant_id
    join public.merchant_members mm
      on mm.merchant_id=r.merchant_id
      and mm.user_id=r.owner_user_id
      and mm.member_role='owner'
      and mm.active
    join auth.users u on u.id=r.owner_user_id
    where r.merchant_id=p_merchant_id
      and m.cnpj=r.merchant_cnpj
      and r.revoked_at is null
      and r.expires_at>statement_timestamp()
      and u.is_anonymous is false
      and u.email_confirmed_at is not null
  ),false);
$func$;
revoke all on function public.merchant_representative_verification_current(uuid)
  from public,anon,authenticated;
grant execute on function public.merchant_representative_verification_current(uuid)
  to service_role;

-- This is the only allowed admin mutation endpoint. The evidence source is
-- a document/registry reference, not an uploaded identity document or
-- full personal data. Every decision is audited.
create or replace function public.admin_merchant_representation_action(
  p_actor_user_id uuid,p_merchant_id uuid,p_owner_user_id uuid,
  p_decision text,p_authority_kind text,p_evidence_reference text,
  p_idempotency_key text,p_request_hash text
)
returns jsonb language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_merchant public.merchants%rowtype;
  v_request public.action_requests%rowtype;
  v_review public.merchant_representation_reviews%rowtype;
  v_result jsonb;
  v_valid_until timestamptz;
begin
  perform public.require_platform_admin(p_actor_user_id);
  if p_merchant_id is null or p_decision not in ('verify','revoke') then
    raise exception 'INVALID_REPRESENTATION_DECISION' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 12 and 120
     or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_IDEMPOTENCY_REQUEST' using errcode='22023';
  end if;
  if p_evidence_reference is null
     or char_length(trim(p_evidence_reference)) not between 8 and 240 then
    raise exception 'REPRESENTATION_EVIDENCE_REQUIRED' using errcode='22023';
  end if;
  if p_decision='verify' and p_authority_kind not in (
    'legal_representative','authorized_delegate'
  ) then
    raise exception 'INVALID_REPRESENTATION_AUTHORITY' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  ) values(
    p_idempotency_key,p_actor_user_id,
    'merchant-representation:'||p_decision,p_request_hash
  ) on conflict(idempotency_key) do nothing;

  select * into v_request from public.action_requests
  where idempotency_key=p_idempotency_key for update;
  if v_request.user_id is distinct from p_actor_user_id
     or v_request.action_name is distinct from
       'merchant-representation:'||p_decision
     or v_request.request_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_request.completed_at is not null then
    return v_request.result_json;
  end if;

  select * into v_merchant from public.merchants
  where id=p_merchant_id for update;
  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  select * into v_review
  from public.merchant_representation_reviews
  where merchant_id=v_merchant.id for update;

  if p_decision='verify' then
    if p_owner_user_id is null
      or not exists (
        select 1 from public.merchant_members mm
        join auth.users u on u.id=mm.user_id
        where mm.merchant_id=v_merchant.id
          and mm.user_id=p_owner_user_id
          and mm.member_role='owner' and mm.active
          and u.is_anonymous is false
          and u.email_confirmed_at is not null
      ) then
      raise exception 'CONFIRMED_MERCHANT_OWNER_REQUIRED' using errcode='42501';
    end if;
    v_valid_until:=clock_timestamp()+case
      when p_authority_kind='authorized_delegate'
        then interval '180 days'
      else interval '365 days'
    end;
    insert into public.merchant_representation_reviews(
      merchant_id,owner_user_id,merchant_cnpj,authority_kind,
      evidence_reference,verified_by,verified_at,expires_at,
      revoked_at,revoked_by,updated_at
    ) values(
      v_merchant.id,p_owner_user_id,v_merchant.cnpj,p_authority_kind,
      trim(p_evidence_reference),p_actor_user_id,
      clock_timestamp(),v_valid_until,
      null,null,clock_timestamp()
    )
    on conflict(merchant_id) do update set
      owner_user_id=excluded.owner_user_id,
      merchant_cnpj=excluded.merchant_cnpj,
      authority_kind=excluded.authority_kind,
      evidence_reference=excluded.evidence_reference,
      verified_by=excluded.verified_by,
      verified_at=excluded.verified_at,
      expires_at=excluded.expires_at,
      revoked_at=null,
      revoked_by=null,
      updated_at=excluded.updated_at;
  else
    if not found or v_review.revoked_at is not null then
      raise exception 'ACTIVE_REPRESENTATION_REVIEW_NOT_FOUND'
        using errcode='40001';
    end if;
    update public.merchant_representation_reviews
    set revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,
      updated_at=clock_timestamp()
    where merchant_id=v_merchant.id;
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  ) values(
    p_actor_user_id,
    case when p_decision='verify' then 'merchant_representation_verified'
         else 'merchant_representation_revoked' end,
    'merchant',v_merchant.id::text,
    jsonb_build_object(
      'ownerUserId',case when p_decision='verify' then p_owner_user_id
                         else v_review.owner_user_id end,
      'authorityKind',case when p_decision='verify' then p_authority_kind
                           else v_review.authority_kind end,
      'evidenceSha256',encode(
        extensions.digest(convert_to(trim(p_evidence_reference),'UTF8'),'sha256'),'hex'
      )
    )
  );
  v_result:=jsonb_build_object(
    'ok',true,'merchantId',v_merchant.id,'decision',p_decision,
    'representationCurrent',
      public.merchant_representative_verification_current(v_merchant.id)
  );
  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;
  return v_result;
end;
$func$;
revoke all on function public.admin_merchant_representation_action(
 uuid,uuid,uuid,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_representation_action(
 uuid,uuid,uuid,text,text,text,text,text
) to service_role;

-- Existing generic CNPJ checks remain; preserve strict GLP/ANP eligibility.

create or replace function public.merchant_basket_compliance_current(
 p_merchant_id uuid,p_product_codes text[]
)
returns boolean language sql stable security definer
set search_path to pg_catalog
as $func$
select coalesce(
 p_merchant_id is not null
 and p_product_codes is not null
 and cardinality(p_product_codes)>0
 and public.merchant_cnpj_compliance_current(p_merchant_id)
 and public.merchant_representative_verification_current(p_merchant_id)
 and (
   select count(*)=cardinality(p_product_codes)
     and bool_and(code<>''
       and (p.product_code is not null
         or public.is_glp_product_code(code)
         or public.is_glp_container_product_code(code)))
     and (not bool_or(
       public.is_glp_product_code(code)
       or public.is_glp_container_product_code(code)
       or coalesce(p.delivery_class in ('regulated_glp','regulated_glp_container'),false)
     ) or public.merchant_anp_verification_current(p_merchant_id))
   from (
     select upper(trim(coalesce(x,''))) as code
     from unnest(p_product_codes) as v(x)
   ) requested
   left join public.product_delivery_profiles p
     on p.product_code=requested.code and p.active
 ),false);
$func$;

CREATE OR REPLACE FUNCTION public.enforce_active_merchant_compliance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.status='active' or new.online then
    if not public.merchant_cnpj_compliance_current(new.id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;
    if not public.merchant_representative_verification_current(new.id) then
      raise exception 'MERCHANT_REPRESENTATION_VERIFICATION_REQUIRED'
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_merchant_status(p_actor_user_id uuid, p_merchant_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_merchant public.merchants%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_status not in ('active','suspended') then
    raise exception 'INVALID_MERCHANT_STATUS' using errcode='22023';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_merchant.status=p_status then
    return jsonb_build_object(
      'ok',true,
      'merchantId',v_merchant.id,
      'status',v_merchant.status,
      'online',v_merchant.online,
      'alreadyInState',true
    );
  end if;

  if p_status='active' then
    if v_merchant.status not in ('pending','suspended') then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;

    if not public.merchant_representative_verification_current(v_merchant.id) then
      raise exception 'MERCHANT_REPRESENTATION_VERIFICATION_REQUIRED'
        using errcode='40001';
    end if;
    if not public.merchant_cnpj_compliance_current(v_merchant.id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='40001';
    end if;

  else
    if v_merchant.status<>'active' then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;
  end if;

  update public.merchants
  set status=p_status,
      online=false,
      updated_at=clock_timestamp()
  where id=v_merchant.id
  returning * into v_merchant;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_status='active' then 'merchant_activated' else 'merchant_suspended' end,
    'merchant',
    v_merchant.id::text,
    jsonb_build_object('status',p_status)
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',v_merchant.id,
    'status',v_merchant.status,
    'online',v_merchant.online,
    'alreadyInState',false
  );
end;
$function$;

-- Checklist administrativo distinguishes representation authority from ANP/product.
create or replace function public.merchant_enablement_diagnostic_v1_158(p_actor_user_id uuid,p_merchant_id uuid)
returns table(
  merchant_id uuid, merchant_name text, cnpj text, city text, state text,
  merchant_status text, ready boolean, blocker_count integer,
  checks jsonb, checked_at timestamptz
)
language sql stable security definer
set search_path to pg_catalog
as $func$
with target as materialized (
  select m.id,m.name,m.cnpj,m.status,m.online,m.accepts_citywide,
    m.last_seen_at,m.delivery_fee_confirmed_at,
    d.city,d.state
  from public.merchants m
  left join public.merchant_business_details d on d.merchant_id=m.id
  where m.id=p_merchant_id
    and exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=m.id and mm.user_id=p_actor_user_id
        and mm.active and mm.member_role in ('owner','manager')
    )
  limit 1
), checked as (
  select t.*,
    (coalesce(t.city,'')<>'' and t.state ~ '^[A-Z]{2}$') as has_region,
    exists (
      select 1 from public.platform_launch_control lc
      where lc.singleton and lc.commerce_enabled and lc.operation_mode in ('LIVE','PILOT')
    ) as global_commerce_enabled,
    public.merchant_allowed_in_operation_mode(t.id) as mode_allowed,
    public.merchant_cnpj_compliance_current(t.id) as cnpj_ok,
    public.merchant_representative_verification_current(t.id) as representation_ok,
    public.merchant_has_compliant_catalog_item(t.id) as category_ok,
    public.merchant_financial_sales_allowed(t.id) as finance_ok,
    exists (
      select 1 from public.catalog_items ci
      where ci.merchant_id=t.id and ci.active
        and ci.available_stock>0 and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
        and public.merchant_basket_compliance_current(t.id,array[ci.product_code])
    ) as stock_price_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
    ) as payment_method_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
        and public.merchant_delivery_payment_allowed(t.id,pm.payment_method)
    ) as payment_route_ok,
    not exists (
      select 1 from public.market_cities mc
      where mc.state=upper(trim(t.state))
        and mc.city_key=public.market_city_key(t.city)
        and mc.admin_paused
    ) as city_not_paused,
    case
      when t.state ~ '^[A-Z]{2}$' and length(coalesce(t.city,''))>=2 then
        t.id=any(public.market_city_offer_scope(t.city,t.state))
      else false
    end as authoritative_offer_ready
  from target t
)
select c.id,c.name,c.cnpj,c.city,c.state,c.status,
  c.authoritative_offer_ready as ready,
  (select count(*)::integer from (
      values
      (c.status='active'),
      (c.online),
      (c.accepts_citywide),
      (c.last_seen_at>=statement_timestamp()-interval '10 minutes'),
      (c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'),
      (c.has_region),
      (c.cnpj_ok),
      (c.representation_ok),
      (c.category_ok),
      (c.mode_allowed),
      (c.global_commerce_enabled),
      (c.city_not_paused),
      (c.finance_ok),
      (c.stock_price_ok),
      (c.payment_method_ok),
      (c.payment_route_ok),
      (c.authoritative_offer_ready)
    ) as req(ok) where req.ok is not true) as blocker_count,
  (select coalesce(jsonb_agg(
      jsonb_build_object('key',req.key,'label',req.label,'ok',coalesce(req.ok,false),
        'action',req.action,'owner',req.owner,'scope',req.scope)
       order by req.sort
    ),'[]'::jsonb)
    from (values
      (10,'merchant_status','Cadastro e ativação',c.status='active',
        'Validar e ativar o cadastro no Admin após aprovação documental','admin','merchant'),
      (20,'cnpj','Regularidade do CNPJ',c.cnpj_ok,
        'Conferir documento, validade e confirmação do CNPJ','admin','merchant'),
            (25,'representation','Representante autorizado pela administração',c.representation_ok,
        'Conferir os poderes legais do proprietário e registrar referência documental no painel','admin','merchant'),
(30,'product_authority','Existe produto com autorização válida',c.category_ok,
        'GLP requer ANP válida; outros produtos podem ser comercializados conforme suas próprias regras','admin','merchant'),
      (40,'operation_mode','Modo operacional da revenda',c.mode_allowed,
        'Verificar regras do modo operacional vigente, inclusive exigências específicas','admin','global'),
      (50,'global_commerce','Comércio habilitado na plataforma',c.global_commerce_enabled,
        'Verificar controles globais do TAMÃO; não habilitar vendas somente para eliminar bloqueio','admin','global'),
      (60,'location','Município e UF informados',c.has_region,
        'Conferir o endereço da revenda e seu município de atuação','admin','merchant'),
      (70,'city_pause','Cidade sem pausa administrativa',c.city_not_paused,
        'Conferir o motivo de pausa da cidade no painel de expansão','admin','city'),
      (80,'financial','Situação financeira liberada',c.finance_ok,
        'Conferir suspensão de vendas e pendências financeiras','admin','merchant'),
      (90,'inventory','Produto ativo com estoque e preço recente',c.stock_price_ok,
        'Ativar um produto permitido, informar estoque positivo e confirmar preço atualizado','merchant','merchant'),
      (100,'payment_method','Forma de pagamento ativa',c.payment_method_ok,
        'Habilitar uma forma de pagamento aceita pelo estabelecimento','merchant','merchant'),
      (110,'payment_route','Pagamento na entrega disponível',c.payment_route_ok,
        'Ative Pix, dinheiro ou cartão na entrega; não é necessário conectar um PSP para começar','merchant','merchant'),
      (120,'delivery_area','Cobertura de entrega da cidade',c.accepts_citywide,
        'Confirmar capacidade de atender a cidade conforme as regras do produto','merchant','merchant'),
      (130,'delivery_fee','Preço de entrega atualizado',c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours',
        'Confirmar taxa de entrega da revenda para os próximos pedidos','merchant','merchant'),
      (140,'online','Revenda disponível',c.online,
        'Entrar no painel da revenda e confirmar disponibilidade','merchant','realtime'),
      (150,'heartbeat','Presença atualizada',c.last_seen_at>=statement_timestamp()-interval '10 minutes',
        'Conferir conexão e presença recente da revenda','merchant','realtime'),
      (160,'quote_authority','Autorização final para novas cotações',c.authoritative_offer_ready,
        'Revisar os bloqueios acima; o motor de cotações é a autoridade final','system','realtime')
    ) as req(sort,key,label,ok,action,owner,scope)
  ) as checks,
  statement_timestamp() as checked_at
from checked c
order by c.authoritative_offer_ready asc, c.name,c.id;
$func$;

CREATE OR REPLACE FUNCTION public.admin_merchant_enablement_v1_157(p_limit integer DEFAULT 80)
 RETURNS TABLE(merchant_id uuid, merchant_name text, cnpj text, city text, state text, merchant_status text, ready boolean, blocker_count integer, checks jsonb, checked_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
with target as materialized (
  select m.id,m.name,m.cnpj,m.status,m.online,m.accepts_citywide,
    m.last_seen_at,m.delivery_fee_confirmed_at,
    d.city,d.state
  from public.merchants m
  left join public.merchant_business_details d on d.merchant_id=m.id
  order by m.created_at desc,m.id
  limit least(greatest(coalesce(p_limit,80),1),100)
), checked as (
  select t.*,
    (coalesce(t.city,'')<>'' and t.state ~ '^[A-Z]{2}$') as has_region,
    exists (
      select 1 from public.platform_launch_control lc
      where lc.singleton and lc.commerce_enabled and lc.operation_mode in ('LIVE','PILOT')
    ) as global_commerce_enabled,
    public.merchant_allowed_in_operation_mode(t.id) as mode_allowed,
    public.merchant_cnpj_compliance_current(t.id) as cnpj_ok,
    public.merchant_representative_verification_current(t.id) as representation_ok,
    public.merchant_has_compliant_catalog_item(t.id) as category_ok,
    public.merchant_financial_sales_allowed(t.id) as finance_ok,
    exists (
      select 1 from public.catalog_items ci
      where ci.merchant_id=t.id and ci.active
        and ci.available_stock>0 and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
        and public.merchant_basket_compliance_current(t.id,array[ci.product_code])
    ) as stock_price_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
    ) as payment_method_ok,
    exists (
      select 1 from public.merchant_payment_routes pr
      where pr.merchant_id=t.id and pr.active
    ) as payment_route_ok,
    not exists (
      select 1 from public.market_cities mc
      where mc.state=upper(trim(t.state))
        and mc.city_key=public.market_city_key(t.city)
        and mc.admin_paused
    ) as city_not_paused,
    case
      when t.state ~ '^[A-Z]{2}$' and length(coalesce(t.city,''))>=2 then
        t.id=any(public.market_city_offer_scope(t.city,t.state))
      else false
    end as authoritative_offer_ready
  from target t
)
select c.id,c.name,c.cnpj,c.city,c.state,c.status,
  c.authoritative_offer_ready as ready,
  (select count(*)::integer from (
      values
      (c.status='active'),
      (c.online),
      (c.accepts_citywide),
      (c.last_seen_at>=statement_timestamp()-interval '10 minutes'),
      (c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'),
      (c.has_region),
      (c.cnpj_ok),
      (c.representation_ok),
      (c.category_ok),
      (c.mode_allowed),
      (c.global_commerce_enabled),
      (c.city_not_paused),
      (c.finance_ok),
      (c.stock_price_ok),
      (c.payment_method_ok),
      (c.payment_route_ok),
      (c.authoritative_offer_ready)
    ) as req(ok) where req.ok is not true) as blocker_count,
  (select coalesce(jsonb_agg(
      jsonb_build_object('key',req.key,'label',req.label,'ok',coalesce(req.ok,false),
        'action',req.action,'owner',req.owner,'scope',req.scope)
       order by req.sort
    ),'[]'::jsonb)
    from (values
      (10,'merchant_status','Cadastro e ativação',c.status='active',
        'Validar e ativar o cadastro no Admin após aprovação documental','admin','merchant'),
      (20,'cnpj','Regularidade do CNPJ',c.cnpj_ok,
        'Conferir documento, validade e confirmação do CNPJ','admin','merchant'),
            (25,'representation','Representante autorizado pela administração',c.representation_ok,
        'Conferir os poderes legais do proprietário e registrar referência documental no painel','admin','merchant'),
(30,'product_authority','Existe produto autorizado para comercialização',c.category_ok,
        'Para vender gás é obrigatória ANP válida; outros produtos exigem sua própria conformidade','admin','merchant'),
      (40,'operation_mode','Modo operacional da revenda',c.mode_allowed,
        'Verificar regras do modo operacional vigente, inclusive exigências específicas','admin','global'),
      (50,'global_commerce','Comércio habilitado na plataforma',c.global_commerce_enabled,
        'Verificar controles globais do TAMÃO; não habilitar vendas somente para eliminar bloqueio','admin','global'),
      (60,'location','Município e UF informados',c.has_region,
        'Conferir o endereço da revenda e seu município de atuação','admin','merchant'),
      (70,'city_pause','Cidade sem pausa administrativa',c.city_not_paused,
        'Conferir o motivo de pausa da cidade no painel de expansão','admin','city'),
      (80,'financial','Situação financeira liberada',c.finance_ok,
        'Conferir suspensão de vendas e pendências financeiras','admin','merchant'),
      (90,'inventory','Produto ativo com estoque e preço recente',c.stock_price_ok,
        'Ativar um produto permitido, informar estoque positivo e confirmar preço atualizado','merchant','merchant'),
      (100,'payment_method','Forma de pagamento ativa',c.payment_method_ok,
        'Habilitar uma forma de pagamento aceita pelo estabelecimento','merchant','merchant'),
      (110,'payment_route','Rota de recebimento ativa',c.payment_route_ok,
        'Configurar e validar a rota de recebimento escolhida, sem envolver repasses do TAMÃO','merchant','merchant'),
      (120,'delivery_area','Cobertura de entrega da cidade',c.accepts_citywide,
        'Confirmar capacidade de atender a cidade conforme as regras do produto','merchant','merchant'),
      (130,'delivery_fee','Preço de entrega atualizado',c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours',
        'Confirmar taxa de entrega da revenda para os próximos pedidos','merchant','merchant'),
      (140,'online','Revenda disponível',c.online,
        'Entrar no painel da revenda e confirmar disponibilidade','merchant','realtime'),
      (150,'heartbeat','Presença atualizada',c.last_seen_at>=statement_timestamp()-interval '10 minutes',
        'Conferir conexão e presença recente da revenda','merchant','realtime'),
      (160,'quote_authority','Autorização final para novas cotações',c.authoritative_offer_ready,
        'Revisar os bloqueios acima; o motor de cotações é a autoridade final','system','realtime')
    ) as req(sort,key,label,ok,action,owner,scope)
  ) as checks,
  statement_timestamp() as checked_at
from checked c
order by c.authoritative_offer_ready asc, c.name,c.id;
$function$;
